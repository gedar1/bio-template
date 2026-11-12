import Database from "better-sqlite3";
import { IDatabase } from "../interfaces/IDatabase.js";
import { createLogger } from "../../config/logger.js";
import { MoleculeError } from "../../errors.js";
import { resolveDataPath } from "../../atoms/paths.js";
import { checkReadOnlySql, isSqlIdentifier } from "../../atoms/sqlSafety.js";

const log = createLogger("SQLite");

/** Tipos de columna aceptados en createTable: palabras, paréntesis y comas. */
const COLUMN_TYPE_PATTERN = /^[A-Za-z_][A-Za-z0-9_ (),]*$/;

/**
 * Implementación SQLite de la interfaz IDatabase.
 * Usa better-sqlite3 (sincrónico, ultra-rápido, sin dependencias del sistema).
 *
 * Dos conexiones:
 * - La escritura (`db`) la usan las herramientas tipadas (insert, update, delete).
 * - La de solo lectura (`readonlyDb`) la usa `queryReadOnly`, que es lo que expone
 *   `db_query` al LLM. Con SQLite en modo readonly no se puede escribir nada por esa vía.
 *
 * @example
 * const db = new SQLiteMolecule('./data.db');
 * await db.connect();
 * await db.insert('users', { name: 'John', email: 'john@example.com' });
 * const users = await db.find('users', { name: 'John' });
 */
export class SQLiteMolecule implements IDatabase {
  readonly name = "sqlite";
  readonly version = "1.0.0";
  private db: Database.Database | null = null;
  private readonlyDb: Database.Database | null = null;
  readonly dbPath: string;

  constructor(dbPath: string = resolveDataPath("./data/biocore.db")) {
    this.dbPath = dbPath;
  }

  async connect(): Promise<void> {
    try {
      this.db = new Database(this.dbPath);
      this.db.pragma("journal_mode = WAL");
      log.info({ path: this.dbPath }, "Conectado");
    } catch (error: any) {
      throw new MoleculeError("sqlite", `Error de conexión: ${error.message}`, {
        path: this.dbPath,
      });
    }
  }

  async query(sql: string, params: any[] = []): Promise<any[]> {
    if (!this.db)
      throw new MoleculeError(
        "sqlite",
        "Base de datos no inicializada. Llama connect() primero.",
      );

    try {
      const stmt = this.db.prepare(sql);

      // Detecta si es SELECT o no
      if (sql.trim().toUpperCase().startsWith("SELECT")) {
        return stmt.all(...params);
      } else {
        const result = stmt.run(...params);
        return [
          { changes: result.changes, lastInsertRowid: result.lastInsertRowid },
        ];
      }
    } catch (error: any) {
      throw new MoleculeError("sqlite", `Query error: ${error.message}`, {
        sql,
      });
    }
  }

  /**
   * Ejecuta una consulta de solo lectura. Rechaza todo lo que no sea SELECT o WITH,
   * ATTACH, PRAGMA o varias sentencias, y además corre en una conexión readonly.
   */
  async queryReadOnly(sql: string, params: any[] = []): Promise<any[]> {
    if (!this.db)
      throw new MoleculeError(
        "sqlite",
        "Base de datos no inicializada. Llama connect() primero.",
      );

    const check = checkReadOnlySql(sql);
    if (!check.ok) {
      throw new MoleculeError("sqlite", `Consulta rechazada: ${check.reason}`);
    }

    try {
      const stmt = this.getReadOnlyHandle().prepare(sql);
      if (!stmt.reader) {
        throw new MoleculeError(
          "sqlite",
          "Consulta rechazada: la sentencia no devuelve filas",
        );
      }
      return stmt.all(...params);
    } catch (error: any) {
      if (error instanceof MoleculeError) throw error;
      throw new MoleculeError("sqlite", `Query error: ${error.message}`, {
        sql,
      });
    }
  }

  async insert(table: string, data: Record<string, any>): Promise<any> {
    const keys = Object.keys(data);
    this.assertIdentifiers(table, keys);

    // Auto-crear tabla si no existe, infiriendo columnas del data
    const columnDefs = keys
      .map((k) => {
        const v = data[k];
        const type = typeof v === "number" ? "REAL" : "TEXT";
        return `${k} ${type}`;
      })
      .join(", ");
    await this.query(
      `CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY AUTOINCREMENT, ${columnDefs})`,
      [],
    );

    const placeholders = keys.map(() => "?").join(", ");
    const sql = `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`;

    const result = await this.query(sql, Object.values(data));
    return result[0]?.lastInsertRowid;
  }

  async find(table: string, filter?: Record<string, any>): Promise<any[]> {
    const filterKeys = filter ? Object.keys(filter) : [];
    this.assertIdentifiers(table, filterKeys);

    let sql = `SELECT * FROM ${table}`;
    const params: any[] = [];

    if (filter && filterKeys.length > 0) {
      const conditions = filterKeys.map((key) => `${key} = ?`).join(" AND ");
      sql += ` WHERE ${conditions}`;
      params.push(...Object.values(filter));
    }

    return await this.query(sql, params);
  }

  async update(
    table: string,
    filter: Record<string, any>,
    data: Record<string, any>,
  ): Promise<number> {
    this.assertIdentifiers(table, [
      ...Object.keys(data),
      ...Object.keys(filter),
    ]);

    const setClause = Object.keys(data)
      .map((key) => `${key} = ?`)
      .join(", ");
    const whereClause = Object.keys(filter)
      .map((key) => `${key} = ?`)
      .join(" AND ");

    const sql = `UPDATE ${table} SET ${setClause} WHERE ${whereClause}`;
    const params = [...Object.values(data), ...Object.values(filter)];

    const result = await this.query(sql, params);
    return result[0]?.changes || 0;
  }

  async delete(table: string, filter: Record<string, any>): Promise<number> {
    this.assertIdentifiers(table, Object.keys(filter));

    const whereClause = Object.keys(filter)
      .map((key) => `${key} = ?`)
      .join(" AND ");
    const sql = `DELETE FROM ${table} WHERE ${whereClause}`;

    const result = await this.query(sql, Object.values(filter));
    return result[0]?.changes || 0;
  }

  async close(): Promise<void> {
    if (this.readonlyDb) {
      this.readonlyDb.close();
      this.readonlyDb = null;
    }
    if (this.db) {
      this.db.close();
      this.db = null;
      log.info("Desconectado");
    }
  }

  /**
   * Utilidades para crear tablas dinámicamente.
   */
  async createTable(
    tableName: string,
    schema: Record<string, string>,
  ): Promise<void> {
    this.assertIdentifiers(tableName, Object.keys(schema));
    for (const type of Object.values(schema)) {
      if (!COLUMN_TYPE_PATTERN.test(type)) {
        throw new MoleculeError("sqlite", `Tipo de columna no válido: ${type}`);
      }
    }

    const columns = Object.entries(schema)
      .map(([name, type]) => `${name} ${type}`)
      .join(", ");

    const sql = `CREATE TABLE IF NOT EXISTS ${tableName} (${columns})`;
    await this.query(sql);
    log.info({ table: tableName }, "Tabla creada/verificada");
  }

  /** Conexión de solo lectura, abierta bajo demanda sobre el mismo archivo. */
  private getReadOnlyHandle(): Database.Database {
    if (!this.readonlyDb) {
      this.readonlyDb = new Database(this.dbPath, {
        readonly: true,
        fileMustExist: true,
      });
    }
    return this.readonlyDb;
  }

  /** Rechaza nombres de tabla o columna que no sean identificadores simples. */
  private assertIdentifiers(table: string, columns: string[]): void {
    if (!isSqlIdentifier(table)) {
      throw new MoleculeError("sqlite", `Nombre de tabla no válido: ${table}`);
    }
    for (const column of columns) {
      if (!isSqlIdentifier(column)) {
        throw new MoleculeError(
          "sqlite",
          `Nombre de columna no válido: ${column}`,
        );
      }
    }
  }
}

import Database from "better-sqlite3";
import { IDatabase } from "../interfaces/IDatabase.js";
import { createLogger } from "../../config/logger.js";
import { MoleculeError } from "../../errors.js";

const log = createLogger("SQLite");

/**
 * Implementación SQLite de la interfaz IDatabase.
 * Usa better-sqlite3 (sincrónico, ultra-rápido, sin dependencias del sistema).
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
  readonly dbPath: string;

  constructor(dbPath: string = "./biocore.db") {
    this.dbPath = dbPath;
  }

  async connect(): Promise<void> {
    try {
      this.db = new Database(this.dbPath);
      this.db.pragma("journal_mode = WAL");
      log.info({ path: this.dbPath }, "Conectado");
    } catch (error: any) {
      throw new MoleculeError("sqlite", `Error de conexión: ${error.message}`, { path: this.dbPath });
    }
  }

  async query(sql: string, params: any[] = []): Promise<any[]> {
    if (!this.db)
      throw new MoleculeError("sqlite", "Base de datos no inicializada. Llama connect() primero.");

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
      throw new MoleculeError("sqlite", `Query error: ${error.message}`, { sql });
    }
  }

  async insert(table: string, data: Record<string, any>): Promise<any> {
    const keys = Object.keys(data);

    // Auto-crear tabla si no existe, infiriendo columnas del data
    const columnDefs = keys
      .map((k) => {
        const v = data[k];
        const type =
          typeof v === "number" ? "REAL" : "TEXT";
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
    let sql = `SELECT * FROM ${table}`;
    const params: any[] = [];

    if (filter && Object.keys(filter).length > 0) {
      const conditions = Object.keys(filter)
        .map((key) => `${key} = ?`)
        .join(" AND ");
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
    const whereClause = Object.keys(filter)
      .map((key) => `${key} = ?`)
      .join(" AND ");
    const sql = `DELETE FROM ${table} WHERE ${whereClause}`;

    const result = await this.query(sql, Object.values(filter));
    return result[0]?.changes || 0;
  }

  async close(): Promise<void> {
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
    const columns = Object.entries(schema)
      .map(([name, type]) => `${name} ${type}`)
      .join(", ");

    const sql = `CREATE TABLE IF NOT EXISTS ${tableName} (${columns})`;
    await this.query(sql);
    log.info({ table: tableName }, "Tabla creada/verificada");
  }
}

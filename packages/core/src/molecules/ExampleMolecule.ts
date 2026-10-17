/**
 * ExampleMolecule — Plantilla base para moléculas de dominio.
 *
 * ─── QUÉ HACER CON ESTE ARCHIVO ─────────────────────────────────────────────
 * 1. Renombra el archivo:  ExampleMolecule.ts → TuNombreMolecule.ts
 * 2. Renombra la clase:    ExampleMolecule    → TuNombreMolecule
 * 3. Cambia `name`:        "example"          → nombre de tu célula
 *                          (debe coincidir con el "type" en config/registry.json)
 * 4. Define tus entidades: reemplaza DomainRecord con tus propias interfaces
 * 5. Implementa tus métodos: cada método público = una herramienta MCP
 * 6. Registra las herramientas en cells/CellServer.ts (sigue los comentarios ahí)
 *
 * ─── REGLAS ──────────────────────────────────────────────────────────────────
 * ✅ Implementa IMolecule (name, version, initialize, dispose)
 * ✅ Usa createLogger para todos los logs
 * ✅ Inicializa conexiones en initialize(), no en el constructor
 * ✅ Cierra conexiones en dispose()
 * ❌ No dependas de otras moléculas en el constructor
 * ❌ No uses estado global
 *
 * ─── REFERENCIA ─────────────────────────────────────────────────────────────
 * bio-core/packages/restaurant/src/molecules/OrderMolecule.ts — ejemplo real
 */

import Database from "better-sqlite3";
import { z } from "zod";
import { createLogger } from "../config/logger.js";
import { MoleculeError } from "../errors.js";
import type { IMolecule } from "./interfaces/IMolecule.js";

const log = createLogger("ExampleMolecule");

// ─── Tipos del dominio ────────────────────────────────────────────────────────
// Reemplaza DomainRecord con las entidades de tu negocio.
// Ejemplo restaurante: Order, OrderItem, OrderStatus
// Ejemplo alertas:     Alert, HealthCheck, Incident

export interface DomainRecord {
  id: number;
  tenantId: string;
  name: string;
  status: "active" | "inactive" | "pending";
  data: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

type DomainRecordRow = {
  id: number;
  tenant_id: string;
  name: string;
  status: DomainRecord["status"];
  data_json: string;
  created_at: number;
  updated_at: number;
};

const DomainRecordRowSchema = z.object({
  id: z.number().int(),
  tenant_id: z.string().min(1),
  name: z.string(),
  status: z.enum(["active", "inactive", "pending"]),
  data_json: z.string(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
});

const DomainDataSchema = z.record(z.unknown());

// ─── Molécula ────────────────────────────────────────────────────────────────

export class ExampleMolecule implements IMolecule {
  readonly name = "example"; // ← Cambia al nombre de tu célula
  readonly version = "1.0.0";

  private db!: Database.Database;
  private readonly dbPath: string;

  constructor(dbPath: string = process.env.DATABASE_PATH ?? "./biocore.db") {
    this.dbPath = dbPath;
  }

  // ─── Ciclo de vida ──────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initSchema();
    log.info({ path: this.dbPath }, "ExampleMolecule inicializada");
  }

  async dispose(): Promise<void> {
    this.db?.close();
    log.debug("ExampleMolecule liberada");
  }

  // ─── Schema ──────────────────────────────────────────────────────────────────

  private initSchema(): void {
    // Define aquí las tablas de tu dominio.
    // Usa IF NOT EXISTS — se ejecuta en cada arranque, debe ser idempotente.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS domain_records (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id   TEXT    NOT NULL,
        name        TEXT    NOT NULL,
        status      TEXT    NOT NULL DEFAULT 'pending',
        data_json   TEXT    NOT NULL DEFAULT '{}',
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_domain_records_tenant
        ON domain_records(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_domain_records_status
        ON domain_records(tenant_id, status);
    `);
  }

  // ─── Métodos públicos = herramientas MCP ────────────────────────────────────
  // Cada método corresponde a una tool en config/registry.json
  // y se registra en cells/CellServer.ts

  /** Herramienta: create_record */
  create(
    name: string,
    data: Record<string, unknown> = {},
    tenantId = "default",
  ): DomainRecord {
    const now = Date.now();
    const result = this.db
      .prepare(
        `INSERT INTO domain_records (tenant_id, name, status, data_json, created_at, updated_at)
                VALUES (?, ?, 'active', ?, ?, ?)`,
      )
      .run(tenantId, name, JSON.stringify(data), now, now);
    const id = Number(result.lastInsertRowid);
    log.info({ id, name }, "Registro creado");
    const record = this.getById(id, tenantId);
    if (!record) {
      throw new MoleculeError(
        this.name,
        `No se pudo recuperar el registro recién creado (${id}).`,
        { tenantId },
      );
    }
    return record;
  }

  /** Herramienta: get_record */
  getById(id: number, tenantId = "default"): DomainRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM domain_records WHERE id = ? AND tenant_id = ?`)
      .get(id, tenantId);
    return row ? this.mapRow(row) : null;
  }

  /** Herramienta: list_records */
  list(
    status?: DomainRecord["status"],
    limit = 50,
    tenantId = "default",
  ): DomainRecord[] {
    const rows: unknown[] = status
      ? this.db
          .prepare(
            `SELECT * FROM domain_records WHERE tenant_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?`,
          )
          .all(tenantId, status, limit)
      : this.db
          .prepare(
            `SELECT * FROM domain_records WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`,
          )
          .all(tenantId, limit);
    return rows.map((row) => this.mapRow(row));
  }

  /** Herramienta: update_record_status */
  updateStatus(
    id: number,
    status: DomainRecord["status"],
    tenantId = "default",
  ): DomainRecord | null {
    this.db
      .prepare(
        `UPDATE domain_records SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
      )
      .run(status, Date.now(), id, tenantId);
    log.info({ id, status }, "Estado actualizado");
    return this.getById(id, tenantId);
  }

  /** Herramienta: delete_record — pasa por ExecutionGuardrail de Jev si TYPESAFE_API_KEY está configurada */
  delete(id: number, tenantId = "default"): boolean {
    const result = this.db
      .prepare(`DELETE FROM domain_records WHERE id = ? AND tenant_id = ?`)
      .run(id, tenantId);
    log.info({ id, deleted: result.changes > 0 }, "Registro eliminado");
    return result.changes > 0;
  }

  private mapRow(row: unknown): DomainRecord {
    const parsedRow: DomainRecordRow = DomainRecordRowSchema.parse(row);
    let parsedData: unknown;
    try {
      parsedData = JSON.parse(parsedRow.data_json);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new MoleculeError(
        this.name,
        `data_json no contiene JSON válido: ${message}`,
        { id: parsedRow.id },
      );
    }

    const dataResult = DomainDataSchema.safeParse(parsedData);
    if (!dataResult.success) {
      throw new MoleculeError(
        this.name,
        "data_json debe representar un objeto JSON.",
        { id: parsedRow.id },
      );
    }

    return {
      id: parsedRow.id,
      tenantId: parsedRow.tenant_id,
      name: parsedRow.name,
      status: parsedRow.status,
      data: dataResult.data,
      createdAt: parsedRow.created_at,
      updatedAt: parsedRow.updated_at,
    };
  }
}

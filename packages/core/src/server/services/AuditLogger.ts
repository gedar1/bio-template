import type Database from "better-sqlite3";
import { createLogger } from "../../config/logger.js";

const log = createLogger("AuditLogger");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  action: string;
  actor: string;
  target_tenant: string | null;
  details: Record<string, unknown>;
  timestamp: string;
}

export type AuditLogInput = Omit<AuditEntry, "id" | "timestamp">;

// ─── AuditLogger Service ──────────────────────────────────────────────────────

/**
 * AuditLogger — Registra operaciones de escritura en la plataforma
 * para trazabilidad y auditoría.
 *
 * Usa la tabla `platform_audit` del schema compartido.
 * Cada entrada recibe un UUID automático y timestamp ISO al momento del log.
 */
export class AuditLogger {
  private db: InstanceType<typeof Database> | null = null;

  /**
   * Inicializa el logger con una instancia de base de datos compartida.
   * La tabla `platform_audit` debe existir previamente (creada por platformSchema.ts).
   */
  initialize(db: InstanceType<typeof Database>): void {
    this.db = db;
    log.info("AuditLogger inicializado");
  }

  /**
   * Registra una entrada de auditoría.
   *
   * @param action - Nombre de la acción (e.g. "tenant.create", "tenant.deactivate")
   * @param actor - Identificador del actor (e.g. "platform-admin" del JWT sub)
   * @param targetTenant - ID del tenant afectado (opcional)
   * @param details - Detalles adicionales como objeto JSON (opcional)
   * @returns La entrada de auditoría completa con id y timestamp generados
   */
  log(
    action: string,
    actor: string,
    targetTenant?: string | null,
    details?: Record<string, unknown>,
  ): AuditEntry {
    if (!this.db) {
      throw new Error("AuditLogger not initialized — call initialize() first");
    }

    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const detailsJson = JSON.stringify(details ?? {});

    const stmt = this.db.prepare(`
      INSERT INTO platform_audit (id, action, actor, target_tenant, details, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, action, actor, targetTenant ?? null, detailsJson, timestamp);

    const entry: AuditEntry = {
      id,
      action,
      actor,
      target_tenant: targetTenant ?? null,
      details: details ?? {},
      timestamp,
    };

    log.debug({ action, actor, targetTenant }, "Audit entry recorded");

    return entry;
  }

  /**
   * Obtiene las entradas de auditoría más recientes.
   *
   * @param limit - Cantidad máxima de entradas a retornar (default: 50)
   * @returns Entradas ordenadas por timestamp DESC (más recientes primero)
   */
  getRecent(limit: number = 50): AuditEntry[] {
    if (!this.db) {
      throw new Error("AuditLogger not initialized — call initialize() first");
    }

    const stmt = this.db.prepare(`
      SELECT id, action, actor, target_tenant, details, timestamp
      FROM platform_audit
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as Array<{
      id: string;
      action: string;
      actor: string;
      target_tenant: string | null;
      details: string;
      timestamp: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      actor: row.actor,
      target_tenant: row.target_tenant,
      details: JSON.parse(row.details) as Record<string, unknown>,
      timestamp: row.timestamp,
    }));
  }

  /**
   * Limpia recursos. Desvincula la referencia a la base de datos.
   */
  dispose(): void {
    this.db = null;
    log.info("AuditLogger disposed");
  }
}

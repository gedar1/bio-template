import Database from "better-sqlite3";
import { HealthServer } from "../HealthServer.js";
import { checkRole } from "../middleware/roleMiddleware.js";
import type { TenantManager } from "../TenantManager.js";
import type { MutationEvent } from "../types/dashboard.js";
import { createLogger } from "../../config/logger.js";

const log = createLogger("MutationRoutes");

/**
 * Rutas de mutaciones: historial de mutaciones y trigger manual.
 * Usa una tabla SQLite dedicada para persistir el historial.
 */
export function setupMutationRoutes(
  health: HealthServer,
  tenantManager: TenantManager,
  dbPath: string = process.env.DATABASE_PATH || "./biocore.db",
): void {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  // Crear tabla de historial de mutaciones
  db.exec(`
    CREATE TABLE IF NOT EXISTS mutation_history (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id       TEXT    NOT NULL DEFAULT 'default',
      from_type       TEXT    NOT NULL,
      to_type         TEXT    NOT NULL,
      stimulus_source TEXT    NOT NULL,
      trigger_reason  TEXT    NOT NULL,
      timestamp       INTEGER NOT NULL
    )
  `);

  log.info("Tabla mutation_history inicializada");

  const insertStmt = db.prepare(`
    INSERT INTO mutation_history (tenant_id, from_type, to_type, stimulus_source, trigger_reason, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const selectStmt = db.prepare(`
    SELECT id, tenant_id as tenantId, from_type as fromType, to_type as toType,
           stimulus_source as stimulusSource, trigger_reason as triggerReason, timestamp
    FROM mutation_history
    WHERE tenant_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `);

  health.registerData("mutations", async (body?: Record<string, unknown>) => {
    const tenantId = (body?.tenantId as string) || "default";
    const limit = (body?.limit as number) || 50;

    try {
      const mutations = selectStmt.all(tenantId, limit) as MutationEvent[];
      return { mutations, total: mutations.length };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ error: message }, "Error consultando mutation_history");
      return { error: "Internal error" };
    }
  });

  health.registerData(
    "mutations/trigger",
    async (body?: Record<string, unknown>) => {
      const roleError = checkRole("admin");
      if (roleError) return roleError;

      const tenantId = (body?.tenantId as string) || "default";
      const targetType = body?.targetType as string | undefined;

      if (!targetType) {
        return { error: "targetType requerido" };
      }

      try {
        const tenant = await tenantManager.getTenant(tenantId);
        const currentType = "undifferentiated"; // Default before mutation

        // Registrar la mutación en el historial
        insertStmt.run(
          tenantId,
          currentType,
          targetType,
          "dashboard",
          "Manual trigger from dashboard",
          Date.now(),
        );

        // Ejecutar la mutación via chat (stimulate_differentiation)
        const message = `Diferénciate a tipo ${targetType}`;
        const response = await tenantManager.chat(tenantId, message);

        log.info(
          { tenantId, targetType },
          "Mutación disparada desde dashboard",
        );

        return {
          triggered: true,
          tenantId,
          targetType,
          response,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.error(
          { error: message, tenantId, targetType },
          "Error disparando mutación",
        );
        return { error: "Internal error" };
      }
    },
  );

  /**
   * Registra una mutación en el historial.
   * Puede ser llamado internamente por otros componentes.
   */
  health.registerData(
    "mutations/record",
    async (body?: Record<string, unknown>) => {
      const tenantId = (body?.tenantId as string) || "default";
      const fromType = body?.fromType as string;
      const toType = body?.toType as string;
      const stimulusSource = (body?.stimulusSource as string) || "system";
      const triggerReason = (body?.triggerReason as string) || "Unknown";

      if (!fromType || !toType) {
        return { error: "fromType y toType requeridos" };
      }

      try {
        const result = insertStmt.run(
          tenantId,
          fromType,
          toType,
          stimulusSource,
          triggerReason,
          Date.now(),
        );
        return { recorded: true, id: result.lastInsertRowid };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ error: message }, "Error registrando mutación");
        return { error: "Internal error" };
      }
    },
  );
}

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createLogger } from "../config/logger.js";

const log = createLogger("TemplateStateStore");

/**
 * TemplateStateStore — Persistencia del estado enabled/disabled de templates en SQLite.
 *
 * Usa la base de datos compartida (biocore-shared.db) para almacenar el estado
 * de habilitación de cada template. Los templates no registrados se consideran
 * habilitados por defecto.
 *
 * Schema:
 *   template_state (
 *     template_id TEXT PRIMARY KEY,
 *     enabled INTEGER NOT NULL DEFAULT 1,
 *     updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
 *   )
 */
export class TemplateStateStore {
  private readonly db: InstanceType<typeof Database>;

  constructor(dbPath?: string) {
    const resolvedPath =
      dbPath || process.env.DATABASE_PATH || "./data/biocore-shared.db";

    // Ensure directory exists
    const dir = dirname(resolvedPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      log.info({ dir }, "Directorio de datos creado para TemplateStateStore");
    }

    this.db = new Database(resolvedPath);
    this.db.pragma("journal_mode = WAL");

    this.initializeTable();
    log.info({ dbPath: resolvedPath }, "TemplateStateStore inicializado");
  }

  private initializeTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS template_state (
        template_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      )
    `);
  }

  /**
   * Obtiene el estado de un template.
   * Si el template no tiene estado persistido, retorna true (habilitado por defecto).
   */
  isEnabled(templateId: string): boolean {
    const stmt = this.db.prepare(
      "SELECT enabled FROM template_state WHERE template_id = ?",
    );
    const row = stmt.get(templateId) as { enabled: number } | undefined;

    if (row === undefined) {
      return true; // Default: enabled
    }

    return row.enabled === 1;
  }

  /**
   * Cambia el estado de un template.
   * Inserta o actualiza el registro en la tabla.
   */
  setEnabled(templateId: string, enabled: boolean): void {
    const stmt = this.db.prepare(`
      INSERT INTO template_state (template_id, enabled, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(template_id) DO UPDATE SET
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `);

    const now = Math.floor(Date.now() / 1000);
    stmt.run(templateId, enabled ? 1 : 0, now);

    log.debug({ templateId, enabled }, "Estado de template actualizado");
  }

  /**
   * Obtiene todos los estados persistidos como un mapa.
   * Solo retorna templates que tienen un estado explícitamente guardado.
   * Templates sin estado persistido no aparecen (se asumen habilitados).
   */
  getAllStates(): Map<string, boolean> {
    const stmt = this.db.prepare(
      "SELECT template_id, enabled FROM template_state",
    );
    const rows = stmt.all() as Array<{ template_id: string; enabled: number }>;

    const states = new Map<string, boolean>();
    for (const row of rows) {
      states.set(row.template_id, row.enabled === 1);
    }

    return states;
  }

  /**
   * Cierra la conexión a la base de datos.
   * Útil para tests y shutdown graceful.
   */
  close(): void {
    this.db.close();
    log.debug("TemplateStateStore cerrado");
  }
}

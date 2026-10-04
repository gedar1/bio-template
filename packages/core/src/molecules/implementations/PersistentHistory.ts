import Database from "better-sqlite3";
import { createLogger } from "../../config/logger.js";
import type { HistoryEntry } from "../HistoryMolecule.js";
import type { MolecularGen } from "../MolecularGen.js";

const log = createLogger("PersistentHistory");

/**
 * Historial de sesión persistido en SQLite.
 * Reemplaza HistoryMolecule (en memoria) para producción.
 * Misma API, pero sobrevive reinicios del proceso.
 */
export class PersistentHistory implements MolecularGen {
  readonly db: Database.Database;

  constructor(dbPath: string = process.env.DATABASE_PATH || "./biocore.db") {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initTable();
    log.info({ path: dbPath }, "Historial persistente inicializado");
  }

  private initTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_history_session ON history(session_id)
    `);
  }

  create(sessionId: string, data: HistoryEntry): boolean {
    try {
      this.db
        .prepare(
          "INSERT INTO history (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
        )
        .run(sessionId, data.role, data.content, data.timestamp || Date.now());
      return true;
    } catch (error: any) {
      log.error({ error: error.message }, "Error creando entrada");
      return false;
    }
  }

  read(sessionId: string): HistoryEntry[] | null {
    const rows = this.db
      .prepare(
        "SELECT role, content, timestamp FROM history WHERE session_id = ? ORDER BY id ASC",
      )
      .all(sessionId) as HistoryEntry[];
    return rows.length > 0 ? rows : null;
  }

  update(sessionId: string, data: HistoryEntry[]): boolean {
    try {
      const tx = this.db.transaction(() => {
        this.db
          .prepare("DELETE FROM history WHERE session_id = ?")
          .run(sessionId);
        const insert = this.db.prepare(
          "INSERT INTO history (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
        );
        for (const entry of data) {
          insert.run(sessionId, entry.role, entry.content, entry.timestamp);
        }
      });
      tx();
      return true;
    } catch (error: any) {
      log.error({ error: error.message }, "Error actualizando historial");
      return false;
    }
  }

  delete(sessionId: string): boolean {
    const result = this.db
      .prepare("DELETE FROM history WHERE session_id = ?")
      .run(sessionId);
    return result.changes > 0;
  }

  toMessages(sessionId: string): Array<{ role: string; content: string }> {
    const history = this.read(sessionId);
    if (!history) return [];
    return history.map((entry) => ({
      role: entry.role,
      content: entry.content,
    }));
  }

  size(sessionId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM history WHERE session_id = ?")
      .get(sessionId) as { count: number };
    return row.count;
  }

  compress(
    sessionId: string,
    keepLast: number = 10,
    maxSize: number = 20,
  ): boolean {
    const currentSize = this.size(sessionId);
    if (currentSize <= maxSize) return false;

    const all = this.read(sessionId);
    if (!all) return false;

    const systemMsgs = all.filter((h) => h.role === "system");
    const nonSystem = all.filter((h) => h.role !== "system");
    const toCompress = nonSystem.slice(0, nonSystem.length - keepLast);
    const toKeep = nonSystem.slice(-keepLast);

    const summary: HistoryEntry = {
      role: "system",
      content:
        `[Contexto comprimido: ${toCompress.length} mensajes anteriores] ` +
        toCompress
          .filter((m) => m.role === "assistant")
          .slice(-3)
          .map((m) => m.content.substring(0, 100))
          .join(" | "),
      timestamp: Date.now(),
    };

    return this.update(sessionId, [...systemMsgs, summary, ...toKeep]);
  }

  /**
   * Comprime el historial usando una función de resumen provista externamente (ej: un LLM).
   * La persistencia en SQLite ocurre en una transacción atómica.
   *
   * @param sessionId ID de la sesión
   * @param summaryFn Función async que recibe los mensajes a comprimir y retorna un resumen
   * @param keepLast Número de mensajes recientes a conservar sin comprimir (default: 10)
   * @param maxSize Umbral para activar la compresión (default: 20)
   */
  async compressWithSummary(
    sessionId: string,
    summaryFn: (messages: HistoryEntry[]) => Promise<string>,
    keepLast: number = 10,
    maxSize: number = 20,
  ): Promise<boolean> {
    const currentSize = this.size(sessionId);
    if (currentSize <= maxSize) return false;

    const all = this.read(sessionId);
    if (!all) return false;

    const systemMsgs = all.filter((h) => h.role === "system");
    const nonSystem = all.filter((h) => h.role !== "system");
    const toCompress = nonSystem.slice(0, nonSystem.length - keepLast);
    const toKeep = nonSystem.slice(-keepLast);

    const summaryText = await summaryFn(toCompress);

    const summary: HistoryEntry = {
      role: "system",
      content: `[Resumen de contexto anterior — ${toCompress.length} mensajes]: ${summaryText}`,
      timestamp: Date.now(),
    };

    return this.update(sessionId, [...systemMsgs, summary, ...toKeep]);
  }

  /** Lista todas las sesiones activas */
  listSessions(): string[] {
    const rows = this.db
      .prepare("SELECT DISTINCT session_id FROM history")
      .all() as Array<{ session_id: string }>;
    return rows.map((r) => r.session_id);
  }

  close(): void {
    this.db.close();
    log.info("Historial persistente cerrado");
  }
}

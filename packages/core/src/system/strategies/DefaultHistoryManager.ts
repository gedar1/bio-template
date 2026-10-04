import { HistoryMolecule } from "../../molecules/HistoryMolecule.js";
import { createLogger } from "../../config/logger.js";
import type { ILogger } from "../../config/ILogger.js";
import type { HistoryEntry } from "../../molecules/HistoryMolecule.js";
import type { IHistoryManager } from "./IHistoryManager.js";

/**
 * Implementación por defecto de IHistoryManager.
 *
 * Envuelve una `HistoryMolecule` (composición) preservando el comportamiento
 * de creación de sesiones, registro de mensajes y compresión de contexto.
 *
 * Si se configura un summarizer vía `setSummarizer`, `compress` usa
 * `compressWithSummary` (resumen real del LLM); en caso contrario cae al
 * `compress` estático. Acepta un `HistoryMolecule` y un `ILogger` opcionales
 * vía constructor con fallbacks por defecto.
 */
export class DefaultHistoryManager implements IHistoryManager {
  private readonly history: HistoryMolecule;
  private readonly log: ILogger;
  private summarizer?: (messages: HistoryEntry[]) => Promise<string>;

  constructor(history?: HistoryMolecule, logger?: ILogger) {
    this.history = history ?? new HistoryMolecule();
    this.log = logger ?? createLogger("HistoryManager");
  }

  /** Expone la HistoryMolecule subyacente para colaboradores acoplados. */
  get molecule(): HistoryMolecule {
    return this.history;
  }

  createSession(sessionId: string, systemMessage: string): void {
    this.history.create(sessionId, {
      role: "system",
      content: systemMessage,
      timestamp: Date.now(),
    });
  }

  getHistory(sessionId: string): Array<{ role: string; content: string }> {
    return this.history.toMessages(sessionId);
  }

  addMessage(sessionId: string, entry: HistoryEntry): void {
    this.history.create(sessionId, entry);
  }

  setSummarizer(fn: (messages: HistoryEntry[]) => Promise<string>): void {
    this.summarizer = fn;
  }

  async compress(sessionId: string): Promise<boolean> {
    if (this.summarizer) {
      return this.history.compressWithSummary(sessionId, this.summarizer);
    }
    return this.history.compress(sessionId);
  }

  size(sessionId: string): number {
    return this.history.size(sessionId);
  }
}

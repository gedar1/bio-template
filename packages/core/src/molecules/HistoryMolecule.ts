import { MolecularGen } from "./MolecularGen.js";

export interface HistoryEntry {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

/**
 * Molécula de Historial de Sesión.
 * Implementa MolecularGen (CRUD) para mantener el contexto de conversación
 * entre múltiples llamadas al LLM dentro de la misma sesión del Orquestador.
 */
export class HistoryMolecule implements MolecularGen {
  readonly sessions: Map<string, HistoryEntry[]> = new Map();

  /** Create: Inicia o añade una nueva entrada al historial de una sesión */
  create(sessionId: string, data: HistoryEntry): boolean {
    try {
      const existing = this.sessions.get(sessionId) ?? [];
      existing.push({ ...data, timestamp: Date.now() });
      this.sessions.set(sessionId, existing);
      return true;
    } catch {
      return false;
    }
  }

  /** Read: Devuelve el historial completo de una sesión */
  read(sessionId: string): HistoryEntry[] | null {
    return this.sessions.get(sessionId) ?? null;
  }

  /** Update: Reemplaza el historial de una sesión completo (ej: tras comprimir contexto) */
  update(sessionId: string, data: HistoryEntry[]): boolean {
    try {
      this.sessions.set(sessionId, data);
      return true;
    } catch {
      return false;
    }
  }

  /** Delete: Cierra y elimina la sesión del orquestador */
  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * Convierte el historial al formato de mensajes que esperan los LLMs (OpenAI/Anthropic).
   * Útil para pasarle directamente al cliente de la API del LLM.
   */
  toMessages(sessionId: string): Array<{ role: string; content: string }> {
    const history = this.read(sessionId);
    if (!history) return [];
    return history.map((entry) => ({
      role: entry.role,
      content: entry.content,
    }));
  }

  /**
   * Retorna el número de mensajes en la sesión actual.
   * Útil para decidir si comprimir el contexto antes de la siguiente llamada al LLM.
   */
  size(sessionId: string): number {
    return this.read(sessionId)?.length ?? 0;
  }

  /**
   * Comprime el historial manteniendo el mensaje system inicial y los últimos N mensajes.
   * Los mensajes intermedios se resumen en una sola entrada.
   * Evita que el context window del LLM explote en conversaciones largas.
   *
   * @param sessionId ID de la sesión
   * @param keepLast Número de mensajes recientes a mantener (default: 10)
   * @param maxSize Tamaño máximo antes de comprimir (default: 20)
   * @returns true si se comprimió, false si no era necesario
   */
  compress(sessionId: string, keepLast: number = 10, maxSize: number = 20): boolean {
    const history = this.read(sessionId);
    if (!history || history.length <= maxSize) return false;

    // Separar mensaje system (si existe) del resto
    const systemMsgs = history.filter(h => h.role === "system");
    const nonSystem = history.filter(h => h.role !== "system");

    // Mensajes a comprimir vs mantener
    const toCompress = nonSystem.slice(0, nonSystem.length - keepLast);
    const toKeep = nonSystem.slice(-keepLast);

    // Generar resumen de los mensajes comprimidos
    const summary: HistoryEntry = {
      role: "system",
      content: `[Contexto comprimido: ${toCompress.length} mensajes anteriores resumidos] ` +
        toCompress
          .filter(m => m.role === "assistant")
          .slice(-3)
          .map(m => m.content.substring(0, 100))
          .join(" | "),
      timestamp: Date.now(),
    };

    const compressed = [...systemMsgs, summary, ...toKeep];
    this.update(sessionId, compressed);
    return true;
  }

  /**
   * Comprime el historial usando una función de resumen provista externamente (ej: un LLM).
   * La molécula permanece pura — no conoce el LLM, solo invoca el callback.
   *
   * @param sessionId ID de la sesión
   * @param summaryFn Función async que recibe los mensajes a comprimir y retorna un resumen
   * @param keepLast Número de mensajes recientes a conservar sin comprimir (default: 10)
   * @param maxSize Umbral para activar la compresión (default: 20)
   * @returns true si se comprimió, false si no era necesario
   *
   * @example
   * await history.compressWithSummary(sessionId, async (msgs) => {
   *   const res = await anthropic.messages.create({ ... });
   *   return res.content[0].text;
   * });
   */
  async compressWithSummary(
    sessionId: string,
    summaryFn: (messages: HistoryEntry[]) => Promise<string>,
    keepLast: number = 10,
    maxSize: number = 20,
  ): Promise<boolean> {
    const history = this.read(sessionId);
    if (!history || history.length <= maxSize) return false;

    const systemMsgs = history.filter(h => h.role === "system");
    const nonSystem = history.filter(h => h.role !== "system");

    const toCompress = nonSystem.slice(0, nonSystem.length - keepLast);
    const toKeep = nonSystem.slice(-keepLast);

    const summaryText = await summaryFn(toCompress);

    const summary: HistoryEntry = {
      role: "system",
      content: `[Resumen de contexto anterior — ${toCompress.length} mensajes]: ${summaryText}`,
      timestamp: Date.now(),
    };

    this.update(sessionId, [...systemMsgs, summary, ...toKeep]);
    return true;
  }
}

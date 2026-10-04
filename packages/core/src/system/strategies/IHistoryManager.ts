import type { HistoryEntry } from "../../molecules/HistoryMolecule.js";

/**
 * Strategy interface for conversation history management.
 *
 * Encapsula la creación de sesiones, el registro de mensajes y la
 * compresión de contexto para evitar que el context window del LLM explote.
 */
export interface IHistoryManager {
  /**
   * Inicia una nueva sesión con su mensaje system.
   *
   * @param sessionId     - Identificador único de la sesión
   * @param systemMessage - Mensaje system inicial de la conversación
   */
  createSession(sessionId: string, systemMessage: string): void;

  /**
   * Devuelve el historial de la sesión en formato de mensajes LLM.
   *
   * @param sessionId - Identificador de la sesión
   * @returns Lista de mensajes con role y content
   */
  getHistory(sessionId: string): Array<{ role: string; content: string }>;

  /**
   * Añade una entrada al historial de la sesión.
   *
   * @param sessionId - Identificador de la sesión
   * @param entry     - Entrada de historial a agregar
   */
  addMessage(sessionId: string, entry: HistoryEntry): void;

  /**
   * Configura la función de resumen usada al comprimir el contexto.
   *
   * @param fn - Función async que resume una lista de mensajes
   */
  setSummarizer(fn: (messages: HistoryEntry[]) => Promise<string>): void;

  /**
   * Comprime el historial de la sesión si supera el umbral configurado.
   *
   * @param sessionId - Identificador de la sesión
   * @returns true si se comprimió, false si no era necesario
   */
  compress(sessionId: string): Promise<boolean>;

  /**
   * Retorna el número de mensajes en la sesión.
   *
   * @param sessionId - Identificador de la sesión
   */
  size(sessionId: string): number;
}

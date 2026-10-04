/**
 * Resumen agregado de métricas de rendimiento por operación.
 *
 * Cada clave es el nombre de una operación medida, con estadísticas
 * de conteo y latencia (promedio, mínimo y máximo en milisegundos).
 */
export interface PerfSummary {
  [operation: string]: {
    count: number;
    avgMs: number;
    minMs: number;
    maxMs: number;
  };
}

/**
 * Strategy interface for performance tracking.
 *
 * Encapsula la medición de operaciones y el registro de métricas
 * relacionadas con reflexes (queries, degradaciones y ahorro de tokens).
 */
export interface IPerfTracker {
  /** Devuelve el resumen agregado de todas las operaciones medidas. */
  summary(): PerfSummary;

  /**
   * Mide la duración de una operación async y registra su latencia.
   *
   * @param operation - Nombre de la operación
   * @param fn        - Función async a medir
   * @param metadata  - Metadatos opcionales asociados a la medición
   * @returns El resultado de la función medida
   */
  measure<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: Record<string, any>,
  ): Promise<T>;

  /**
   * Registra una consulta de reflex y su modo de resolución.
   *
   * @param mode       - "reflex" (directo), "hint" (contexto) o "miss" (sin match)
   * @param similarity - Similitud opcional del match encontrado
   */
  recordReflexQuery(
    mode: "reflex" | "hint" | "miss",
    similarity?: number,
  ): void;

  /**
   * Registra una degradación de reflex a modo hint o miss.
   *
   * @param reason - Motivo de la degradación
   */
  recordDegradation(reason: string): void;

  /**
   * Registra el ahorro de tokens estimado al reutilizar un reflex.
   *
   * @param stepCount - Número de pasos ejecutados sin invocar al LLM
   */
  recordTokenSavings(stepCount: number): void;

  /** Devuelve las métricas agregadas de reflexes. */
  getReflexMetrics(): Record<string, unknown>;
}

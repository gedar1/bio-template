import { createLogger } from "../config/logger.js";

const log = createLogger("PerfMonitor");

export interface PerfEntry {
  operation: string;
  durationMs: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

/** Metrics for the Reflex Memory System */
export interface ReflexMetrics {
  /** Total reflex queries performed */
  queryCount: number;
  /** Queries that resulted in REFLEX mode */
  reflexHitCount: number;
  /** Queries that resulted in HINT mode */
  hintCount: number;
  /** Queries with no match */
  missCount: number;
  /** REFLEX executions that degraded (to HINT or full LLM) */
  degradationCount: number;
  /** Degradation reasons breakdown */
  degradationReasons: Record<string, number>;
  /** Total reflexes stored in DB */
  totalReflexes: number;
  /** Similarity scores of best matches (for distribution analysis) */
  similarityScores: number[];
  /** Estimated tokens saved (steps × avg_tokens_per_step) */
  estimatedTokensSaved: number;
}

/**
 * Monitor de performance por capa.
 * Registra tiempos de ejecución de operaciones clave (mutación, LLM, herramientas).
 */
export class PerfMonitor {
  private entries: PerfEntry[] = [];
  private readonly maxEntries: number;

  /** Internal reflex metrics counters */
  readonly _reflexMetrics: ReflexMetrics = {
    queryCount: 0,
    reflexHitCount: 0,
    hintCount: 0,
    missCount: 0,
    degradationCount: 0,
    degradationReasons: {},
    totalReflexes: 0,
    similarityScores: [],
    estimatedTokensSaved: 0,
  };

  constructor(maxEntries: number = 1000) {
    this.maxEntries = maxEntries;
  }

  /**
   * Mide el tiempo de ejecución de una función async.
   */
  async measure<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: Record<string, any>,
  ): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      const durationMs = Math.round(performance.now() - start);
      this.record(operation, durationMs, metadata);
      return result;
    } catch (error) {
      const durationMs = Math.round(performance.now() - start);
      this.record(operation, durationMs, { ...metadata, error: true });
      throw error;
    }
  }

  private record(
    operation: string,
    durationMs: number,
    metadata?: Record<string, any>,
  ): void {
    const entry: PerfEntry = {
      operation,
      durationMs,
      timestamp: Date.now(),
      metadata,
    };
    this.entries.push(entry);

    // Evitar memory leak
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    log.debug({ operation, durationMs, ...metadata }, "Métrica registrada");
  }

  /** Obtiene todas las métricas de una operación */
  getByOperation(operation: string): PerfEntry[] {
    return this.entries.filter((e) => e.operation === operation);
  }

  /** Promedio de duración de una operación */
  average(operation: string): number {
    const ops = this.getByOperation(operation);
    if (ops.length === 0) return 0;
    return Math.round(
      ops.reduce((sum, e) => sum + e.durationMs, 0) / ops.length,
    );
  }

  /** Resumen de todas las operaciones registradas */
  summary(): Record<
    string,
    { count: number; avgMs: number; minMs: number; maxMs: number }
  > {
    const ops = new Map<string, number[]>();
    for (const entry of this.entries) {
      const list = ops.get(entry.operation) || [];
      list.push(entry.durationMs);
      ops.set(entry.operation, list);
    }

    const result: Record<
      string,
      { count: number; avgMs: number; minMs: number; maxMs: number }
    > = {};
    for (const [op, durations] of ops) {
      result[op] = {
        count: durations.length,
        avgMs: Math.round(
          durations.reduce((a, b) => a + b, 0) / durations.length,
        ),
        minMs: Math.min(...durations),
        maxMs: Math.max(...durations),
      };
    }
    return result;
  }

  /** Limpia todas las métricas */
  reset(): void {
    this.entries = [];
  }

  // ─── Reflex Metrics Methods ─────────────────────────────────────────────────

  /**
   * Records a reflex query result.
   * @param mode - The result mode: "reflex", "hint", or "miss"
   * @param similarity - The similarity score of the best match (if any)
   */
  recordReflexQuery(
    mode: "reflex" | "hint" | "miss",
    similarity?: number,
  ): void {
    this._reflexMetrics.queryCount++;

    switch (mode) {
      case "reflex":
        this._reflexMetrics.reflexHitCount++;
        break;
      case "hint":
        this._reflexMetrics.hintCount++;
        break;
      case "miss":
        this._reflexMetrics.missCount++;
        break;
    }

    if (similarity !== undefined) {
      this._reflexMetrics.similarityScores.push(similarity);
    }

    log.debug({ mode, similarity }, "Reflex query recorded");
  }

  /**
   * Records a degradation event when a reflex execution fails.
   * @param reason - The reason for degradation
   */
  recordDegradation(
    reason: "missing_params" | "schema_mismatch" | "execution_failure",
  ): void {
    this._reflexMetrics.degradationCount++;
    this._reflexMetrics.degradationReasons[reason] =
      (this._reflexMetrics.degradationReasons[reason] || 0) + 1;

    log.debug({ reason }, "Reflex degradation recorded");
  }

  /**
   * Records estimated token savings from a successful reflex execution.
   * Estimates ~500 tokens per step (rough average for an LLM tool call round-trip).
   * @param stepCount - Number of steps executed via reflex
   */
  recordTokenSavings(stepCount: number): void {
    const tokensPerStep = 500;
    this._reflexMetrics.estimatedTokensSaved += stepCount * tokensPerStep;

    log.debug(
      { stepCount, tokensSaved: stepCount * tokensPerStep },
      "Token savings recorded",
    );
  }

  /**
   * Returns the current reflex metrics snapshot.
   */
  getReflexMetrics(): ReflexMetrics {
    return {
      ...this._reflexMetrics,
      degradationReasons: { ...this._reflexMetrics.degradationReasons },
      similarityScores: [...this._reflexMetrics.similarityScores],
    };
  }
}

import { PerfMonitor } from "../../infrastructure/PerfMonitor.js";
import { createLogger } from "../../config/logger.js";
import type { ILogger } from "../../config/ILogger.js";
import type { IPerfTracker, PerfSummary } from "./IPerfTracker.js";

/**
 * Implementación por defecto de IPerfTracker.
 *
 * Envuelve un `PerfMonitor` existente (composición) para preservar el
 * comportamiento actual del sistema. El `PerfMonitor` subyacente sigue
 * disponible vía `monitor` para los colaboradores que aún lo requieren
 * directamente (p.ej. `ReflexMolecule`).
 *
 * Acepta un `PerfMonitor` y un `ILogger` opcionales vía constructor con
 * fallbacks por defecto, habilitando inyección de dependencias en tests.
 */
export class DefaultPerfTracker implements IPerfTracker {
  private readonly perf: PerfMonitor;
  private readonly log: ILogger;

  constructor(perf?: PerfMonitor, logger?: ILogger) {
    this.perf = perf ?? new PerfMonitor();
    this.log = logger ?? createLogger("PerfTracker");
  }

  /** Expone el PerfMonitor subyacente para colaboradores acoplados (ReflexMolecule). */
  get monitor(): PerfMonitor {
    return this.perf;
  }

  summary(): PerfSummary {
    return this.perf.summary();
  }

  measure<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: Record<string, any>,
  ): Promise<T> {
    return this.perf.measure(operation, fn, metadata);
  }

  recordReflexQuery(
    mode: "reflex" | "hint" | "miss",
    similarity?: number,
  ): void {
    this.perf.recordReflexQuery(mode, similarity);
  }

  recordDegradation(reason: string): void {
    // PerfMonitor tipa el motivo de forma estrecha; se preserva el contrato
    // amplio de IPerfTracker delegando con un cast controlado.
    this.perf.recordDegradation(
      reason as "missing_params" | "schema_mismatch" | "execution_failure",
    );
  }

  recordTokenSavings(stepCount: number): void {
    this.perf.recordTokenSavings(stepCount);
  }

  getReflexMetrics(): Record<string, unknown> {
    return this.perf.getReflexMetrics() as unknown as Record<string, unknown>;
  }
}

import { createLogger } from "../../config/logger.js";
import type { ILogger } from "../../config/ILogger.js";
import { buildJevToolCatalog } from "../../config/toolCatalog.js";
import {
  ReflexMolecule,
  type ReflexStep,
  type ReflexMatch,
} from "../../molecules/ReflexMolecule.js";
import type { IPerfTracker } from "./IPerfTracker.js";
import type { IReflexExecutor } from "./IReflexExecutor.js";

/**
 * Implementación por defecto de IReflexExecutor.
 *
 * Consulta la sugerencia de Jev sobre tools.json filtrado por células, registra
 * los pasos de la sesión y guarda la secuencia como historial.
 */
export class DefaultReflexExecutor implements IReflexExecutor {
  private readonly reflex: ReflexMolecule;
  private readonly perf: IPerfTracker;
  private readonly log: ILogger;

  /** Pasos acumulados en la sesión actual (se resetean al llamar saveReflex). */
  private _currentSteps: ReflexStep[] = [];
  /** Input del usuario de la sesión actual (para generar el embedding). */
  private _currentInput: string = "";

  constructor(reflex?: ReflexMolecule, perf?: IPerfTracker, logger?: ILogger) {
    this.log = logger ?? createLogger("ReflexExecutor");
    this.perf = perf as IPerfTracker;
    // ReflexMolecule requiere un PerfMonitor concreto; si se inyecta un
    // IPerfTracker que expone `monitor`, se usa; en otro caso ReflexMolecule
    // crea el suyo por defecto.
    const perfMonitor = (perf as any)?.monitor;
    this.reflex = reflex ?? new ReflexMolecule(undefined, perfMonitor);
  }

  async initialize(): Promise<void> {
    await this.reflex.initialize();
  }

  trackInput(input: string): void {
    this._currentInput = input;
    this._currentSteps = [];
  }

  recordStep(step: ReflexStep, _args: Record<string, unknown>): void {
    this._currentSteps.push(step);
  }

  async queryReflex(
    input: string,
    allowedCells: readonly string[] = [],
  ): Promise<ReflexMatch | null> {
    try {
      // Jev elige sobre tools.json filtrado por las células permitidas (no sobre reflexes guardados).
      const catalog = buildJevToolCatalog(allowedCells);
      if (Object.keys(catalog).length === 0) {
        return null;
      }

      const { jevEvaluateAll } = await import("../../atoms/reflexSelector.js");
      const selection = await jevEvaluateAll(input, catalog);

      if (!selection) {
        this.log.debug("Jev no sugirió cadena para el input");
        return null;
      }

      // La sugerencia de Jev no trae pasos reutilizables, así que nunca es modo "reflex".
      const match: ReflexMatch = {
        record: selection.record,
        similarity: selection.confidence,
        compositeScore: selection.confidence,
        mode: "hint",
      };

      this.log.debug("Cadena sugerida por Jev desde tools.json", {
        sequence: selection.record.sequence,
        confidence: selection.confidence,
        toolCount: Object.keys(catalog).length,
      });

      return match;
    } catch (err: any) {
      this.log.warn("Reflex query failed", { error: err.message });
      return null;
    }
  }

  async saveReflex(): Promise<void> {
    if (this._currentSteps.length === 0 || !this._currentInput) return;
    try {
      this.reflex.save(this._currentInput, this._currentSteps);
      this.log.debug("Reflex guardado", {
        steps: this._currentSteps.length,
        input: this._currentInput.substring(0, 60),
      });
    } catch (err: any) {
      this.log.warn("No se pudo guardar reflex", { error: err.message });
    } finally {
      this._currentSteps = [];
    }
  }
}

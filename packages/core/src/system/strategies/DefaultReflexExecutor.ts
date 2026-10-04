import { createLogger } from "../../config/logger.js";
import {
  computeEmbedding,
  normalizeForEmbedding,
  extractParamsForReflex,
  deriveTemplate,
  interpolateTemplate,
  extractParamsFromText,
} from "../../atoms/index.js";
import type { ReflexArgTemplates } from "../../atoms/index.js";
import type { ILogger } from "../../config/ILogger.js";
import {
  ReflexMolecule,
  type ReflexStep,
  type ReflexMatch,
} from "../../molecules/ReflexMolecule.js";
import type { IPerfTracker } from "./IPerfTracker.js";
import type {
  IReflexExecutor,
  ReflexCollaborators,
} from "./IReflexExecutor.js";

/**
 * Implementación por defecto de IReflexExecutor.
 *
 * Contiene la lógica de memoria refleja extraída del BaseOrchestrator:
 * consulta, ejecución directa (sin LLM), persistencia y versionado de
 * esquemas. Preserva el comportamiento exacto del sistema; las diferencias
 * son puramente de ubicación (estrategia inyectable en vez de método inline).
 *
 * Acepta un `IPerfTracker` y un `ILogger` opcionales vía constructor con
 * fallbacks por defecto.
 */
export class DefaultReflexExecutor implements IReflexExecutor {
  private readonly reflex: ReflexMolecule;
  private readonly perf: IPerfTracker;
  private readonly log: ILogger;

  /** Pasos acumulados en la sesión actual (se resetean al llamar saveReflex). */
  private _currentSteps: ReflexStep[] = [];
  /** Args usados en cada paso de la sesión actual (paralelo a _currentSteps). */
  private _currentStepArgs: Record<string, unknown>[] = [];
  /** Input del usuario de la sesión actual (para generar el embedding). */
  private _currentInput: string = "";

  /** Mapa de nombre de herramienta → versión de esquema. */
  readonly toolVersionMap: Map<string, string> = new Map();

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
    this._currentStepArgs = [];
  }

  recordStep(step: ReflexStep, args: Record<string, unknown>): void {
    this._currentSteps.push(step);
    this._currentStepArgs.push(args ?? {});
  }

  async queryReflex(input: string): Promise<ReflexMatch | null> {
    try {
      const normalized = normalizeForEmbedding(input);
      const embedding = await computeEmbedding(normalized);
      return this.reflex.findSimilar(embedding);
    } catch (err: any) {
      this.log.warn("No se pudo consultar reflex", { error: err.message });
      return null;
    }
  }

  async saveReflex(): Promise<void> {
    if (this._currentSteps.length === 0 || !this._currentInput) return;
    try {
      const normalized = normalizeForEmbedding(this._currentInput);
      const embedding = await computeEmbedding(normalized);

      const argTemplates: ReflexArgTemplates = this._currentStepArgs.map(
        (args) => deriveTemplate(args as Record<string, unknown>),
      );

      const schemaVersions = this.getSchemaVersions(this._currentSteps);

      this.reflex.save(
        this._currentInput,
        this._currentSteps,
        embedding,
        argTemplates,
        schemaVersions,
      );
      this.log.debug("Reflex guardado", {
        steps: this._currentSteps.length,
        input: this._currentInput.substring(0, 60),
      });
    } catch (err: any) {
      this.log.warn("No se pudo guardar reflex", { error: err.message });
    } finally {
      this._currentSteps = [];
      this._currentStepArgs = [];
    }
  }

  async executeReflex(
    match: ReflexMatch,
    args: Record<string, Record<string, unknown>>,
    collaborators: ReflexCollaborators,
  ): Promise<string[]> {
    const { routeStimulus, executeAction } = collaborators;
    args = args ?? {};
    const results: string[] = [];

    // Skip schema check for reflexes that include mutation steps — the
    // mutations will load the required tools dynamically during execution.
    const hasMutationSteps = match.record.steps.some((s) =>
      s.action.startsWith("mutate:"),
    );

    if (match.record.schemaVersions && !hasMutationSteps) {
      const versionCheck = this.checkSchemaVersions(
        match.record.schemaVersions,
        this.toolVersionMap,
      );
      if (!versionCheck.compatible) {
        this.log.warn("Schema version mismatch — degrading to hint", {
          reflexId: match.record.id,
          mismatches: versionCheck.mismatches,
        });
        this.perf.recordDegradation("schema_mismatch");
        throw new Error(
          `Schema version mismatch for reflex ${match.record.id}: ${versionCheck.mismatches
            .map((m) => `${m.tool} (stored=${m.stored}, current=${m.current})`)
            .join(", ")}`,
        );
      }
    }

    // Attempt template-based interpolation if arg templates are available
    let interpolatedArgs: Record<string, Record<string, unknown>> = {};

    if (match.record.argTemplates && match.record.argTemplates.length > 0) {
      const extractedParams = this._currentInput
        ? extractParamsFromText(this._currentInput)
        : {};

      const steps = match.record.steps;
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const template = match.record.argTemplates[i];
        if (!template || step.action.startsWith("mutate:")) continue;

        const resolved = interpolateTemplate(template, extractedParams);
        if (resolved === null) {
          this.log.warn(
            "Template interpolation failed (missing required params) — degrading to hint",
            { step: step.action, reflexId: match.record.id },
          );
          this.perf.recordDegradation("missing_params");
          throw new Error(
            `Template interpolation failed for step '${step.action}': missing required parameters`,
          );
        }
        interpolatedArgs[step.action] = resolved;
      }
    } else {
      const toolNames = match.record.steps
        .map((s) => s.action)
        .filter((a) => !a.startsWith("mutate:"));

      const extractedArgs = this._currentInput
        ? extractParamsForReflex(this._currentInput, toolNames)
        : {};

      interpolatedArgs = extractedArgs;
    }

    // Explicit args have priority over interpolated ones
    const resolvedArgs = { ...interpolatedArgs, ...args };

    this.log.info("Ejecutando reflex directamente (sin LLM)", {
      sequence: match.record.sequence,
      reflexId: match.record.id,
      extractedParams: Object.fromEntries(
        Object.entries(resolvedArgs).filter(
          ([, v]) => Object.keys(v).length > 0,
        ),
      ),
    });

    let lastToolOutput: string | null = null;
    const steps = match.record.steps;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const previousStep = i > 0 ? steps[i - 1] : undefined;

      if (step.action.startsWith("mutate:")) {
        const cellType = step.action.replace("mutate:", "");
        await routeStimulus({ type: cellType, source: "reflex" });
        results.push(`Mutación a '${cellType}' ejecutada`);
      } else {
        let toolArgs: Record<string, unknown> = {
          ...(resolvedArgs[step.action] ?? {}),
        };

        // Output chaining — pass previous tool output to data-accepting steps.
        if (lastToolOutput !== null) {
          if (
            step.action === "db_insert" &&
            (toolArgs.data === undefined ||
              (typeof toolArgs.data === "object" &&
                toolArgs.data !== null &&
                Object.keys(toolArgs.data as Record<string, unknown>).length ===
                  0))
          ) {
            try {
              toolArgs.data = JSON.parse(lastToolOutput);
            } catch {
              toolArgs.data = { content: lastToolOutput };
            }
            if (toolArgs.table === undefined) {
              toolArgs.table = "scraped_content";
            }
          } else if (
            step.action === "write_file" &&
            toolArgs.content === undefined
          ) {
            toolArgs.content = lastToolOutput;
          } else if (previousStep?.chainOutputTo) {
            toolArgs[previousStep.chainOutputTo] = lastToolOutput;
          }
        }

        try {
          const result = await executeAction(step.action, toolArgs);
          lastToolOutput = result;
          results.push(result);
        } catch (err: any) {
          this.reflex.markFailed(match.record.id);
          this.perf.recordDegradation("execution_failure");
          this.log.warn("Reflex falló en paso intermedio — degradando a hint", {
            step: step.action,
            stepIndex: i,
            error: err.message,
          });
          const stepError = new Error(err.message);
          (stepError as any).failedStepIndex = i;
          (stepError as any).partialResults = results;
          (stepError as any).failedStep = step.action;
          throw stepError;
        }
      }
    }

    this.reflex.markSuccess(match.record.id);
    this.perf.recordTokenSavings(match.record.steps.length);
    this.log.info("Reflex completado con éxito", {
      steps: match.record.steps.length,
    });
    return results;
  }

  buildToolVersionMap(tools: any[]): void {
    this.toolVersionMap.clear();
    if (Array.isArray(tools)) {
      for (const tool of tools) {
        const toolName = tool?.name ?? tool;
        if (
          typeof toolName === "string" &&
          !this.toolVersionMap.has(toolName)
        ) {
          this.toolVersionMap.set(toolName, "1.0.0");
        }
      }
    }
    this.log.debug("Tool version map built", {
      toolCount: this.toolVersionMap.size,
    });
  }

  getSchemaVersions(steps: ReflexStep[]): Record<string, string> {
    const versions: Record<string, string> = {};
    for (const step of steps) {
      if (step.action.startsWith("mutate:")) continue;
      const version = this.toolVersionMap.get(step.action);
      if (version) {
        versions[step.action] = version;
      }
    }
    return versions;
  }

  checkSchemaVersions(
    stored: Record<string, string> | null,
    current: Map<string, string>,
  ): {
    compatible: boolean;
    mismatches: Array<{ tool: string; stored: string; current: string }>;
  } {
    if (!stored) return { compatible: true, mismatches: [] };

    const mismatches: Array<{ tool: string; stored: string; current: string }> =
      [];

    for (const [tool, storedVersion] of Object.entries(stored)) {
      const currentVersion = current.get(tool);
      if (currentVersion === undefined) {
        mismatches.push({ tool, stored: storedVersion, current: "removed" });
      } else if (currentVersion !== storedVersion) {
        mismatches.push({
          tool,
          stored: storedVersion,
          current: currentVersion,
        });
      }
    }

    return {
      compatible: mismatches.length === 0,
      mismatches,
    };
  }
}

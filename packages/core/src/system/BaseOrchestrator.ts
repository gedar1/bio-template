import { BaseOrganisms } from "../organisms/BaseOrganisms.js";
import { PerfMonitor } from "../infrastructure/PerfMonitor.js";
import { StimulusTypeSchema } from "../config/validators.js";
import { createLogger } from "../config/logger.js";
import { measureSpan } from "../config/telemetry.js";
import {
  ToolExecutionError,
  GuardrailBlockedError,
  MutationError,
} from "../errors.js";
import {
  deduplicateTools,
  preloadPipeline,
  summarizeToolResult,
  checkExecutionSafety,
} from "../atoms/index.js";
import type { ILogger } from "../config/ILogger.js";
import type { IOrchestrator } from "./interfaces/IOrchestrator.js";
import type { IStimulus } from "./interfaces/IStimulus.js";
import type { HistoryEntry } from "../molecules/HistoryMolecule.js";
import type { ReflexStep, ReflexMatch } from "../molecules/ReflexMolecule.js";
import {
  DefaultReflexExecutor,
  DefaultHistoryManager,
  DefaultPerfTracker,
} from "./strategies/index.js";
import type {
  IReflexExecutor,
  IHistoryManager,
  IPerfTracker,
} from "./strategies/index.js";

const SYSTEM_PROMPT = [
  "Eres el Cortex de BioCore. Dispones de una herramienta `stimulate_differentiation` para activar capacidades específicas según la tarea.",
  "REGLAS DE MUTACIÓN:",
  "- Solo muta cuando el usuario pide EJECUTAR una acción concreta (crear pedido, scrapear, guardar, enviar, etc.).",
  "- Si el usuario hace una PREGUNTA informativa (cómo, qué es, explícame, ayuda), responde con texto SIN mutar.",
  "- Cada mutación carga herramientas nuevas. No repitas mutaciones al mismo tipo si ya mutaste.",
  "- Secuencia típica: mutate:tipo → usar herramienta → mutate:otro_tipo → usar herramienta.",
  "- Máximo una mutación por tipo por tarea. Si ya mutaste a 'sensory', no vuelvas a mutar a 'sensory'.",
  "- Ejecuta las herramientas inmediatamente después de mutar al tipo correcto.",
  "- Si no estás seguro de qué hacer, pregunta al usuario antes de mutar.",
].join("\n");

/**
 * Opciones de construcción del BaseOrchestrator.
 * Permiten inyectar estrategias personalizadas (para tests o composición avanzada).
 * Si no se proporcionan, se crean implementaciones por defecto.
 */
export interface OrchestratorOptions {
  sessionId?: string;
  reflexExecutor?: IReflexExecutor;
  historyManager?: IHistoryManager;
  perfTracker?: IPerfTracker;
  logger?: ILogger;
}

/**
 * BaseOrchestrator - El "Cortex" base del sistema BioCore.
 *
 * Responsabilidad única: orquestación. Registra organismos, unifica herramientas,
 * rutea estímulos (mutaciones) y ejecuta acciones. Las responsabilidades
 * secundarias se delegan a estrategias inyectables:
 *   - Memoria refleja  → IReflexExecutor
 *   - Historial        → IHistoryManager
 *   - Rendimiento      → IPerfTracker
 */
export abstract class BaseOrchestrator implements IOrchestrator {
  protected organisms: BaseOrganisms[] = [];

  protected sessionId: string;
  protected readonly log: ILogger;

  protected readonly historyManager: IHistoryManager;

  private readonly reflexExecutor: IReflexExecutor;
  private readonly perfTracker: IPerfTracker;

  /** Tipos de célula ya mutados en la sesión actual (previene duplicados). */
  protected readonly _mutatedTypes: Set<string> = new Set();

  /** Input del usuario de la sesión actual — usado por el guardrail de ejecución. */
  protected _currentUserInput: string = "";

  constructor(sessionId?: string);
  constructor(options?: OrchestratorOptions);
  constructor(arg?: string | OrchestratorOptions) {
    const options: OrchestratorOptions =
      typeof arg === "string" ? { sessionId: arg } : (arg ?? {});

    this.sessionId = options.sessionId ?? `session-${Date.now()}`;
    this.log = options.logger ?? createLogger("Cortex");

    // ── PerfTracker ──────────────────────────────────────────────────────────
    if (options.perfTracker) {
      this.perfTracker = options.perfTracker;
    } else {
      this.perfTracker = new DefaultPerfTracker(new PerfMonitor(), this.log);
    }

    // ── HistoryManager (the structured transcript is its single source) ───────
    this.historyManager =
      options.historyManager ?? new DefaultHistoryManager(undefined, this.log);

    // ── ReflexExecutor (comparte el PerfMonitor vía perfTracker) ──────────────
    this.reflexExecutor =
      options.reflexExecutor ??
      new DefaultReflexExecutor(undefined, this.perfTracker, this.log);

    // Configuración inicial del Cortex: mensaje system de la sesión.
    this.historyManager.createSession(this.sessionId, SYSTEM_PROMPT);
  }

  // ─── Facade: métricas / historial / sesión ──────────────────────────────────

  getPerfSummary() {
    return this.perfTracker.summary();
  }

  getHistory() {
    return this.historyManager.getHistory(this.sessionId);
  }

  getSessionId(): string {
    return this.sessionId;
  }

  /** Mapa de versiones de esquema por herramienta (delegado al ReflexExecutor). */
  get toolVersionMap(): Map<string, string> {
    return this.reflexExecutor.toolVersionMap;
  }

  /**
   * Inyecta la función de resumen para compresión inteligente de historial.
   * Llamar en el constructor del Cortex concreto tras inicializar el cliente LLM.
   */
  public setSummarizer(
    fn: (
      messages: readonly import("./providers/providerTypes.js").LLMMessage[],
    ) => Promise<string>,
  ): void {
    this.historyManager.setSummarizer(fn);
  }

  /** Adds a public history entry through the structured history owner. */
  public addHistoryMessage(sessionId: string, entry: HistoryEntry): void {
    this.historyManager.addMessage(sessionId, entry);
  }

  /** Returns the protocol transcript used to build provider requests. */
  protected getStructuredHistory(): readonly import("./providers/providerTypes.js").LLMMessage[] {
    return this.historyManager.structured.snapshot(this.sessionId);
  }

  // ─── Orquestación ────────────────────────────────────────────────────────────

  /** Registra un nuevo órgano en el sistema unificado. */
  public registerOrganism(org: BaseOrganisms) {
    this.organisms.push(org);
  }

  /** Conecta neurotransmisores (inicializa contextos MCP). */
  public async init() {
    this.log.info("Conectando neurotransmisores", {
      organisms: this.organisms.length,
    });
    await Promise.all([
      ...this.organisms.map((org) => org.initializeContext()),
      this.reflexExecutor.initialize(),
      measureSpan(
        "Atom",
        "embedding_preload",
        async () => {
          const ms = await preloadPipeline();
          this.log.info("Embedding pipeline ready", { durationMs: ms });
          return ms;
        },
        { "embedding.source": "preload" },
      ),
    ]);
    await this.buildToolVersionMap();
    this.log.info("Sistema nervioso listo");
  }

  /**
   * Ruteo Biológico: difunde señal de diferenciación al cuerpo.
   * Valida el tipo de estímulo contra el registry antes de difundir.
   */
  public async routeStimulus(stimulus: string | IStimulus): Promise<void> {
    const isStimulus = typeof stimulus === "object";
    const type = isStimulus ? stimulus.type : stimulus;
    const source = isStimulus ? stimulus.source : "unknown";
    const metadata = isStimulus ? stimulus.metadata : undefined;
    const timestamp = isStimulus
      ? (stimulus.timestamp ?? Date.now())
      : Date.now();

    const validated = StimulusTypeSchema.parse(type);

    await this.perfTracker.measure(
      "mutation",
      async () => {
        this.log.info("Difundiendo señal de diferenciación", {
          from: this.organisms[0]?.organismName,
          stimulus: validated,
          source,
          metadata,
        });
        const stimulationTasks = this.organisms.map((org) =>
          org.stimulate(validated),
        );
        await Promise.all(stimulationTasks);
        this.log.info("Sistema reconfigurado", {
          stimulus: validated,
          source,
          durationContext: timestamp,
        });
      },
      { stimulus: validated, source, ...metadata },
    );
  }

  /**
   * Obtiene herramientas unificadas y las deduplica.
   * Comprime historial automáticamente si excede el límite (vía HistoryManager).
   */
  public async getUnifiedTools(): Promise<any[]> {
    await this.historyManager.compress(this.sessionId);

    const allTools: any[] = [];
    for (const org of this.organisms) {
      const orgTools = await org.inspectTools();
      if (orgTools) allTools.push(...orgTools);
    }

    return deduplicateTools(allTools);
  }

  /**
   * Ejecuta una herramienta invocada por el LLM.
   * Si es stimulate_differentiation, difunde la mutación.
   * Registra automáticamente cada paso exitoso para la Memoria Refleja.
   */
  public async executeAction(name: string, args: any): Promise<string> {
    this.log.info("Ejecutando acción", { tool: name });

    if (name === "stimulate_differentiation") {
      const cellType = args.type;

      if (this._mutatedTypes.has(cellType)) {
        this.log.warn("Mutación duplicada bloqueada", { type: cellType });
        return `Ya mutaste a '${cellType}' en esta sesión. Las herramientas de '${cellType}' ya están disponibles. Úsalas directamente.`;
      }

      await this.routeStimulus({
        type: cellType,
        source: "llm",
        metadata: { tool: name },
      });
      this._mutatedTypes.add(cellType);
      this.reflexExecutor.recordStep(
        { action: `mutate:${cellType}` },
        args || {},
      );
      return "Sistema mutado exitosamente. Nuevas herramientas disponibles.";
    }

    for (const org of this.organisms) {
      const tools = await org.inspectTools();
      if (tools?.some((t: any) => t.name === name)) {
        try {
          // ── Jev Guardrail: verifica coherencia antes de herramientas de riesgo ──
          // Solo se activa si TYPESAFE_API_KEY está configurada.
          // safe=false y safetyScore < REVIEW_THRESHOLD → lanza GuardrailBlockedError
          // safe=false y safetyScore en zona media → ejecuta con warning en logs
          // null → herramienta no vigilada o Jev no disponible → ejecuta normalmente
          const guardrail = await checkExecutionSafety(
            name,
            args || {},
            this._currentUserInput,
          );
          if (guardrail && !guardrail.safe) {
            const reason =
              guardrail.reason ??
              `Guardrail bloqueó '${name}' (safetyScore: ${guardrail.safetyScore.toFixed(2)})`;
            this.log.warn("🛡️  Guardrail bloqueó ejecución", {
              tool: name,
              safetyScore: guardrail.safetyScore,
              riskLevel: guardrail.riskLevel,
            });
            throw new GuardrailBlockedError(
              name,
              guardrail.safetyScore,
              reason,
            );
          }
          // ─────────────────────────────────────────────────────────────────────

          const result = await this.perfTracker.measure(
            `tool:${name}`,
            () => org.callTool(name, args),
            { tool: name },
          );
          this.reflexExecutor.recordStep(
            { action: name, paramKeys: Object.keys(args || {}) },
            args || {},
          );
          const content = result?.content;
          if (Array.isArray(content) && content.length > 0) {
            return content
              .map((c: any) => c.text || JSON.stringify(c))
              .join("\n");
          }
          return JSON.stringify(result);
        } catch (error: unknown) {
          if (
            error instanceof GuardrailBlockedError ||
            error instanceof ToolExecutionError ||
            error instanceof MutationError
          ) {
            throw error;
          }
          const message =
            error instanceof Error ? error.message : "Unknown tool failure";
          this.log.error("Error ejecutando herramienta", {
            tool: name,
            error: message,
          });
          throw new ToolExecutionError(name, message);
        }
      }
    }

    this.log.warn("Herramienta no encontrada en ningún organismo", {
      tool: name,
    });
    throw new ToolExecutionError(
      name,
      `Herramienta '${name}' no disponible. Muta el sistema primero.`,
    );
  }

  // ─── Facade: Memoria Refleja (delegada al ReflexExecutor) ────────────────────

  /**
   * Registra el input del usuario para la sesión actual y resetea el guardarraíl
   * de mutaciones. Llamar al inicio de cada `chat()` antes del loop LLM.
   */
  public trackInput(input: string): void {
    this._currentUserInput = input;
    this.reflexExecutor.trackInput(input);
    this._mutatedTypes.clear();
  }

  /** Persiste la secuencia de la sesión actual como un reflex exitoso. */
  public async saveReflex(): Promise<void> {
    await this.reflexExecutor.saveReflex();
  }

  /**
   * Busca un reflex similar al input dado y retorna la recomendación.
   * @returns ReflexMatch con mode "reflex" | "hint" | null si no hay match
   */
  public async queryReflex(input: string): Promise<ReflexMatch | null> {
    return this.reflexExecutor.queryReflex(input);
  }

  /**
   * Ejecuta una secuencia refleja directamente sin invocar el LLM.
   * Delega en el ReflexExecutor, proveyéndole los colaboradores de orquestación.
   */
  public async executeReflex(
    match: ReflexMatch,
    args: Record<string, Record<string, unknown>> = {},
  ): Promise<string[]> {
    return this.reflexExecutor.executeReflex(match, args, {
      routeStimulus: (stimulus) => this.routeStimulus(stimulus),
      executeAction: (name, actionArgs) => this.executeAction(name, actionArgs),
    });
  }

  /**
   * Construye el mapa de versiones de esquema inspeccionando los organismos
   * y delegando el mapeo al ReflexExecutor. Llamado durante init().
   */
  private async buildToolVersionMap(): Promise<void> {
    const allTools: any[] = [];
    for (const org of this.organisms) {
      const tools = await org.inspectTools();
      if (tools && Array.isArray(tools)) {
        allTools.push(...tools);
      }
    }
    this.reflexExecutor.buildToolVersionMap(allTools);
  }

  /** Método abstracto para que cada implementación maneje su chat específico. */
  public abstract chat(userMessage: string): Promise<void>;

  /**
   * Streaming de respuesta con Memoria Refleja integrada.
   * 1. Verifica reflex → ejecuta directo sin LLM si aplica.
   * 2. Si hint → inyecta contexto antes de llamar al LLM.
   * 3. Delega el streaming real a streamFromLLM() (implementado por subclases).
   */
  public async *chatStream(
    userMessage: string,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    this.trackInput(userMessage);
    const match = await this.queryReflex(userMessage);

    if (match) {
      this.log.info("Reflex encontrado (stream)", {
        mode: match.mode,
        similarity: match.record.similarity?.toFixed(3),
      });

      if (match.mode === "reflex") {
        try {
          const results = await this.executeReflex(match);
          this.log.info("Tarea completada via reflex (0 tokens)", {
            steps: results.length,
          });
          const formatted = formatReflexResults(results, match.record.steps);
          this.addHistoryMessage(this.sessionId, {
            role: "assistant",
            content: formatted,
            timestamp: Date.now(),
          });
          yield formatted;
          return;
        } catch (err: any) {
          if (err.failedStepIndex !== undefined) {
            const formatted = formatReflexError(
              err.partialResults ?? [],
              match.record.steps,
              err.failedStepIndex,
              err.failedStep,
              err.message,
            );
            this.addHistoryMessage(this.sessionId, {
              role: "assistant",
              content: formatted,
              timestamp: Date.now(),
            });
            yield formatted;
            return;
          }
          this.log.info("Reflex fallo, usando LLM como fallback");
        }
      } else if (match.mode === "hint") {
        this.addHistoryMessage(this.sessionId, {
          role: "system",
          content: `[Memoria Refleja] Secuencia exitosa anterior: ${match.record.sequence}. Usala como guia.`,
          timestamp: Date.now(),
        });
        userMessage = `[Contexto: secuencia sugerida: ${match.record.sequence}]\n${userMessage}`;
      }
    }

    yield* this.streamFromLLM(userMessage, signal);
  }

  /**
   * Implementación del streaming LLM. Cada subclase (GeminiCortex, etc.) la sobreescribe.
   * No debe contener lógica reflex — eso ya lo maneja chatStream().
   */
  protected async *streamFromLLM(
    userMessage: string,
    _signal?: AbortSignal,
  ): AsyncGenerator<string> {
    await this.chat(userMessage);
    const messages = this.getHistory();
    const last = messages.at(-1);
    if (last?.role === "assistant") {
      yield last.content;
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Formats raw reflex execution results into a user-friendly message.
 * Hides internal details (mutations, raw JSON) and shows a clean summary.
 */
function formatReflexResults(results: string[], steps: ReflexStep[]): string {
  const toolResults: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const step = steps[i];
    const result = results[i];

    if (step.action.startsWith("mutate:")) {
      continue;
    }

    toolResults.push(summarizeToolResult(step.action, result));
  }

  const sequence = steps.map((s) => s.action).join("->");

  if (toolResults.length === 0) {
    return `sequence:${sequence}\n✅ Tarea completada.`;
  }

  return `sequence:${sequence}\n✅ Tarea completada:\n${toolResults.join("\n")}`;
}

/**
 * Formats a reflex execution error into a user-friendly message.
 * Includes the sequence metadata with a failedStep marker for the frontend.
 */
function formatReflexError(
  partialResults: string[],
  steps: ReflexStep[],
  failedStepIndex: number,
  failedStep: string,
  errorMessage: string,
): string {
  const sequence = steps.map((s) => s.action).join("->");

  const successSummaries: string[] = [];
  let resultIdx = 0;
  for (let i = 0; i < failedStepIndex; i++) {
    const step = steps[i];
    if (step.action.startsWith("mutate:")) continue;
    if (resultIdx < partialResults.length) {
      successSummaries.push(
        summarizeToolResult(step.action, partialResults[resultIdx]),
      );
      resultIdx++;
    }
  }

  let output = `[sequence:${sequence}][failedStep:${failedStepIndex}]\n`;
  output += `❌ Error en paso "${failedStep}":\n`;
  output += `${errorMessage}\n`;

  if (successSummaries.length > 0) {
    output += `\nPasos completados antes del error:\n`;
    output += successSummaries.join("\n");
  }

  return output;
}

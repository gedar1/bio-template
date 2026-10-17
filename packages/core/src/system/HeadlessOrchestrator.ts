/**
 * HeadlessOrchestrator — Orquestador sin LLM para BioCore.
 *
 * Ejecuta tareas de forma determinística combinando tres estrategias en cascada:
 *
 *   1. REFLEX   — patrones aprendidos por la Memoria Refleja         (0 tokens, ~5ms)
 *   2. JEV      — routing Jev + paramExtractor + heurísticas         (~$0.00004, ~150ms)
 *   3. EXPLICIT — secuencia predefinida en HeadlessTask.fallback      (0 tokens, 0 Jev)
 *
 * Si ninguna estrategia resuelve la tarea → lanza HeadlessEscalationError.
 * El caller puede capturar ese error y redirigir al UnifiedCortex.
 *
 * Casos de uso principales:
 *   - Tareas del Scheduler que ya fueron aprendidas via reflex
 *   - Webhooks con payload bien definido (GitHub, Jira, Stripe)
 *   - CI/CD pipelines donde no se puede/quiere llamar a un LLM
 *   - Tests de integración sin costo de tokens
 *
 * @example — uso con Scheduler
 * ```ts
 * const headless = new HeadlessOrchestrator({ allowedCells: ["sensory", "memory"] });
 * headless.registerOrganism(organism);
 * await headless.init();
 *
 * // Cada noche: aprende de reflexes acumulados, no gasta tokens
 * scheduler.add("0 2 * * *", async () => {
 *   const result = await headless.execute({
 *     instruction: "scrapea https://tienda.com/productos y guarda en tabla productos",
 *     fallback: [
 *       { cell: "sensory",  tool: "scrape_url", args: { url: "https://tienda.com/productos" } },
 *       { cell: "memory",   tool: "db_insert",  args: { table: "productos" } },
 *     ],
 *   });
 *   log.info({ mode: result.mode, steps: result.outputs.length }, "Tarea completada");
 * });
 * ```
 *
 * @example — captura de escalación y fallback al LLM
 * ```ts
 * try {
 *   return await headless.execute({ instruction: userMessage });
 * } catch (err) {
 *   if (err instanceof HeadlessEscalationError) {
 *     return await unifiedCortex.chatStream(err.instruction);
 *   }
 *   throw err;
 * }
 * ```
 */

import {
  BaseOrchestrator,
  type OrchestratorOptions,
} from "./BaseOrchestrator.js";
import { preCellRoute, type RouterHistoryEntry } from "../atoms/cellRouter.js";
import { extractParamsForReflex } from "../atoms/paramExtractor.js";
import { HeadlessEscalationError } from "../errors.js";
import type { ReflexMatch } from "../molecules/ReflexMolecule.js";
import type { ILogger } from "../config/ILogger.js";

// ─── Tipos públicos ────────────────────────────────────────────────────────────

/**
 * Un paso explícito de ejecución.
 * Se usa en `HeadlessTask.fallback` para definir la secuencia exacta cuando
 * no hay reflex disponible y Jev no puede routear con suficiente confianza.
 */
export interface HeadlessStep {
  /** Tipo de célula a activar (debe estar en `allowedCells`) */
  cell: string;
  /** Nombre de la herramienta a ejecutar dentro de esa célula */
  tool: string;
  /** Argumentos a pasar a la herramienta */
  args: Record<string, unknown>;
}

/**
 * Tarea headless: instrucción natural + pasos explícitos opcionales.
 * La instrucción se usa para matching de reflexes y como estado de Jev.
 * Los pasos explícitos son el tercer nivel de fallback si todo lo demás falla.
 */
export interface HeadlessTask {
  /** Descripción en lenguaje natural — usada para reflex matching y Jev routing */
  instruction: string;
  /**
   * Pasos explícitos de fallback: ejecutados solo si no hay reflex ni routing Jev.
   * Si se omiten y tampoco hay reflex → HeadlessEscalationError.
   */
  fallback?: HeadlessStep[];
  /** Contexto conversacional reciente para dar a Jev (últimas 2 entradas max) */
  historyContext?: RouterHistoryEntry[];
}

/**
 * Resultado de una ejecución headless exitosa.
 */
export interface HeadlessResult {
  /** Estrategia que resolvió la tarea */
  mode: "reflex" | "jev" | "explicit";
  /** Resultados de cada herramienta ejecutada */
  outputs: string[];
  /** Tipo de célula activada (o "multiple" si hubo más de una en secuencia) */
  cellType: string;
  /** Confianza de Jev — solo en modo "jev" (0-1) */
  jevConfidence?: number;
  /** Tokens de Jev consumidos — 0 en modo "reflex" y "explicit" */
  jevTokens: number;
}

/**
 * Opciones de construcción del HeadlessOrchestrator.
 */
export interface HeadlessOrchestratorOptions extends OrchestratorOptions {
  /**
   * Tipos de célula que el orchestrator puede activar.
   * Se pasa a Jev para filtrar las opciones de routing.
   * Default: células del perfil `dev`.
   */
  allowedCells?: string[];
  /**
   * Umbral de confianza mínimo para que Jev haga el routing automáticamente.
   * Por debajo → escalación (a menos que haya `fallback` en la tarea).
   * Default: 0.7
   */
  jevConfidenceThreshold?: number;
  logger?: ILogger;
}

// ─── Heurísticas de selección de herramienta por célula ──────────────────────

/**
 * Mapa keyword → herramienta por tipo de célula.
 * Permite seleccionar la herramienta más probable dado el texto del usuario
 * de forma determinística, sin LLM ni llamadas externas.
 *
 * Orden importa: se evalúa de arriba a abajo y se retorna el primer match.
 */
const TOOL_HEURISTICS: Record<
  string,
  Array<{ keywords: string[]; tool: string }>
> = {
  sensory: [
    {
      keywords: ["extract_links", "links", "enlaces", "urls de la página"],
      tool: "extract_links",
    },
    {
      keywords: ["extract_images", "imágenes", "imagenes", "fotos"],
      tool: "extract_images",
    },
    {
      keywords: [
        "scrape_metadata",
        "metadata",
        "meta",
        "título",
        "titulo",
        "og:",
      ],
      tool: "scrape_metadata",
    },
    {
      keywords: ["analyze_page", "analiza", "análisis", "analyze"],
      tool: "analyze_page",
    },
    { keywords: ["fetch_api", "api", "endpoint", "json"], tool: "fetch_api" },
    {
      keywords: [
        "scrape",
        "scrapea",
        "extrae de",
        "lee la web",
        "lee la página",
        "http",
      ],
      tool: "scrape_url",
    },
  ],
  memory: [
    {
      keywords: ["create_table", "crea la tabla", "crea tabla", "nueva tabla"],
      tool: "create_table",
    },
    {
      keywords: ["db_delete", "borra", "elimina el registro", "delete from"],
      tool: "db_delete",
    },
    {
      keywords: ["db_update", "actualiza", "modifica", "update"],
      tool: "db_update",
    },
    {
      keywords: ["db_query", "query", "consulta sql", "sql", "select"],
      tool: "db_query",
    },
    {
      keywords: [
        "db_find",
        "busca",
        "encuentra",
        "filtra",
        "lista",
        "listar",
        "muestra todos",
      ],
      tool: "db_find",
    },
    {
      keywords: ["guarda", "inserta", "agrega", "añade", "insert", "add"],
      tool: "db_insert",
    },
  ],
  filesystem: [
    {
      keywords: ["delete_file", "borra el archivo", "elimina el archivo"],
      tool: "delete_file",
    },
    {
      keywords: ["move_file", "mueve", "renombra el archivo"],
      tool: "move_file",
    },
    {
      keywords: ["copy_file", "copia el archivo", "duplica"],
      tool: "copy_file",
    },
    {
      keywords: [
        "list_files",
        "lista archivos",
        "lista el directorio",
        "ls",
        "dir",
      ],
      tool: "list_files",
    },
    {
      keywords: ["write_json", "escribe json", "guarda json"],
      tool: "write_json",
    },
    {
      keywords: ["read_json", "lee json", "lee el json", ".json"],
      tool: "read_json",
    },
    {
      keywords: [
        "write_file",
        "escribe",
        "crea el archivo",
        "guarda el archivo",
      ],
      tool: "write_file",
    },
    { keywords: ["lee", "read", "abre", "lee el archivo"], tool: "read_file" },
  ],
  versioncontrol: [
    {
      keywords: ["git_push", "push", "sube los cambios", "envía al repo"],
      tool: "git_push",
    },
    {
      keywords: [
        "git_pull",
        "pull",
        "jala",
        "actualiza el repo",
        "trae cambios",
      ],
      tool: "git_pull",
    },
    {
      keywords: ["git_log", "log", "historial", "historia del repo"],
      tool: "git_log",
    },
    {
      keywords: ["git_checkout", "checkout", "cambia de rama", "switch"],
      tool: "git_checkout",
    },
    {
      keywords: ["git_add", "add", "stage", "agrega archivos"],
      tool: "git_add",
    },
    {
      keywords: ["git_commit", "commit", "guarda cambios", "commitea"],
      tool: "git_commit",
    },
    {
      keywords: ["git_status", "status", "estado del repo", "qué hay"],
      tool: "git_status",
    },
  ],
  http: [
    {
      keywords: ["http_delete", "delete", "elimina el recurso"],
      tool: "http_delete",
    },
    { keywords: ["http_put", "put", "actualiza el recurso"], tool: "http_put" },
    {
      keywords: ["http_post", "post", "crea", "envía datos"],
      tool: "http_post",
    },
    {
      keywords: ["http_upload", "upload", "sube el archivo"],
      tool: "http_upload",
    },
    {
      keywords: ["http_download", "download", "descarga"],
      tool: "http_download",
    },
    { keywords: ["get", "obtén", "trae", "consulta la api"], tool: "http_get" },
  ],
  communication: [
    {
      keywords: [
        "send_bulk_email",
        "masivo",
        "bulk",
        "todos los emails",
        "broadcast",
      ],
      tool: "send_bulk_email",
    },
    {
      keywords: [
        "send_template_email",
        "template",
        "plantilla",
        "email de plantilla",
      ],
      tool: "send_template_email",
    },
    {
      keywords: ["send_whatsapp", "whatsapp", "wp", "mensaje de whatsapp"],
      tool: "send_whatsapp",
    },
    {
      keywords: [
        "email",
        "correo",
        "envía email",
        "manda email",
        "envía un email",
      ],
      tool: "send_email",
    },
  ],
  system: [
    {
      keywords: ["run_ffmpeg", "ffmpeg", "video", "audio", "convertir video"],
      tool: "run_ffmpeg",
    },
    {
      keywords: ["run_imagemagick", "imagemagick", "convert image", "imagen"],
      tool: "run_imagemagick",
    },
    {
      keywords: ["run_pandoc", "pandoc", "pdf", "docx", "convierte documento"],
      tool: "run_pandoc",
    },
    {
      keywords: [
        "system_info",
        "info del sistema",
        "cpu",
        "memoria",
        "ram",
        "disco",
      ],
      tool: "system_info",
    },
    {
      keywords: ["check_command", "verifica comando", "existe el comando"],
      tool: "check_command",
    },
    {
      keywords: ["ejecuta", "run", "corre", "cli", "comando"],
      tool: "execute_cli",
    },
  ],
  monitor: [
    {
      keywords: ["system_info", "cpu", "memoria", "uso del sistema"],
      tool: "system_info",
    },
    { keywords: ["check_command", "verifica servicio"], tool: "check_command" },
    {
      keywords: ["monitorea", "vigila", "check", "verifica la url", "health"],
      tool: "http_get",
    },
  ],
  orders: [
    {
      keywords: ["cancel", "cancela", "anula el pedido"],
      tool: "cancel_order",
    },
    {
      keywords: ["actualiza", "update", "modifica el pedido"],
      tool: "update_order",
    },
    {
      keywords: ["lista", "list", "listar pedidos", "ver pedidos"],
      tool: "list_orders",
    },
    {
      keywords: ["get", "obtén el pedido", "detalle del pedido"],
      tool: "get_order",
    },
    { keywords: ["crea", "nuevo pedido", "create"], tool: "create_order" },
  ],
  inventory: [
    { keywords: ["reorder", "reorden", "reponer"], tool: "reorder_item" },
    {
      keywords: ["alerta", "set_alert", "configurar alerta"],
      tool: "set_alert",
    },
    {
      keywords: ["actualiza stock", "update_stock", "modifica stock"],
      tool: "update_stock",
    },
    {
      keywords: ["lista inventario", "list_inventory", "ver inventario"],
      tool: "list_inventory",
    },
    {
      keywords: ["check", "verifica stock", "hay stock", "disponibilidad"],
      tool: "check_stock",
    },
  ],
  delivery: [
    {
      keywords: ["completar", "complete", "marcar entregado"],
      tool: "complete_delivery",
    },
    {
      keywords: ["estima", "estimate", "tiempo estimado"],
      tool: "estimate_time",
    },
    { keywords: ["rastrea", "track", "dónde está"], tool: "track_delivery" },
    {
      keywords: ["lista entregas", "list_deliveries", "ver entregas"],
      tool: "list_deliveries",
    },
    {
      keywords: ["asigna", "assign", "asignar repartidor"],
      tool: "assign_delivery",
    },
  ],
};

/**
 * Selecciona la herramienta más apropiada dado el tipo de célula y el input.
 * Evaluación determinística basada en keywords — sin LLM ni llamadas externas.
 *
 * @returns nombre de la herramienta más probable, o `null` si no hay disponibles
 */
function selectToolFromCell(
  cellType: string,
  userInput: string,
  availableTools: string[],
): string | null {
  if (availableTools.length === 0) return null;

  const lower = userInput.toLowerCase();
  const heuristics = TOOL_HEURISTICS[cellType] ?? [];

  for (const h of heuristics) {
    if (
      h.keywords.some((kw) => lower.includes(kw)) &&
      availableTools.includes(h.tool)
    ) {
      return h.tool;
    }
  }

  // Fallback: primera herramienta disponible (la más básica del tipo)
  return availableTools[0] ?? null;
}

// ─── HeadlessOrchestrator ─────────────────────────────────────────────────────

export class HeadlessOrchestrator extends BaseOrchestrator {
  private readonly allowedCells: string[];
  private readonly jevConfidenceThreshold: number;

  constructor(options: HeadlessOrchestratorOptions = {}) {
    super(options);
    this.allowedCells = options.allowedCells ?? [
      "sensory",
      "memory",
      "filesystem",
      "versioncontrol",
      "http",
      "system",
    ];
    this.jevConfidenceThreshold = options.jevConfidenceThreshold ?? 0.7;
  }

  // ─── Contrato abstracto ────────────────────────────────────────────────────

  /**
   * Implementación de `chat()` requerida por BaseOrchestrator.
   * En modo headless el punto de entrada es `execute()` o `chatStream()`.
   * Esta implementación existe para cumplir el contrato abstracto y para
   * que `chatStream()` funcione correctamente (hereda la lógica de reflex).
   */
  public async chat(_userMessage: string): Promise<void> {
    // chat() en headless no hace nada — el flujo real pasa por streamFromLLM()
    // o por execute() para uso programático.
  }

  // ─── Reemplazo del LLM por Jev ─────────────────────────────────────────────

  /**
   * Override de `streamFromLLM`: reemplaza el loop LLM con routing Jev + heurísticas.
   *
   * Se activa cuando `chatStream()` no encontró un reflex aplicable.
   * Flujo:
   *   1. Obtiene contexto del historial reciente
   *   2. Llama a `preCellRoute()` (Jev) para decidir la célula
   *   3. Muta la célula via `executeAction()` (registra el paso para reflex)
   *   4. Selecciona la herramienta con heurísticas de keywords
   *   5. Extrae argumentos del texto con `extractParamsForReflex()`
   *   6. Ejecuta la herramienta y guarda el reflex para la próxima vez
   *
   * Si Jev tiene baja confianza → lanza `HeadlessEscalationError`.
   */
  protected async *streamFromLLM(
    userMessage: string,
    _signal?: AbortSignal,
  ): AsyncGenerator<string> {
    this.log.info("HeadlessOrchestrator: sin reflex — intentando routing Jev", {
      message: userMessage.substring(0, 80),
    });

    // Contexto conversacional reciente para que Jev resuelva pronombres
    const recentHistory = this.getHistory()
      .slice(-2)
      .filter(
        (
          h,
        ): h is {
          role: "user" | "assistant";
          content: string;
          timestamp: number;
        } => h.role === "user" || h.role === "assistant",
      )
      .map((h) => ({
        role: h.role as "user" | "assistant",
        content: h.content,
      }));

    const route = await preCellRoute(
      userMessage,
      recentHistory,
      this.allowedCells,
    );

    if (route && route.confidence >= this.jevConfidenceThreshold) {
      this.log.info("Jev routing exitoso — ejecutando headless", {
        cellType: route.cellType,
        confidence: route.confidence.toFixed(3),
        complexityScore: route.complexityScore,
      });

      // Mutar via executeAction para que el paso quede en el reflex
      await this.executeAction("stimulate_differentiation", {
        type: route.cellType,
      });

      // Herramientas disponibles tras la mutación
      const tools = await this.getUnifiedTools();
      const toolNames = tools.map((t: any) => t.name);

      // Selección determinística de herramienta
      const selectedTool = selectToolFromCell(
        route.cellType,
        userMessage,
        toolNames,
      );

      if (selectedTool) {
        // Extrae argumentos del input natural
        const params = extractParamsForReflex(userMessage, [selectedTool]);
        const args = params[selectedTool] ?? {};

        this.log.info("Ejecutando herramienta seleccionada por Jev", {
          tool: selectedTool,
          argKeys: Object.keys(args),
        });

        const result = await this.executeAction(selectedTool, args);

        // Guarda el patrón — próxima vez se resuelve en modo REFLEX (0 tokens)
        await this.saveReflex();

        this.addHistoryMessage(this.sessionId, {
          role: "assistant",
          content: result,
          timestamp: Date.now(),
        });
        yield result;
        return;
      }

      this.log.warn(
        "Jev routeó la célula pero no se encontró herramienta adecuada",
        { cellType: route.cellType, availableTools: toolNames },
      );
    }

    // Jev no pudo resolver → escalar
    throw new HeadlessEscalationError(
      userMessage,
      route
        ? `Jev routing insuficiente (confidence: ${route.confidence.toFixed(2)} < ${this.jevConfidenceThreshold}) o sin herramienta adecuada`
        : "Jev no disponible (TYPESAFE_API_KEY no configurada o tarea multi-célula)",
      route?.confidence,
    );
  }

  // ─── Interfaz programática ─────────────────────────────────────────────────

  /**
   * Ejecuta una tarea headless de forma programática.
   * Diseñado para el Scheduler, webhooks, CLI y tests — no para chat interactivo.
   *
   * Estrategias en cascada (se detiene en el primer éxito):
   *   1. REFLEX:   busca un patrón aprendido en ReflexMolecule             (0 tokens)
   *   2. JEV:      Jev elige la célula, heurísticas eligen la herramienta  (~$0.00004)
   *   3. EXPLICIT: ejecuta `task.fallback` si está definido                (0 tokens)
   *
   * @throws HeadlessEscalationError — si ninguna estrategia puede resolver la tarea
   */
  public async execute(task: HeadlessTask): Promise<HeadlessResult> {
    await this.init();
    this.trackInput(task.instruction);

    // ── ESTRATEGIA 1: Reflex ──────────────────────────────────────────────────
    const reflexMatch = await this.queryReflex(task.instruction);

    if (reflexMatch?.mode === "reflex") {
      this.log.info("HeadlessOrchestrator: resolviendo via REFLEX (0 tokens)");
      const outputs = await this.executeReflex(reflexMatch);
      return {
        mode: "reflex",
        outputs,
        cellType: this.extractCellTypeFromReflex(reflexMatch),
        jevTokens: 0,
      };
    }

    // ── ESTRATEGIA 2: Routing Jev ─────────────────────────────────────────────
    const historyCtx: RouterHistoryEntry[] = task.historyContext ?? [];
    const route = await preCellRoute(
      task.instruction,
      historyCtx,
      this.allowedCells,
    );

    if (route && route.confidence >= this.jevConfidenceThreshold) {
      this.log.info("HeadlessOrchestrator: resolviendo via JEV", {
        cellType: route.cellType,
        confidence: route.confidence.toFixed(3),
        jevTokens: route.inputTokens,
      });

      // executeAction registra la mutación en el reflex automáticamente
      await this.executeAction("stimulate_differentiation", {
        type: route.cellType,
      });

      const tools = await this.getUnifiedTools();
      const toolNames = tools.map((t: any) => t.name);
      const selectedTool = selectToolFromCell(
        route.cellType,
        task.instruction,
        toolNames,
      );

      if (selectedTool) {
        const params = extractParamsForReflex(task.instruction, [selectedTool]);
        const args = params[selectedTool] ?? {};
        const result = await this.executeAction(selectedTool, args);

        // Aprende el patrón → próxima ejecución será REFLEX (0 tokens, 0 Jev)
        await this.saveReflex();

        return {
          mode: "jev",
          outputs: [result],
          cellType: route.cellType,
          jevConfidence: route.confidence,
          jevTokens: route.inputTokens,
        };
      }
    }

    // ── ESTRATEGIA 3: Pasos explícitos ────────────────────────────────────────
    if (task.fallback && task.fallback.length > 0) {
      this.log.info(
        "HeadlessOrchestrator: resolviendo via EXPLICIT (pasos predefinidos)",
        { steps: task.fallback.length },
      );

      const outputs: string[] = [];
      const activatedCells = new Set<string>();

      for (const step of task.fallback) {
        // Limpiar el guard de mutaciones para este step específico,
        // permitiendo que executeAction registre la mutación en el reflex.
        // (El guard existe para el LLM, no para la ejecución explícita headless.)
        this._mutatedTypes.delete(step.cell);

        await this.executeAction("stimulate_differentiation", {
          type: step.cell,
        });
        activatedCells.add(step.cell);

        const result = await this.executeAction(step.tool, step.args);
        outputs.push(result);
      }

      // Guarda la secuencia completa → próxima vez se resuelve como REFLEX
      await this.saveReflex();

      return {
        mode: "explicit",
        outputs,
        cellType:
          activatedCells.size === 1 ? [...activatedCells][0] : "multiple",
        jevTokens: route?.inputTokens ?? 0,
      };
    }

    // ── ESCALACIÓN ────────────────────────────────────────────────────────────
    const reason = route
      ? `Jev confidence insuficiente (${route.confidence.toFixed(2)} < ${this.jevConfidenceThreshold}) y sin fallback`
      : "Sin reflex, Jev no disponible (configura TYPESAFE_API_KEY) y sin fallback";

    this.log.warn(`HeadlessOrchestrator escalando: ${reason}`, {
      instruction: task.instruction.substring(0, 100),
    });

    throw new HeadlessEscalationError(
      task.instruction,
      reason,
      route?.confidence,
    );
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Extrae el tipo de célula del primer paso de mutación en un reflex.
   * Ejemplo: step.action = "mutate:memory" → retorna "memory".
   */
  private extractCellTypeFromReflex(match: ReflexMatch): string {
    const mutateStep = match.record.steps.find((s) =>
      s.action.startsWith("mutate:"),
    );
    return mutateStep?.action.replace("mutate:", "") ?? "unknown";
  }
}

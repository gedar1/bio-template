import { initTelemetry, createLogger } from "../../config/logger.js";
initTelemetry(); // debe ser lo primero, antes de cualquier componente

import Anthropic from "@anthropic-ai/sdk";
import axios from "axios";
import type { AxiosResponse } from "axios";
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/generative-ai";
import * as dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { BaseOrchestrator } from "../BaseOrchestrator.js";
import { CircuitBreaker } from "../../infrastructure/CircuitBreaker.js";
import { ProviderError } from "../../errors.js";
import {
  chooseModel,
  formatToolsForAnthropic,
  formatToolsForGemini,
  formatToolsForOpenAI,
  preCellRoute,
} from "../../atoms/index.js";
import type { RouterHistoryEntry } from "../../atoms/index.js";
import type {
  LLMProviderName,
  LLMProviderConfig,
} from "../../server/types/settings.js";
import type { UsageMetricsCollector } from "../../server/services/UsageMetricsCollector.js";
import type { TenantRegistryService } from "../../server/services/TenantRegistryService.js";

dotenv.config();

const log = createLogger("UnifiedCortex");

/**
 * UnifiedCortex - Cortex maestro con Circuit Breakers por modelo.
 * Si un LLM falla repetidamente, el circuito se abre y se usa el fallback automáticamente.
 */
export class UnifiedCortex extends BaseOrchestrator {
  readonly anthropic: Anthropic;
  readonly genAI: GoogleGenerativeAI;

  readonly claudeBreaker: CircuitBreaker;
  readonly geminiBreaker: CircuitBreaker;
  readonly nvidiaBreaker: CircuitBreaker;

  private readonly nvidiaApiKey: string;
  private readonly nvidiaBaseUrl: string;
  private readonly nvidiaModel: string;

  /** Current LLM provider configuration (primary + fallback chain) */
  private readonly _providerConfig: LLMProviderConfig;

  /** Whether a chat session is currently active (streaming/processing) */
  private _sessionActive = false;

  /** Pending reconfiguration to apply once the current session completes */
  private _pendingConfig: Partial<LLMProviderConfig> | null = null;

  /** Optional metrics collector for recording usage per tenant */
  private _metricsCollector: UsageMetricsCollector | null = null;

  /** Optional tenant registry for checking token limits */
  private _tenantRegistry: TenantRegistryService | null = null;

  /** Tenant ID associated with this cortex instance (for metrics) */
  private _tenantId: string | null = null;

  constructor() {
    super("UNIFIED-CORTEX-SESSION");

    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY || "",
    });
    this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");

    this.nvidiaApiKey = process.env.NVIDIA_API_KEY || "";
    this.nvidiaBaseUrl =
      process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
    this.nvidiaModel =
      process.env.NVIDIA_MODEL || "nvidia/llama-3.3-nemotron-super-49b-v1";

    this.claudeBreaker = new CircuitBreaker({
      name: "claude",
      failureThreshold: 3,
      resetTimeout: 60000,
      onOpen: () => log.warn("Claude circuit OPEN"),
      onClose: () => log.info("Claude circuit CLOSED"),
    });

    this.geminiBreaker = new CircuitBreaker({
      name: "gemini",
      failureThreshold: 3,
      resetTimeout: 60000,
      onOpen: () => log.warn("Gemini circuit OPEN"),
      onClose: () => log.info("Gemini circuit CLOSED"),
    });

    this.nvidiaBreaker = new CircuitBreaker({
      name: "nvidia",
      failureThreshold: 3,
      resetTimeout: 60000,
      onOpen: () => log.warn("NVIDIA circuit OPEN"),
      onClose: () => log.info("NVIDIA circuit CLOSED"),
    });

    // Initialize provider config with default chain
    this._providerConfig = {
      primaryProvider: "gemini",
      fallbackOrder: ["claude", "nvidia"],
    };

    // Summarizer: usa Claude Haiku (modelo barato) para generar resúmenes reales
    // del historial antiguo en lugar de truncar texto a 100 caracteres.
    // Solo se activa si hay API key de Anthropic configurada.
    if (process.env.ANTHROPIC_API_KEY) {
      this.setSummarizer(async (messages) => {
        const content = messages
          .map((m) => `${m.role}: ${m.content.substring(0, 300)}`)
          .join("\n");
        const res = await this.anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 400,
          messages: [
            {
              role: "user",
              content: `Resume en 4-6 oraciones los puntos clave de esta conversación para que un asistente IA mantenga contexto:\n\n${content}`,
            },
          ],
        });
        return res.content[0].type === "text" ? res.content[0].text : "";
      });
    }
  }

  private async getAnthropicTools(): Promise<Anthropic.Tool[]> {
    const unified = await this.getUnifiedTools();
    return formatToolsForAnthropic(unified) as Anthropic.Tool[];
  }

  private async getGeminiTools() {
    const unified = await this.getUnifiedTools();
    return formatToolsForGemini(unified);
  }

  private async getNvidiaTools(): Promise<any[]> {
    const unified = await this.getUnifiedTools();
    return formatToolsForOpenAI(unified);
  }

  private getModelName(): string {
    return process.env.GEMINI_MODEL || "gemini-2.5-flash";
  }

  // ─── Hot-Reload Configuration Methods ───────────────────────────────────────

  /**
   * Reconfigures the LLM provider chain at runtime (hot-reload).
   * If a session is currently active, queues the change until the session completes.
   */
  public reconfigure(config: {
    primaryProvider?: LLMProviderName;
    fallbackOrder?: LLMProviderName[];
  }): void {
    if (this._sessionActive) {
      log.info({ config }, "Session active — queuing provider reconfiguration");
      const pending: Partial<LLMProviderConfig> = { ...this._pendingConfig };
      if (config.primaryProvider) {
        pending.primaryProvider = config.primaryProvider;
      }
      if (config.fallbackOrder) {
        pending.fallbackOrder = config.fallbackOrder;
      }
      this._pendingConfig = pending;
      return;
    }

    this.applyConfig(config);
  }

  /**
   * Returns whether a chat session is currently in progress.
   */
  public isSessionActive(): boolean {
    return this._sessionActive;
  }

  /**
   * Returns the current LLM provider configuration.
   */
  public getProviderConfig(): LLMProviderConfig {
    return { ...this._providerConfig };
  }

  /**
   * Applies provider config changes immediately.
   */
  private applyConfig(config: Partial<LLMProviderConfig>): void {
    if (config.primaryProvider) {
      this._providerConfig.primaryProvider = config.primaryProvider;
    }
    if (config.fallbackOrder) {
      this._providerConfig.fallbackOrder = [...config.fallbackOrder];
    }
    log.info(
      {
        primary: this._providerConfig.primaryProvider,
        fallback: this._providerConfig.fallbackOrder,
      },
      "Provider config updated",
    );
  }

  /**
   * Flushes any pending reconfiguration queued during an active session.
   * Called automatically when a session ends.
   */
  private flushPendingConfig(): void {
    if (this._pendingConfig) {
      log.info("Applying queued provider reconfiguration");
      this.applyConfig(this._pendingConfig);
      this._pendingConfig = null;
    }
  }

  // ─── Metrics Collector Integration ────────────────────────────────────────

  /**
   * Sets the optional metrics collector for recording token usage and errors.
   * No-op behavior if not set — the cortex works identically without it.
   *
   * @param collector - UsageMetricsCollector instance
   * @param tenantId - Tenant ID to associate with this cortex's metrics
   */
  public setMetricsCollector(
    collector: UsageMetricsCollector,
    tenantId: string,
  ): void {
    this._metricsCollector = collector;
    this._tenantId = tenantId;
    log.debug({ tenantId }, "Metrics collector configured for cortex");
  }

  /**
   * Safely records a metric event. No-op if no collector is set.
   * Catches and logs any errors to avoid disrupting normal operation.
   */
  private recordMetric(
    eventType: "tokens" | "task_completed" | "task_error" | "cortex_error",
    value: number,
  ): void {
    if (!this._metricsCollector || !this._tenantId) return;
    try {
      this._metricsCollector.record(this._tenantId, eventType, value);
    } catch (err: any) {
      log.warn(
        { tenantId: this._tenantId, eventType, error: err.message },
        "Failed to record metric (non-fatal)",
      );
    }
  }

  /**
   * Sets the tenant registry for token limit enforcement.
   * When set, the cortex will check the tenant's token_limit before processing LLM requests.
   *
   * @param registry - TenantRegistryService instance
   */
  public setTenantRegistry(registry: TenantRegistryService): void {
    this._tenantRegistry = registry;
    log.debug("Tenant registry configured for cortex");
  }

  /**
   * Checks if the tenant has exceeded their token limit for the current month.
   * - If no metrics collector or tenant registry is set, allows the request (no enforcement).
   * - If token_limit is 0, allows the request (unlimited).
   * - If current consumption >= token_limit, throws an error rejecting the request.
   */
  private checkTokenLimit(): void {
    if (!this._metricsCollector || !this._tenantId || !this._tenantRegistry) {
      return; // No enforcement possible without all components
    }

    try {
      const tenantRecord = this._tenantRegistry.getById(this._tenantId);
      if (!tenantRecord) {
        return; // Tenant not in registry — allow request
      }

      const tokenLimit = tenantRecord.token_limit;

      // token_limit of 0 means unlimited (no restriction)
      if (tokenLimit === 0) {
        return;
      }

      const currentTokens = this._metricsCollector.getCurrentMonthTokens(
        this._tenantId,
      );

      if (currentTokens >= tokenLimit) {
        log.warn(
          { tenantId: this._tenantId, currentTokens, tokenLimit },
          "Token limit reached — rejecting LLM request",
        );
        throw new Error(
          `Token limit reached for tenant '${this._tenantId}'. ` +
            `Current consumption: ${currentTokens} tokens, limit: ${tokenLimit} tokens per month. ` +
            `Contact your platform administrator to increase the limit.`,
        );
      }
    } catch (err: any) {
      // Re-throw token limit errors
      if (err.message?.includes("Token limit reached")) {
        throw err;
      }
      // Log and allow request if there's an unexpected error checking the limit
      log.warn(
        { tenantId: this._tenantId, error: err.message },
        "Failed to check token limit (non-fatal, allowing request)",
      );
    }
  }

  // ───────────────────────────────────────────────────────────────────────────

  public async chat(userMessage: string): Promise<void> {
    this._sessionActive = true;
    try {
      await this._chatInternal(userMessage);
    } finally {
      this._sessionActive = false;
      this.flushPendingConfig();
    }
  }

  private async _chatInternal(userMessage: string): Promise<void> {
    // ── Token Limit Enforcement ─────────────────────────────────────────────
    // Check if tenant has exceeded their monthly token limit BEFORE any LLM call
    this.checkTokenLimit();

    const preferred =
      this._providerConfig.primaryProvider || (await chooseModel(userMessage));
    const cleanText = userMessage.replace(/^\/(claude|gemini)\s*/i, "");

    log.info({ model: preferred.toUpperCase() }, "Seleccionando cerebro");

    // ── Memoria Refleja: registrar input y consultar secuencia conocida ──────
    this.trackInput(cleanText);
    const match = await this.queryReflex(cleanText);

    if (match) {
      log.info(
        {
          mode: match.mode,
          similarity: match.record.similarity?.toFixed(3),
          sequence: match.record.sequence,
        },
        "Reflex encontrado",
      );

      if (match.mode === "reflex") {
        // ── MODO REFLEX: ejecución directa sin LLM ──────────────────────────
        // Aplica cuando similitud ≥ 0.95 y éxitos ≥ 3.
        // Los args de herramientas se extraen del input con un parser simple.
        // Si falla, se degrada a hint + loop LLM automáticamente.
        try {
          const results = await this.executeReflex(match);
          log.info(
            { results: results.length },
            "Tarea completada vía reflex (0 tokens)",
          );
          return; // salir sin invocar el LLM
        } catch {
          // executeReflex ya marcó el fallo — continuar con loop LLM como fallback
          log.info("Reflex falló, ejecutando con LLM como fallback");
          this.history.create(this.sessionId, {
            role: "system",
            content: `[Memoria Refleja] Intenté la secuencia ${match.record.sequence} pero falló. Resuelve la tarea manualmente.`,
            timestamp: Date.now(),
          });
        }
      } else if (match.mode === "hint") {
        // ── MODO HINT: inyectar guía al LLM ─────────────────────────────────
        this.history.create(this.sessionId, {
          role: "system",
          content: `[Memoria Refleja] Para tareas similares, la secuencia exitosa anterior fue: ${match.record.sequence}. Úsala como guía si aplica.`,
          timestamp: Date.now(),
        });
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Jev Pre-Router: clasificar célula antes del loop LLM ─────────────────
    // Solo aplica cuando el reflex fue miss — si fue hit ya salimos arriba.
    // Obtiene los allowedCells del primer organismo (perfil del tenant) y el
    // historial reciente para resolver pronombres ("guardala", "envíala", etc.)
    // Si Jev confía ≥ 0.70, pre-muta la célula antes de que el LLM arranque.
    // Si Jev falla o tiene baja confianza, el flujo continúa sin cambios.
    const firstOrg = this.organisms[0];
    const allowedCells = firstOrg?.getAllowedCells();
    if (allowedCells && allowedCells.length > 0) {
      const recentHistory: RouterHistoryEntry[] = this.history
        .toMessages(this.sessionId)
        .slice(-4)
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      const route = await preCellRoute(cleanText, recentHistory, allowedCells);

      if (route) {
        log.info(
          {
            cellType: route.cellType,
            confidence: route.confidence.toFixed(3),
            complexity: route.complexityScore.toFixed(2),
            refersToContext: route.refersToContext,
            inputTokens: route.inputTokens,
          },
          "Jev pre-routing: mutando célula antes del LLM",
        );
        // Pre-mutar la célula — el LLM arrancará con las herramientas ya disponibles
        // y no necesitará gastar un turno en llamar stimulate_differentiation
        if (!this._mutatedTypes.has(route.cellType)) {
          await this.routeStimulus({
            type: route.cellType,
            source: "jev-pre-router",
            metadata: {
              confidence: route.confidence,
              complexityScore: route.complexityScore,
            },
          });
          this._mutatedTypes.add(route.cellType);
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Registrar mensaje del usuario UNA sola vez (antes de intentar proveedores)
    this.history.create(this.sessionId, {
      role: "user",
      content: cleanText,
      timestamp: Date.now(),
    });

    // Cadena de fallback: primary → secondary → nvidia (tercer nivel)
    const providers = this.buildProviderChain(preferred, cleanText);

    let lastError: any = null;
    for (const provider of providers) {
      try {
        await provider.breaker.execute(provider.run);
        await this.saveReflex();
        return; // éxito — salir del loop
      } catch (error: any) {
        lastError = error;
        log.warn(
          { model: provider.name, error: error.message },
          `${provider.name} falló, intentando siguiente fallback`,
        );
        // Record cortex_error for each provider failure
        this.recordMetric("cortex_error", 1);
      }
    }

    // Todos los proveedores fallaron
    const names = providers.map((p) => p.name).join(", ");
    log.error({ providers: names }, "Todos los modelos fallaron");
    throw new ProviderError(
      "all",
      `Todos los modelos fallaron (${names}). Último error: ${lastError?.message}`,
    );
  }

  private buildProviderChain(preferred: string, text: string) {
    const claude = {
      breaker: this.claudeBreaker,
      run: () => this.runClaudeLoop(text),
      name: "claude" as LLMProviderName,
    };
    const gemini = {
      breaker: this.geminiBreaker,
      run: () => this.runGeminiLoop(text),
      name: "gemini" as LLMProviderName,
    };
    const nvidia = {
      breaker: this.nvidiaBreaker,
      run: () => this.runNvidiaLoop(text),
      name: "nvidia" as LLMProviderName,
    };

    const providerMap: Record<LLMProviderName, typeof claude> = {
      claude,
      gemini,
      nvidia,
    };

    // Use the configured fallback order from _providerConfig
    const primary =
      providerMap[preferred as LLMProviderName] ??
      providerMap[this._providerConfig.primaryProvider];
    const fallbacks = this._providerConfig.fallbackOrder
      .filter((name) => name !== preferred)
      .map((name) => providerMap[name]);

    return [primary, ...fallbacks];
  }

  private async runClaudeLoop(text: string) {
    let processing = true;
    while (processing) {
      const response = await this.anthropic.messages.create({
        model: "claude-3-5-sonnet-latest",
        max_tokens: 1024,
        messages: this.history.toMessages(this.sessionId).map((m) => ({
          role: m.role === "user" ? "user" : "assistant",
          content: m.content,
        })),
        tools: await this.getAnthropicTools(),
      });

      // Record token usage from Claude response
      if (response.usage) {
        const totalTokens =
          (response.usage.input_tokens || 0) +
          (response.usage.output_tokens || 0);
        if (totalTokens > 0) {
          this.recordMetric("tokens", totalTokens);
        }
      }

      const textBlock = response.content.find(
        (c) => c.type === "text",
      ) as Anthropic.TextBlock;
      if (textBlock) {
        this.history.create(this.sessionId, {
          role: "assistant",
          content: textBlock.text,
          timestamp: Date.now(),
        });
      }
      const toolCalls = response.content.filter((c) => c.type === "tool_use");
      if (toolCalls.length > 0) {
        const results: any[] = [];
        for (const call of toolCalls) {
          const out = await this.executeAction(call.name, call.input);
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: out,
          });
        }
        this.history.create(this.sessionId, {
          role: "user",
          content: JSON.stringify(results),
          timestamp: Date.now(),
        });
      } else {
        if (textBlock)
          log.info(
            { response: textBlock.text.substring(0, 200) },
            "Respuesta de Claude",
          );
        processing = false;
      }
    }
  }

  private async createGeminiChat() {
    const modelName = this.getModelName();
    const tools = await this.getGeminiTools();
    const model = this.genAI.getGenerativeModel({
      model: modelName,
      tools: tools as any,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ],
    });

    return model.startChat({
      history: this.history
        .toMessages(this.sessionId)
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "user" ? "user" : "model",
          parts: [{ text: m.content }],
        })),
    });
  }

  private async runGeminiLoop(text: string) {
    let chat = await this.createGeminiChat();
    let result = await chat.sendMessage(text);

    // Record token usage from Gemini response
    const initialUsage = result.response.usageMetadata;
    if (initialUsage) {
      const totalTokens =
        (initialUsage.promptTokenCount || 0) +
        (initialUsage.candidatesTokenCount || 0);
      if (totalTokens > 0) {
        this.recordMetric("tokens", totalTokens);
      }
    }

    let calls = result.response.functionCalls();
    let iterations = 0;
    const MAX_ITERATIONS = 10;

    while (calls && calls.length > 0 && iterations < MAX_ITERATIONS) {
      iterations++;
      let mutated = false;
      const results: any[] = [];

      for (const call of calls) {
        const out = await this.executeAction(call.name, call.args);
        results.push({
          functionResponse: { name: call.name, response: { content: out } },
        });
        if (call.name === "stimulate_differentiation") mutated = true;
      }

      if (mutated) {
        log.info("Mutación detectada, refrescando herramientas");
        const summary = results
          .map(
            (r) =>
              `${r.functionResponse.name}: ${r.functionResponse.response.content}`,
          )
          .join("\n");
        this.history.create(this.sessionId, {
          role: "assistant",
          content: summary,
          timestamp: Date.now(),
        });

        chat = await this.createGeminiChat();
        const toolNames = (await this.getUnifiedTools()).map((t) => t.name);
        const continueMsg = `Sistema mutado. Herramientas: ${toolNames.join(", ")}. Continúa la tarea original.`;
        this.history.create(this.sessionId, {
          role: "user",
          content: continueMsg,
          timestamp: Date.now(),
        });
        result = await chat.sendMessage(continueMsg);

        // Record token usage from Gemini post-mutation response
        const mutationUsage = result.response.usageMetadata;
        if (mutationUsage) {
          const mutTokens =
            (mutationUsage.promptTokenCount || 0) +
            (mutationUsage.candidatesTokenCount || 0);
          if (mutTokens > 0) {
            this.recordMetric("tokens", mutTokens);
          }
        }
      } else {
        result = await chat.sendMessage(results);
      }

      // Record token usage from Gemini follow-up responses
      const loopUsage = result.response.usageMetadata;
      if (loopUsage) {
        const loopTokens =
          (loopUsage.promptTokenCount || 0) +
          (loopUsage.candidatesTokenCount || 0);
        if (loopTokens > 0) {
          this.recordMetric("tokens", loopTokens);
        }
      }

      calls = result.response.functionCalls();
    }

    const final = result.response.text();
    if (final) {
      log.info({ response: final.substring(0, 200) }, "Respuesta de Gemini");
      this.history.create(this.sessionId, {
        role: "assistant",
        content: final,
        timestamp: Date.now(),
      });
    }
  }

  private async runNvidiaLoop(text: string) {
    let processing = true;
    let iterations = 0;
    const MAX_ITERATIONS = 10;

    while (processing && iterations < MAX_ITERATIONS) {
      iterations++;

      const messages = this.history.toMessages(this.sessionId).map((m) => {
        let role: "system" | "user" | "assistant" = "assistant";
        if (m.role === "user") role = "user";
        else if (m.role === "system") role = "system";
        return { role, content: m.content };
      });

      const tools = await this.getNvidiaTools();

      const payload: Record<string, unknown> = {
        model: this.nvidiaModel,
        messages,
        max_tokens: 1024,
        temperature: 0.2,
        top_p: 0.7,
        stream: false,
      };

      if (tools.length > 0) {
        payload.tools = tools;
        payload.tool_choice = "auto";
      }

      const response: AxiosResponse = await axios.post(
        `${this.nvidiaBaseUrl}/chat/completions`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${this.nvidiaApiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          timeout: 60_000,
        },
      );

      const choice = response.data.choices?.[0];
      if (!choice) break;

      // Record token usage from NVIDIA response
      const nvidiaUsage = response.data.usage;
      if (nvidiaUsage) {
        const totalTokens =
          (nvidiaUsage.prompt_tokens || 0) +
          (nvidiaUsage.completion_tokens || 0);
        if (totalTokens > 0) {
          this.recordMetric("tokens", totalTokens);
        }
      }

      const assistantMessage = choice.message;

      if (assistantMessage.content) {
        this.history.create(this.sessionId, {
          role: "assistant",
          content: assistantMessage.content,
          timestamp: Date.now(),
        });
        log.info(
          { response: assistantMessage.content.substring(0, 200) },
          "Respuesta de NVIDIA",
        );
      }

      const toolCalls = assistantMessage.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          const toolName = toolCall.function.name;
          let toolArgs: Record<string, unknown> = {};
          try {
            toolArgs = JSON.parse(toolCall.function.arguments);
          } catch {
            log.warn(
              { raw: toolCall.function.arguments },
              "Args inválidos de NVIDIA",
            );
          }

          log.info(
            { tool: toolName, iteration: iterations },
            "Ejecutando herramienta (NVIDIA)",
          );
          const output = await this.executeAction(toolName, toolArgs);

          this.history.create(this.sessionId, {
            role: "user",
            content: JSON.stringify({
              type: "tool_result",
              tool_call_id: toolCall.id,
              name: toolName,
              content: output,
            }),
            timestamp: Date.now(),
          });
        }
      } else {
        processing = false;
      }
    }
  }

  /**
   * Override chatStream to track session active state for reconfigure queuing.
   * Also enforces token limit before streaming.
   */
  public override async *chatStream(
    userMessage: string,
  ): AsyncGenerator<string> {
    // ── Token Limit Enforcement ─────────────────────────────────────────────
    // Check if tenant has exceeded their monthly token limit BEFORE any LLM call
    this.checkTokenLimit();

    this._sessionActive = true;
    try {
      yield* super.chatStream(userMessage);
    } finally {
      this._sessionActive = false;
      this.flushPendingConfig();
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const master = new UnifiedCortex();
  await master.init();
  log.info("Cortex Unificado listo");
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ask = () => {
    rl.question("👤 [TÚ]: ", async (input) => {
      if (input.toLowerCase() === "salir") return rl.close();
      await master.chat(input);
      ask();
    });
  };
  ask();
}

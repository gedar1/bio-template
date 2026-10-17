import { initTelemetry, createLogger } from "../../config/logger.js";
initTelemetry();

import {
  BaseOrchestrator,
  type OrchestratorOptions,
} from "../BaseOrchestrator.js";
import { CircuitBreaker } from "../../infrastructure/CircuitBreaker.js";
import {
  CircuitOpenError,
  GuardrailBlockedError,
  MutationError,
  ProviderError,
  ToolExecutionError,
  ValidationError,
} from "../../errors.js";
import { preCellRoute } from "../../atoms/cellRouter.js";
import type { RouterHistoryEntry } from "../../atoms/cellRouter.js";
import {
  DEFAULT_LLM_PROVIDER_CONFIG,
  LLMProviderNameSchema,
  type LLMProviderConfig,
  type LLMProviderName,
} from "../../config/llmTypes.js";
import {
  createProviderFactory,
  type ProviderFactory,
} from "../providers/providerFactory.js";
import type { ILLMProvider } from "../providers/ILLMProvider.js";
import {
  normalizeTools,
  normalizeLLMRequest,
  type LLMMessage,
  type LLMRequest,
  type LLMResponse,
  type LLMStreamEvent,
  type LLMToolCall,
} from "../providers/index.js";
import type { ILogger } from "../../config/ILogger.js";
import type { IUsageMetricsSink } from "../interfaces/IUsageMetricsSink.js";
import type { ITenantTokenLimitReader } from "../interfaces/ITenantTokenLimitReader.js";

const log = createLogger("UnifiedCortex");
const MAX_ITERATIONS = 10;

type BreakerMap = ReadonlyMap<LLMProviderName, CircuitBreaker>;

export interface UnifiedCortexOptions extends OrchestratorOptions {
  readonly tenantId?: string;
  readonly primaryProvider?: LLMProviderName;
  readonly fallbackOrder?: readonly LLMProviderName[];
  readonly providers?: ReadonlyMap<LLMProviderName, ILLMProvider>;
  readonly providerFactory?: ProviderFactory;
  readonly providerEnv?: Readonly<Record<string, string | undefined>>;
  readonly metrics?: IUsageMetricsSink;
  readonly tenantLimits?: ITenantTokenLimitReader;
  readonly singleProvider?: boolean;
}

interface StreamResult {
  readonly deltas: readonly string[];
  readonly response: LLMResponse;
}

export class UnifiedCortex extends BaseOrchestrator {
  readonly claudeBreaker: CircuitBreaker;
  readonly geminiBreaker: CircuitBreaker;
  readonly nvidiaBreaker: CircuitBreaker;
  readonly summarizerBreaker: CircuitBreaker;

  private readonly providers: ReadonlyMap<LLMProviderName, ILLMProvider>;
  private readonly breakers: BreakerMap;
  private tenantId: string | null;
  private metrics: IUsageMetricsSink | null;
  private tenantLimits: ITenantTokenLimitReader | null;
  private readonly singleProvider: boolean;
  private providerConfig: LLMProviderConfig;
  private sessionActive = false;
  private pendingConfig: LLMProviderConfig | null = null;

  constructor(options: UnifiedCortexOptions = {}) {
    super(options);
    this.tenantId = options.tenantId ?? null;
    this.metrics = options.metrics ?? null;
    this.tenantLimits = options.tenantLimits ?? null;
    this.singleProvider = options.singleProvider ?? false;

    const factory =
      options.providerFactory ??
      createProviderFactory({
        env: options.providerEnv,
        logger: options.logger,
      });
    this.providers = options.providers ?? factory({ env: options.providerEnv });

    const makeBreaker = (provider: LLMProviderName): CircuitBreaker =>
      new CircuitBreaker({
        name: provider,
        failureThreshold: 3,
        resetTimeout: 60_000,
        logger: options.logger,
        onOpen: () => log.warn(`${provider} circuit OPEN`),
        onClose: () => log.info(`${provider} circuit CLOSED`),
      });
    this.claudeBreaker = makeBreaker("claude");
    this.geminiBreaker = makeBreaker("gemini");
    this.nvidiaBreaker = makeBreaker("nvidia");
    this.summarizerBreaker = new CircuitBreaker({
      name: "claude-summarizer",
      failureThreshold: 3,
      resetTimeout: 60_000,
      logger: options.logger,
    });
    this.breakers = new Map([
      ["claude", this.claudeBreaker],
      ["gemini", this.geminiBreaker],
      ["nvidia", this.nvidiaBreaker],
    ]);

    this.providerConfig = this.normalizeConfig({
      primaryProvider:
        options.primaryProvider ?? DEFAULT_LLM_PROVIDER_CONFIG.primaryProvider,
      fallbackOrder: [
        ...(options.fallbackOrder ?? DEFAULT_LLM_PROVIDER_CONFIG.fallbackOrder),
      ],
    });

    const claude = this.providers.get("claude");
    if (claude) {
      this.setSummarizer(async (messages) => {
        const response = await this.summarizerBreaker.execute(() =>
          claude.complete({
            messages,
            tools: [],
            model: "claude-haiku-4-5",
            maxTokens: 400,
          }),
        );
        return response.text;
      });
    }
  }

  public reconfigure(config: Partial<LLMProviderConfig>): void {
    const baseConfig = this.pendingConfig ?? this.providerConfig;
    const next = this.normalizeConfig({
      primaryProvider: config.primaryProvider ?? baseConfig.primaryProvider,
      fallbackOrder: config.fallbackOrder ?? baseConfig.fallbackOrder,
    });
    if (this.sessionActive) {
      this.pendingConfig = next;
      return;
    }
    this.providerConfig = next;
  }

  public isSessionActive(): boolean {
    return this.sessionActive;
  }

  public getProviderConfig(): LLMProviderConfig {
    return {
      primaryProvider: this.providerConfig.primaryProvider,
      fallbackOrder: [...this.providerConfig.fallbackOrder],
    };
  }

  public getCircuitBreakers(): BreakerMap {
    return this.breakers;
  }

  public setMetricsCollector(
    metrics: IUsageMetricsSink,
    tenantId: string,
  ): void {
    this.metrics = metrics;
    this.tenantId = tenantId;
  }

  public setTenantRegistry(registry: ITenantTokenLimitReader): void {
    this.tenantLimits = registry;
  }

  public async chat(userMessage: string): Promise<void> {
    this.sessionActive = true;
    try {
      await this.checkTokenLimit();
      const final = await this.runConversation(userMessage, false);
      void final;
      this.recordMetric("task_completed", 1);
      await this.saveReflex();
    } catch (error: unknown) {
      this.recordMetric("task_error", 1);
      throw error;
    } finally {
      this.sessionActive = false;
      this.flushPendingConfig();
    }
  }

  public override async *chatStream(
    userMessage: string,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    this.sessionActive = true;
    try {
      await this.checkTokenLimit();
      yield* super.chatStream(userMessage, signal);
    } catch (error: unknown) {
      this.recordMetric("task_error", 1);
      throw error;
    } finally {
      this.sessionActive = false;
      this.flushPendingConfig();
    }
  }

  protected override async *streamFromLLM(
    userMessage: string,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const result = await this.runConversation(userMessage, true, signal, true);
    if (result) yield result;
    this.recordMetric("task_completed", 1);
    await this.saveReflex();
  }

  private async runConversation(
    userMessage: string,
    streaming: boolean,
    signal?: AbortSignal,
    reflexPrepared = false,
  ): Promise<string> {
    const cleanText = userMessage.replace(/^\/(claude|gemini|nvidia)\s*/i, "");
    if (!reflexPrepared) {
      this.trackInput(cleanText);
      const match = await this.queryReflex(cleanText);
      if (match?.mode === "reflex") {
        const results = await this.executeReflex(match);
        const content = results.at(-1) ?? "✅ Tarea completada.";
        this.addHistoryMessage(this.getSessionId(), {
          role: "assistant",
          content,
          timestamp: Date.now(),
        });
        return streaming ? content : "";
      }
      if (match?.mode === "hint") {
        this.addHistoryMessage(this.getSessionId(), {
          role: "system",
          content: `[Memoria Refleja] Secuencia exitosa anterior: ${match.record.sequence}. Úsala como guía si aplica.`,
          timestamp: Date.now(),
        });
      }
    }

    let effectsStarted = await this.preRoute(cleanText);
    this.addHistoryMessage(this.getSessionId(), {
      role: "user",
      content: cleanText,
      timestamp: Date.now(),
    });

    await this.refreshTools();
    const chain = this.providerChain();
    const attempts: Array<{
      provider: LLMProviderName;
      category: ProviderError["category"];
      status?: number;
      message: string;
    }> = [];
    for (let index = 0; index < chain.length; index += 1) {
      const provider = chain[index];
      try {
        const streamResult = streaming
          ? await this.transportStream(provider, this.buildRequest(signal))
          : undefined;
        const response = streaming
          ? streamResult!.response
          : await this.transportComplete(provider, this.buildRequest(signal));
        this.recordUsage(response);

        if (response.toolCalls.length === 0) {
          this.addAssistant(response);
          return streaming
            ? streamResult!.deltas.join("") || response.text
            : response.text;
        }

        this.addAssistant(response);
        await this.executeToolCalls(response.toolCalls, () => {
          effectsStarted = true;
        });
        await this.refreshTools();
        if (index !== 0 || effectsStarted) {
          // The active provider is fixed after the first tool response.
        }
        for (let iteration = 1; iteration < MAX_ITERATIONS; iteration += 1) {
          await this.refreshTools();
          const nextStream = streaming
            ? await this.transportStream(provider, this.buildRequest(signal))
            : undefined;
          const next = streaming
            ? nextStream!.response
            : await this.transportComplete(provider, this.buildRequest(signal));
          this.recordUsage(next);
          if (next.toolCalls.length === 0) {
            this.addAssistant(next);
            return streaming
              ? nextStream!.deltas.join("") || next.text
              : next.text;
          }
          this.addAssistant(next);
          await this.executeToolCalls(next.toolCalls, () => {
            effectsStarted = true;
          });
          await this.refreshTools();
        }
        throw new ProviderError(
          provider.name,
          "internal",
          "Se alcanzó el límite de 10 vueltas",
          {
            retryable: false,
            safeContext: { reason: "iteration_limit" },
          },
        );
      } catch (error: unknown) {
        const normalized = this.asProviderError(provider.name, error);
        if (
          !(error instanceof ToolExecutionError) &&
          !(error instanceof GuardrailBlockedError) &&
          !(error instanceof MutationError)
        ) {
          this.recordMetric("cortex_error", 1);
        }
        attempts.push({
          provider: provider.name,
          category: normalized.category,
          ...(normalized.status !== undefined
            ? { status: normalized.status }
            : {}),
          message: normalized.message,
        });
        if (
          effectsStarted ||
          !normalized.retryable ||
          index === chain.length - 1
        ) {
          if (
            !effectsStarted &&
            index === chain.length - 1 &&
            attempts.length > 1
          ) {
            throw new ProviderError(
              "all",
              normalized.category,
              "Todos los providers fallaron",
              {
                status: normalized.status,
                retryable: false,
                attempts,
              },
            );
          }
          if (attempts.length > 1 && normalized.retryable && effectsStarted) {
            throw new ProviderError(
              "all",
              normalized.category,
              normalized.message,
              {
                status: normalized.status,
                retryable: false,
                attempts,
              },
            );
          }
          throw normalized;
        }
      }
    }

    throw new ProviderError("all", "internal", "Todos los providers fallaron", {
      retryable: false,
      attempts,
    });
  }

  private buildRequest(signal?: AbortSignal): LLMRequest {
    const tools = normalizeTools(this.getUnifiedToolsSync());
    return {
      messages: this.getStructuredHistory(),
      tools,
      ...(signal ? { signal } : {}),
    };
  }

  private getUnifiedToolsSync(): readonly import("../providers/providerTypes.js").LLMTool[] {
    // getUnifiedTools is async because MCP inspection may cross a process boundary.
    // The current snapshot is populated synchronously by the coordinator before each request.
    return this.toolSnapshot;
  }

  private toolSnapshot: readonly import("../providers/providerTypes.js").LLMTool[] =
    [];

  private async refreshTools(): Promise<void> {
    this.toolSnapshot =
      (await this.getUnifiedTools()) as unknown as readonly import("../providers/providerTypes.js").LLMTool[];
  }

  private async preRoute(input: string): Promise<boolean> {
    const firstOrg = this.organisms[0];
    const allowedCells = firstOrg?.getAllowedCells();
    if (!allowedCells?.length) return false;
    const recentHistory: RouterHistoryEntry[] = this.getHistory()
      .slice(-4)
      .filter((entry) => entry.role === "user" || entry.role === "assistant")
      .map((entry) => ({
        role: entry.role as "user" | "assistant",
        content: entry.content,
      }));
    const route = await preCellRoute(input, recentHistory, allowedCells);
    if (!route || this._mutatedTypes.has(route.cellType)) return false;
    await this.routeStimulus({
      type: route.cellType,
      source: "jev-pre-router",
      metadata: {
        confidence: route.confidence,
        complexityScore: route.complexityScore,
      },
    });
    this._mutatedTypes.add(route.cellType);
    return true;
  }

  private async executeToolCalls(
    calls: readonly LLMToolCall[],
    onSuccess: () => void,
  ): Promise<void> {
    for (let index = 0; index < calls.length; index += 1) {
      const call = calls[index];
      try {
        const result = await this.executeAction(call.name, call.arguments);
        onSuccess();
        this.historyManager.addStructuredMessage(this.getSessionId(), {
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: result,
          isError: false,
        });
      } catch (error: unknown) {
        const message =
          error instanceof ProviderError ||
          error instanceof ToolExecutionError ||
          error instanceof GuardrailBlockedError ||
          error instanceof MutationError
            ? error.code
            : "TOOL_EXECUTION_ERROR";
        for (const pending of calls.slice(index)) {
          this.historyManager.addStructuredMessage(this.getSessionId(), {
            role: "tool",
            toolCallId: pending.id,
            name: pending.name,
            content: `[${message}]`,
            isError: true,
          });
        }
        throw error;
      }
    }
  }

  private addAssistant(response: LLMResponse): void {
    this.historyManager.addStructuredMessage(this.getSessionId(), {
      role: "assistant",
      content: response.text || null,
      toolCalls: response.toolCalls,
    });
  }

  private providerChain(): ILLMProvider[] {
    const names = [
      this.providerConfig.primaryProvider,
      ...this.providerConfig.fallbackOrder,
    ];
    const unique = [...new Set(names)];
    return unique
      .map((name) => this.providers.get(name))
      .filter((provider): provider is ILLMProvider => provider !== undefined);
  }

  private async transportComplete(
    provider: ILLMProvider,
    request: LLMRequest,
  ): Promise<LLMResponse> {
    const breaker = this.breakers.get(provider.name);
    if (!breaker)
      throw new ProviderError(
        provider.name,
        "internal",
        "Breaker no configurado",
        { retryable: false },
      );
    try {
      const normalized = normalizeLLMRequest(request);
      return await breaker.execute(() => provider.complete(normalized));
    } catch (error: unknown) {
      throw this.asProviderError(provider.name, error);
    }
  }

  private async transportStream(
    provider: ILLMProvider,
    request: LLMRequest,
  ): Promise<StreamResult> {
    const breaker = this.breakers.get(provider.name);
    if (!breaker)
      throw new ProviderError(
        provider.name,
        "internal",
        "Breaker no configurado",
        { retryable: false },
      );
    try {
      const normalized = normalizeLLMRequest(request);
      return await breaker.execute(async () => {
        const deltas: string[] = [];
        let completed: LLMResponse | undefined;
        for await (const event of provider.stream(normalized)) {
          if (event.type === "text_delta") deltas.push(event.text);
          else if (completed)
            throw new ProviderError(
              provider.name,
              "malformed_response",
              "Stream con completed duplicado",
              { retryable: true },
            );
          else completed = event.response;
        }
        if (!completed)
          throw new ProviderError(
            provider.name,
            "malformed_response",
            "Stream sin completed",
            { retryable: true },
          );
        return { deltas, response: completed };
      });
    } catch (error: unknown) {
      throw this.asProviderError(provider.name, error);
    }
  }

  private asProviderError(
    provider: LLMProviderName,
    error: unknown,
  ): ProviderError {
    if (error instanceof ProviderError) return error;
    if (error instanceof ValidationError) throw error;
    if (error instanceof CircuitOpenError) {
      return new ProviderError(provider, "circuit_open", error.message, {
        retryable: true,
      });
    }
    if (error instanceof ValidationError) {
      return new ProviderError(provider, "internal", error.message, {
        retryable: false,
      });
    }
    if (
      error instanceof ToolExecutionError ||
      error instanceof GuardrailBlockedError ||
      error instanceof MutationError
    ) {
      throw error;
    }
    return new ProviderError(
      provider,
      "internal",
      error instanceof Error ? error.message : "Error interno del provider",
      { retryable: false },
    );
  }

  private recordUsage(response: LLMResponse): void {
    this.recordMetric("tokens", response.usage.totalTokens);
  }

  private recordMetric(
    event: "tokens" | "task_completed" | "task_error" | "cortex_error",
    value: number,
  ): void {
    if (!this.metrics || !this.tenantId) return;
    try {
      this.metrics.record(this.tenantId, event, value);
    } catch (error: unknown) {
      log.warn("No se pudo registrar métrica", {
        event,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  private async checkTokenLimit(): Promise<void> {
    if (!this.metrics || !this.tenantLimits || !this.tenantId) return;
    const tenant = this.tenantLimits.getById(this.tenantId);
    if (!tenant || tenant.token_limit === 0) return;
    const current = this.metrics.getCurrentMonthTokens(this.tenantId);
    if (current >= tenant.token_limit) {
      throw new ValidationError(
        `Límite de tokens alcanzado para '${this.tenantId}'`,
        {
          tenantId: this.tenantId,
        },
      );
    }
  }

  private normalizeConfig(config: LLMProviderConfig): LLMProviderConfig {
    if (!LLMProviderNameSchema.safeParse(config.primaryProvider).success) {
      throw new ValidationError(
        `Proveedor LLM desconocido: ${String(config.primaryProvider)}`,
      );
    }
    const fallback = [...config.fallbackOrder];
    for (const provider of fallback) {
      if (!LLMProviderNameSchema.safeParse(provider).success) {
        throw new ValidationError(
          `Proveedor fallback desconocido: ${String(provider)}`,
        );
      }
    }
    if (!this.singleProvider && fallback.length === 0) {
      throw new ValidationError(
        "La configuración unificada requiere fallbackOrder",
      );
    }
    return {
      primaryProvider: config.primaryProvider,
      fallbackOrder: [
        ...new Set(
          fallback.filter((provider) => provider !== config.primaryProvider),
        ),
      ],
    };
  }

  private flushPendingConfig(): void {
    if (!this.pendingConfig) return;
    this.providerConfig = this.pendingConfig;
    this.pendingConfig = null;
  }
}

import { UnifiedCortex } from "../system/implementations/UnifiedCortex.js";
import {
  DEFAULT_LLM_PROVIDER_CONFIG,
  LLMProviderNameSchema,
  resolveInitialProvider,
  type LLMProviderConfig,
  type LLMProviderName,
} from "../config/llmTypes.js";
import { BaseOrganisms } from "../organisms/BaseOrganisms.js";
import { createLogger } from "../config/logger.js";
import { TenantError, ValidationError } from "../errors.js";
import {
  getAvailableProfiles,
  getDefaultProfile,
} from "../config/profileRegistry.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getModuleDir } from "../atoms/paths.js";
import type { TenantRegistryService } from "./services/TenantRegistryService.js";
import type { IUsageMetricsSink } from "../system/interfaces/IUsageMetricsSink.js";
import type { CircuitState } from "../infrastructure/CircuitBreaker.js";
import type {
  ExecutionChainNode,
  ExecutionDependency,
  ExecutionOrderResolution,
  MultiIntentSequenceDetectionResult,
  SemanticRouteResultV3,
} from "./types/semantic.js";

const __dirname = getModuleDir(import.meta.url);

const log = createLogger("TenantManager");

// ============= Fase 2: Intent Detection + LLM Verification =============
const HIGH_CONFIDENCE_THRESHOLD = 75; // Fase 3: multi-intent ≥ 75%
const MEDIUM_CONFIDENCE_THRESHOLD = 60;

interface IntentDetectionResult {
  activated: Array<{ id: number; task_summary: string; confidence: number }>;
  candidates: Array<{ id: number; task_summary: string; confidence: number }>;
  ignored: Array<{ id: number; task_summary: string; confidence: number }>;
}

interface LLMVerificationResult {
  reflexId: number;
  decision: "accept" | "reject";
  reasoning: string;
}
// =========================================================================

const tenantProfiles: {
  profiles: Record<string, TenantProfile>;
  defaultProfile: string;
} = {
  profiles: Object.fromEntries(
    Object.entries(getAvailableProfiles()).map(([profileId, profile]) => [
      profileId,
      {
        description: profile.description ?? "",
        allowedCells: profile.allowedCells,
        agentFile: profile.agentFile,
      },
    ]),
  ),
  defaultProfile: getDefaultProfile(),
};

export interface TenantProfile {
  description: string;
  allowedCells: string[];
  agentFile: string;
}

export interface SemanticRouteRanking {
  id: number;
  task_summary: string;
  confidence: number; // 0-100
  reliability: "high" | "medium" | "low"; // Based on Jev confidence
}

export interface SemanticRouteResult {
  ranking: SemanticRouteRanking[];
  top_match: SemanticRouteRanking | null;
  model_confidence: number; // Jev's confidence in the top match (0-1)
  escalate_to_llm: boolean; // True if confidence too low, route to full LLM
  phase: "fast-search" | "jev-reranking"; // Which phase was used

  // Fase 2: nuevos campos
  activated_reflexes: number[]; // IDs de reflexes con confidence >= 85%
  candidate_reflexes: number[]; // IDs de reflexes con 60% < confidence < 85%
  multi_intent_detected: boolean; // true si hay >=2 intents distintos detectados
  verification_results: Record<
    string,
    { llm_decision: "accept" | "reject"; reasoning: string }
  >; // Resultados de verificación por reflexId

  // Fase 3: Multi-Intent Composition (nuevos campos)
  execution_chain?: ExecutionChainNode[]; // Cadena de ejecución ordenada
  execution_strategy?: "sequential" | "parallel"; // Estrategia de ejecución
  total_reflexes_activated?: number; // Número total de reflexes activados
  intent_count?: number; // Número de intents detectados
  execution_dependencies?: ExecutionDependency[]; // Dependencias detectadas
}

export interface TenantManagerDeps {
  readonly maxTenants?: number;
  readonly idleTimeoutMs?: number;
  readonly registry?: TenantRegistryService;
  readonly metrics?: IUsageMetricsSink;
}

export interface CircuitBreakerSnapshot {
  readonly provider: LLMProviderName;
  readonly state: CircuitState;
  readonly failureCount: number;
  readonly lastFailureTimestamp: number | null;
  readonly estimatedRecoveryMs: number | null;
}

class TenantOrganism extends BaseOrganisms {
  constructor(tenantId: string, allowedCells?: string[]) {
    super(`Tenant-${tenantId}`, allowedCells);
  }
  async process(intention: any): Promise<any> {
    return intention;
  }
}

export interface TenantInfo {
  id: string;
  cortex: UnifiedCortex;
  profile: string;
  createdAt: number;
  lastActivity: number;
  /** When true, the session should reload its cell configuration on next request */
  needsReload: boolean;
}

/**
 * Gestiona múltiples tenants (clientes), cada uno con su propio
 * Cortex, organismos, historial y estado de célula aislados.
 */
export class TenantManager {
  readonly tenants: Map<string, TenantInfo> = new Map();
  private readonly maxTenants: number;
  private readonly idleTimeoutMs: number;
  private readonly registry: TenantRegistryService | null;
  private readonly metrics: IUsageMetricsSink | null;
  private readonly tenantQueues = new Map<string, Promise<void>>();
  private desiredConfig: LLMProviderConfig;

  constructor(deps: TenantManagerDeps = {}) {
    this.maxTenants = deps.maxTenants ?? 50;
    this.idleTimeoutMs = deps.idleTimeoutMs ?? 30 * 60 * 1000;
    this.registry = deps.registry ?? null;
    this.metrics = deps.metrics ?? null;
    this.desiredConfig = normalizeProviderConfig({
      primaryProvider: resolveInitialProvider(process.env.LLM_PROVIDER),
      fallbackOrder: [...DEFAULT_LLM_PROVIDER_CONFIG.fallbackOrder],
    });
  }

  /**
   * Obtiene o crea un Cortex para el tenant indicado.
   * @param tenantId - Identificador único del tenant
   * @param profileName - Perfil de dominio (default: env TENANT_PROFILE o el perfil editable)
   */
  async getTenant(tenantId: string, profileName?: string): Promise<TenantInfo> {
    const existing = this.tenants.get(tenantId);
    if (existing) {
      existing.lastActivity = Date.now();

      // If marked for reload (e.g. profile changed), recreate with new profile
      if (existing.needsReload) {
        log.info({ tenantId }, "Session marked for reload — recreating tenant");
        this.tenants.delete(tenantId);
        // Recurse to create fresh session with the new profile
        return this.getTenant(tenantId, profileName ?? existing.profile);
      }

      return existing;
    }

    // Check tenant status in registry before creating a new session
    if (this.registry) {
      const registryRecord = this.registry.getById(tenantId);
      if (registryRecord?.status === "inactive") {
        throw new TenantError(
          tenantId,
          `Tenant '${tenantId}' is inactive and cannot create sessions`,
        );
      }
    }

    // Limpiar tenants idle si estamos al límite
    if (this.tenants.size >= this.maxTenants) {
      this.evictIdle();
    }

    if (this.tenants.size >= this.maxTenants) {
      throw new TenantError(
        tenantId,
        `Límite de tenants alcanzado (${this.maxTenants}).`,
      );
    }

    const profile =
      profileName || process.env.TENANT_PROFILE || getDefaultProfile();

    log.info({ tenantId, profile }, "Creando nuevo tenant");

    const cortex = new UnifiedCortex({
      tenantId,
      primaryProvider: this.desiredConfig.primaryProvider,
      fallbackOrder: [...this.desiredConfig.fallbackOrder],
      metrics: this.metrics ?? undefined,
      tenantLimits: this.registry ?? undefined,
    });

    // Obtener allowedCells del perfil — primero buscar en composed profiles,
    // luego fallback a los perfiles cargados del JSON
    const composedProfiles = getAvailableProfiles();
    const profileConfig =
      composedProfiles[profile] || tenantProfiles.profiles[profile];
    const allowedCells = profileConfig?.allowedCells;

    cortex.registerOrganism(new TenantOrganism(tenantId, allowedCells));
    await cortex.init();

    // Inyectar contexto del agente de dominio desde archivo .md
    if (profileConfig?.agentFile) {
      const agentPrompt = this.loadAgentFile(profileConfig.agentFile);
      if (agentPrompt) {
        cortex.addHistoryMessage(cortex.getSessionId(), {
          role: "system",
          content: agentPrompt,
          timestamp: Date.now(),
        });
      }
    }

    const tenant: TenantInfo = {
      id: tenantId,
      cortex,
      profile,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      needsReload: false,
    };

    this.tenants.set(tenantId, tenant);
    log.info(
      { tenantId, profile, totalTenants: this.tenants.size },
      "Tenant listo",
    );
    return tenant;
  }

  /** Instala una configuración efectiva para tenants existentes y futuros. */
  reconfigureAll(config: LLMProviderConfig): void {
    const next = normalizeProviderConfig(config);
    this.desiredConfig = next;
    for (const tenant of this.tenants.values()) {
      tenant.cortex.reconfigure({
        primaryProvider: next.primaryProvider,
        fallbackOrder: [...next.fallbackOrder],
      });
    }
  }

  /** Devuelve la configuración efectiva usada por tráfico multi-tenant. */
  getProviderConfig(): LLMProviderConfig {
    return {
      primaryProvider: this.desiredConfig.primaryProvider,
      fallbackOrder: [...this.desiredConfig.fallbackOrder],
    };
  }

  /** Devuelve breakers de todos los Cortex de tráfico, sin compartirlos entre tenants. */
  getCircuitBreakerSnapshot(): CircuitBreakerSnapshot[] {
    const snapshots: CircuitBreakerSnapshot[] = [];
    for (const tenant of this.tenants.values()) {
      for (const [provider, breaker] of tenant.cortex.getCircuitBreakers()) {
        const state = breaker.getState();
        const lastFailureTime = breaker.getLastFailureTime();
        snapshots.push({
          provider,
          state,
          failureCount: breaker.getFailureCount(),
          lastFailureTimestamp: lastFailureTime > 0 ? lastFailureTime : null,
          estimatedRecoveryMs:
            state === "OPEN" && lastFailureTime > 0
              ? Math.max(
                  0,
                  breaker.getResetTimeout() - (Date.now() - lastFailureTime),
                )
              : null,
        });
      }
    }
    return snapshots;
  }

  /**
   * Envía un mensaje al Cortex de un tenant.
   */
  async chat(tenantId: string, message: string): Promise<string> {
    const release = await this.acquireTenant(tenantId);
    try {
      const tenant = await this.getTenant(tenantId);
      tenant.lastActivity = Date.now();
      const beforeSize = tenant.cortex.getHistory().length;
      await tenant.cortex.chat(message);
      const messages = tenant.cortex.getHistory();
      const assistantMsg = messages
        .slice(beforeSize)
        .filter((entry) => entry.role === "assistant")
        .pop();
      return assistantMsg?.content || "Sin respuesta";
    } finally {
      release();
    }
  }

  /**
   * Stream de respuesta del Cortex de un tenant.
   * Yields chunks de texto conforme el LLM los genera.
   */
  async *chatStream(
    tenantId: string,
    message: string,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const release = await this.acquireTenant(tenantId);
    try {
      const tenant = await this.getTenant(tenantId);
      tenant.lastActivity = Date.now();
      yield* tenant.cortex.chatStream(message, signal);
    } finally {
      release();
    }
  }

  private async acquireTenant(tenantId: string): Promise<() => void> {
    const previous = this.tenantQueues.get(tenantId) ?? Promise.resolve();
    let releasePromise: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      releasePromise = resolve;
    });
    const queued = previous.then(() => current);
    this.tenantQueues.set(tenantId, queued);
    await previous;
    return () => {
      releasePromise();
      if (this.tenantQueues.get(tenantId) === queued) {
        this.tenantQueues.delete(tenantId);
      }
    };
  }

  /** Elimina un tenant y libera recursos */
  async removeTenant(tenantId: string): Promise<boolean> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;

    log.info({ tenantId }, "Eliminando tenant");
    this.tenants.delete(tenantId);
    return true;
  }

  /**
   * Marks an active session for reload on the next request cycle.
   * Used when a tenant's profile changes to ensure the session picks up
   * the new cell configuration.
   *
   * @returns true if the tenant had an active session that was marked, false otherwise
   */
  markForReload(tenantId: string): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;

    tenant.needsReload = true;
    log.info({ tenantId }, "Session marked for reload on next request");
    return true;
  }

  /** Elimina tenants que llevan más de idleTimeoutMs sin actividad */
  private evictIdle(): void {
    const now = Date.now();
    for (const [id, tenant] of this.tenants) {
      if (now - tenant.lastActivity > this.idleTimeoutMs) {
        log.info(
          {
            tenantId: id,
            idleMinutes: Math.round((now - tenant.lastActivity) / 60000),
          },
          "Evicting idle tenant",
        );
        this.tenants.delete(id);
      }
    }
  }

  /** Info de todos los tenants activos */
  listTenants(): Array<{
    id: string;
    profile: string;
    createdAt: number;
    lastActivity: number;
    idleSeconds: number;
  }> {
    const now = Date.now();
    return Array.from(this.tenants.values()).map((t) => ({
      id: t.id,
      profile: t.profile,
      createdAt: t.createdAt,
      lastActivity: t.lastActivity,
      idleSeconds: Math.round((now - t.lastActivity) / 1000),
    }));
  }

  /**
   * Validates if the authenticated tenant has access to the target tenant's resources.
   *
   * Rules:
   * - If authTenantId is "*" (super_admin), access is always granted.
   * - Otherwise, access is granted only if authTenantId matches targetTenantId.
   *
   * @param authTenantId - The tenant_id from the authenticated context
   * @param targetTenantId - The tenant_id of the resource being accessed
   * @returns true if access is allowed, false otherwise
   */
  validateAccess(authTenantId: string, targetTenantId: string): boolean {
    // super_admin (Platform JWT) has wildcard access
    if (authTenantId === "*") return true;

    // Tenant can only access their own resources
    return authTenantId === targetTenantId;
  }

  /** Obtiene el perfil de un tenant */
  getTenantProfile(tenantId: string): TenantProfile | null {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return null;
    // Check composed profiles first, then fallback to JSON-loaded profiles
    const composedProfiles = getAvailableProfiles();
    const composed = composedProfiles[tenant.profile];
    if (composed) {
      return {
        description: composed.description || "",
        allowedCells: composed.allowedCells,
        agentFile: composed.agentFile,
      };
    }
    return tenantProfiles.profiles[tenant.profile] || null;
  }

  /** Lista todos los perfiles disponibles (composed + JSON-loaded) */
  getAvailableProfilesList(): Record<string, TenantProfile> {
    const composedProfiles = getAvailableProfiles();
    // Merge: composed profiles take priority over JSON-loaded
    const result: Record<string, TenantProfile> = {
      ...tenantProfiles.profiles,
    };
    for (const [id, config] of Object.entries(composedProfiles)) {
      result[id] = {
        description: config.description || "",
        allowedCells: config.allowedCells,
        agentFile: config.agentFile,
      };
    }
    return result;
  }

  /** Carga el archivo .md del agente de dominio */
  private loadAgentFile(filename: string): string | null {
    const paths = [
      join(__dirname, "../", filename),
      join(__dirname, "../../src", filename),
      join(process.cwd(), "packages/core/src", filename),
      join(__dirname, "../config/agents", filename),
      join(__dirname, "../../config/agents", filename),
      join(process.cwd(), "packages/core/dist/config/agents", filename),
      join(process.cwd(), "packages/core/src/config/agents", filename),
      join(process.cwd(), "packages/restaurant/src/config/agents", filename),
      join(process.cwd(), "src/biocore/config/agents", filename),
      join(process.cwd(), "dist/biocore/config/agents", filename),
    ];

    for (const p of paths) {
      try {
        const content = readFileSync(p, "utf-8");
        log.debug({ file: filename, path: p }, "Agent file cargado");
        return content;
      } catch {
        // intentar siguiente path
      }
    }

    log.warn({ file: filename }, "Agent file no encontrado");
    return null;
  }

  get size(): number {
    return this.tenants.size;
  }

  /**
   * Detecta intents múltiples categorizando reflexes por confidence
   * @param userMessage - Entrada del usuario
   * @param jevRanking - Ranking de Jev (confidence en rango 0-100)
   * @returns IntentDetectionResult con 3 buckets: activated, candidates, ignored
   */
  private jevDetectIntents(
    userMessage: string,
    jevRanking: Array<{ id: number; task_summary: string; confidence: number }>,
  ): IntentDetectionResult {
    const activated: Array<{
      id: number;
      task_summary: string;
      confidence: number;
    }> = [];
    const candidates: Array<{
      id: number;
      task_summary: string;
      confidence: number;
    }> = [];
    const ignored: Array<{
      id: number;
      task_summary: string;
      confidence: number;
    }> = [];

    for (const item of jevRanking) {
      if (item.confidence >= HIGH_CONFIDENCE_THRESHOLD) {
        activated.push(item);
      } else if (item.confidence > MEDIUM_CONFIDENCE_THRESHOLD) {
        candidates.push(item);
      } else {
        ignored.push(item);
      }
    }

    log.debug(
      {
        userMessage,
        activated: activated.length,
        candidates: candidates.length,
        ignored: ignored.length,
      },
      "[Detection phase] Intent detection complete",
    );

    return { activated, candidates, ignored };
  }

  /**
   * Verifica con LLM si un reflex candidato resuelve el intent del usuario
   * @param userMessage - Entrada del usuario
   * @param reflex - Reflex a verificar
   * @param cortex - Instancia de Cortex para llamar LLM
   * @returns Decisión (accept/reject) y razonamiento
   */
  private async llmVerifyReflex(
    userMessage: string,
    reflex: { id: number; task_summary: string; confidence: number },
    cortex: UnifiedCortex,
  ): Promise<LLMVerificationResult> {
    try {
      // Construcción de prompt: pregunta concisa si el reflex resuelve el intent
      const verificationPrompt = `Responde SOLO con "accept" o "reject" sin explicación adicional. ¿La tarea "${reflex.task_summary}" resuelve la intención del usuario: "${userMessage}"?`;

      // Llamar LLM a través de Cortex y extraer respuesta del historial
      const beforeSize = cortex.getHistory().length;
      await cortex.chat(verificationPrompt);
      const messages = cortex.getHistory();
      const assistantMsg = messages
        .slice(beforeSize)
        .filter((entry) => entry.role === "assistant")
        .pop();

      const response = assistantMsg?.content || "";

      // Extraer decisión del response (primeras palabras)
      const decision =
        response.toLowerCase().includes("accept") ||
        response.toLowerCase().includes("yes") ||
        response.toLowerCase().startsWith("sí")
          ? "accept"
          : "reject";
      const reasoning = response.substring(0, 150); // Limitar reasoning para logging

      log.debug(
        { reflexId: reflex.id, decision, reasoning },
        "[Verification phase] LLM verification result",
      );

      return {
        reflexId: reflex.id,
        decision,
        reasoning,
      };
    } catch (error: any) {
      log.warn(
        { reflexId: reflex.id, error: error.message },
        "[Verification phase] LLM verification failed, defaulting to reject",
      );
      return {
        reflexId: reflex.id,
        decision: "reject",
        reasoning: `Verification failed: ${error.message}`,
      };
    }
  }

  /**
   * Detecta secuencias implícitas de multi-intent basadas en palabras clave
   * y valida dependencies con Jev
   *
   * @param userMessage - Mensaje del usuario
   * @param intents - Resultado de detección de intents
   * @returns Dependencias detectadas y orden sugerido
   */
  private async detectMultiIntentSequence(
    userMessage: string,
    intents: IntentDetectionResult,
  ): Promise<MultiIntentSequenceDetectionResult> {
    // Palabras clave de secuencia
    const sequenceKeywords = [
      "y",
      "y luego",
      "luego",
      "después",
      "entonces",
      "para",
      ",",
    ];

    const allReflexes = [...intents.activated, ...intents.candidates];
    const dependencies: ExecutionDependency[] = [];
    const sequences: Array<{ primary: number; chained: number[] }> = [];

    log.info(
      {
        reflexCount: allReflexes.length,
        keywords: sequenceKeywords,
      },
      "[Multi-Intent Detection] Searching for sequence keywords",
    );

    // Buscar palabras clave en el mensaje
    const lowerMessage = userMessage.toLowerCase();
    let keywordFound: string | null = null;

    for (const keyword of sequenceKeywords) {
      if (lowerMessage.includes(keyword)) {
        keywordFound = keyword;
        log.info(
          { keyword, position: lowerMessage.indexOf(keyword) },
          "[Multi-Intent Detection] Found sequence keyword",
        );
        break;
      }
    }

    // Si hay palabras clave, validar dependencies entre pares de reflexes
    if (keywordFound && allReflexes.length >= 2) {
      log.info(
        {
          reflexPairs: allReflexes.length * (allReflexes.length - 1),
          keyword: keywordFound,
        },
        "[Dependency Resolution] Validating reflexes for dependencies",
      );

      // Para cada par (reflexA, reflexB), preguntar si reflexA debe preceder a reflexB
      for (let i = 0; i < allReflexes.length; i++) {
        for (let j = 0; j < allReflexes.length; j++) {
          if (i !== j) {
            const reflexA = allReflexes[i];
            const reflexB = allReflexes[j];

            try {
              const { TypeSafeClient, choice } =
                await import("@typesafe-ai/sdk");

              const client = new TypeSafeClient({
                apiKey: process.env.TYPESAFE_API_KEY,
                defaultModel: "jev-latest",
                timeout: 10000,
              });

              // Preguntar si reflexA debe ejecutarse antes que reflexB
              const dependencyQuestion = choice(
                `Does "${reflexA.task_summary}" need to execute before "${reflexB.task_summary}"?`,
                { yes: "yes", no: "no" },
              );

              log.debug(
                {
                  sourceId: reflexA.id,
                  targetId: reflexB.id,
                  sourceTask: reflexA.task_summary,
                  targetTask: reflexB.task_summary,
                },
                "[Dependency Resolution] Asking Jev about dependency",
              );

              const response = await client.systemOne({
                state: userMessage,
                questions: { dependency: dependencyQuestion },
              });

              // Validar respuesta de Jev con tipos específicos
              const choiceResponse = response.answers.dependency as
                | {
                    confidence?: number;
                    choice?: string;
                  }
                | undefined;
              const confidence = Math.round(
                (choiceResponse?.confidence || 0) * 100,
              );
              const answer = (choiceResponse?.choice || "").toLowerCase();

              log.debug(
                {
                  sourceId: reflexA.id,
                  targetId: reflexB.id,
                  answer,
                  confidence,
                },
                "[Dependency Resolution] Jev response received",
              );

              // Si confianza > 80% y respuesta es "yes", agregar dependency
              if (confidence > 80 && answer === "yes") {
                dependencies.push({
                  source_id: reflexA.id,
                  target_id: reflexB.id,
                  confidence,
                  sequence_keyword: keywordFound,
                });

                log.info(
                  {
                    sourceId: reflexA.id,
                    targetId: reflexB.id,
                    confidence,
                    keyword: keywordFound,
                  },
                  "[Dependency Resolution] Dependency detected",
                );
              }
            } catch (error: any) {
              log.warn(
                {
                  sourceId: reflexA.id,
                  targetId: reflexB.id,
                  error: error.message,
                },
                "[Dependency Resolution] Jev validation failed, skipping pair",
              );
            }
          }
        }
      }
    }

    // Calcular implied_order usando topological sort simple
    const impliedOrder = this.topologicalSort(
      allReflexes.map((r) => r.id),
      new Map(dependencies.map((d) => [d.source_id, [d.target_id]])),
    );

    log.info(
      {
        dependencyCount: dependencies.length,
        impliedOrder,
      },
      "[Multi-Intent Detection] Sequence detection complete",
    );

    return {
      sequences,
      implied_order: impliedOrder,
      dependencies,
    };
  }

  /**
   * Resuelve el orden de ejecución usando topological sort
   * Si hay ciclos, fallback a sequential
   *
   * @param activated - Reflexes activados
   * @param dependencies - Mapa de fuente -> [targets]
   * @returns Orden resuelto y estrategia seleccionada
   */
  private resolveExecutionOrder(
    activated: Array<{ id: number; task_summary: string; confidence: number }>,
    dependencies: Map<number, number[]>,
  ): ExecutionOrderResolution {
    const nodeIds = activated.map((r) => r.id);

    log.info(
      {
        nodeCount: nodeIds.length,
        edgeCount: Array.from(dependencies.values()).flat().length,
      },
      "[Execution Plan] Building DAG",
    );

    // Detectar ciclos usando DFS
    const hasCycles = this.detectCycles(nodeIds, dependencies);

    if (hasCycles) {
      log.warn(
        { nodeCount: nodeIds.length },
        "[Execution Plan] Cycles detected, falling back to sequential",
      );

      // Fallback: orden arbitrario, strategy sequential
      const chain: ExecutionChainNode[] = activated.map((reflex, index) => ({
        id: reflex.id,
        task_summary: reflex.task_summary,
        confidence: reflex.confidence,
        status: "activated",
        execution_order: index + 1,
        depends_on: null,
      }));

      return {
        chain,
        strategy: "sequential",
        has_cycles: true,
      };
    }

    // Topological sort (Kahn's algorithm)
    const sorted = this.topologicalSort(nodeIds, dependencies);

    // Si no hay edges, strategy = parallel
    const hasEdges = Array.from(dependencies.values()).flat().length > 0;
    const strategy: "sequential" | "parallel" = hasEdges
      ? "sequential"
      : "parallel";

    log.info(
      {
        sortedOrder: sorted,
        strategy,
        hasEdges,
      },
      "[Execution Plan] Topological sort complete",
    );

    // Construir ExecutionChainNode[] con metadata completa
    const chain: ExecutionChainNode[] = [];
    const depends_onMap = new Map<number, number>();

    // Construir mapa inverso: target -> source (quién depende de quién)
    for (const [source, targets] of dependencies) {
      for (const target of targets) {
        depends_onMap.set(target, source);
      }
    }

    for (let i = 0; i < sorted.length; i++) {
      const reflexId = sorted[i];
      const reflex = activated.find((r) => r.id === reflexId);

      if (reflex) {
        chain.push({
          id: reflexId,
          task_summary: reflex.task_summary,
          confidence: reflex.confidence,
          status: "activated",
          execution_order: i + 1,
          depends_on: depends_onMap.get(reflexId) || null,
        });

        log.debug(
          {
            order: i + 1,
            id: reflexId,
            dependsOn: depends_onMap.get(reflexId) || null,
          },
          "[Execution Plan] Node added to chain",
        );
      }
    }

    return {
      chain,
      strategy,
      has_cycles: false,
    };
  }

  /**
   * Construye la cadena de ejecución con metadata completa
   *
   * @param activated - Reflexes activados con metadata
   * @param orderResolution - Orden resuelto
   * @returns Cadena con todos los campos poblados
   */
  private buildExecutionChain(
    activated: Array<{ id: number; task_summary: string; confidence: number }>,
    orderResolution: ExecutionOrderResolution,
  ): ExecutionChainNode[] {
    // Crear mapa para acceso rápido
    const reflexMap = new Map(activated.map((r) => [r.id, r]));

    // Mapear cada nodo a ExecutionChainNode con status "activated"
    const chain: ExecutionChainNode[] = orderResolution.chain.map((node) => {
      const source = reflexMap.get(node.id);
      return {
        id: node.id,
        task_summary: node.task_summary || source?.task_summary || "",
        confidence: node.confidence || source?.confidence || 0,
        status: "activated",
        execution_order: node.execution_order,
        depends_on: node.depends_on,
      };
    });

    log.info(
      {
        chainLength: chain.length,
        orders: chain.map((n) => ({ id: n.id, order: n.execution_order })),
      },
      "[Execution Strategy] Execution chain built",
    );

    return chain;
  }

  /**
   * Topological sort usando Kahn's algorithm
   * @returns Array de IDs en orden topológico, [] si no se puede resolver
   */
  private topologicalSort(
    nodes: number[],
    dependencies: Map<number, number[]>,
  ): number[] {
    // Calcular in-degree para cada nodo
    const inDegree = new Map<number, number>();
    const adjList = new Map<number, number[]>();

    for (const node of nodes) {
      inDegree.set(node, 0);
      adjList.set(node, []);
    }

    for (const [source, targets] of dependencies) {
      for (const target of targets) {
        if (nodes.includes(target)) {
          inDegree.set(target, (inDegree.get(target) || 0) + 1);
          (adjList.get(source) || []).push(target);
        }
      }
    }

    // Cola de nodos con in-degree 0
    const queue: number[] = [];
    for (const node of nodes) {
      if ((inDegree.get(node) || 0) === 0) {
        queue.push(node);
      }
    }

    const result: number[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);

      // Reducir in-degree de vecinos
      for (const neighbor of adjList.get(current) || []) {
        inDegree.set(neighbor, (inDegree.get(neighbor) || 0) - 1);
        if (inDegree.get(neighbor) === 0) {
          queue.push(neighbor);
        }
      }
    }

    return result;
  }

  /**
   * Detecta ciclos en el grafo de dependencias usando DFS
   */
  private detectCycles(
    nodes: number[],
    dependencies: Map<number, number[]>,
  ): boolean {
    const visited = new Set<number>();
    const recStack = new Set<number>();

    const dfs = (node: number): boolean => {
      visited.add(node);
      recStack.add(node);

      for (const neighbor of dependencies.get(node) || []) {
        if (!visited.has(neighbor)) {
          if (dfs(neighbor)) return true;
        } else if (recStack.has(neighbor)) {
          return true; // Back edge = cycle
        }
      }

      recStack.delete(node);
      return false;
    };

    for (const node of nodes) {
      if (!visited.has(node)) {
        if (dfs(node)) {
          log.warn(
            { nodeId: node },
            "[Execution Plan] Cycle detected starting from node",
          );
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Evaluates semantic route: compares user message against task_summaries
   * from reflexes to determine the best matching reflex.
   *
   * @param tenantId - Tenant ID
   * @param userMessage - User input
   * @returns SemanticRouteResult with ranking and metadata
   */
  async evaluateSemanticRoute(
    tenantId: string,
    userMessage: string,
  ): Promise<SemanticRouteResult> {
    log.info(
      { tenantId, userMessage },
      "=== evaluateSemanticRoute START (Fase 2) ===",
    );

    const tenant = await this.getTenant(tenantId);
    log.info({ tenantId }, "Tenant loaded");

    // Load reflexes from database
    log.info({ tenantId }, "Loading reflexes...");
    const reflexes = await this.listReflexesForSemanticRoute(tenantId);
    log.info({ tenantId, reflexCount: reflexes.length }, "Reflexes loaded");

    if (reflexes.length === 0) {
      log.warn({ tenantId }, "No reflexes found, returning empty ranking");
      return {
        ranking: [],
        top_match: null,
        model_confidence: 0,
        escalate_to_llm: true,
        phase: "fast-search",
        activated_reflexes: [],
        candidate_reflexes: [],
        multi_intent_detected: false,
        verification_results: {},
      };
    }

    // Build routing prompt
    log.info({ tenantId }, "Building routing prompt");
    const routingPrompt = this.buildRoutingPrompt(userMessage, reflexes);
    log.debug(
      { routingPrompt: routingPrompt.substring(0, 200) },
      "Routing prompt built",
    );

    // Call semantic router (2-phase)
    log.info({ tenantId }, "Calling semantic router");
    const rawRanking = await this.callSemanticRouter(
      tenant,
      userMessage,
      routingPrompt,
    );
    log.info({ tenantId, rankingCount: rawRanking.length }, "Ranking returned");

    // Enrich ranking with reliability and escalation logic
    const enrichedRanking = this.enrichRankingWithReliability(rawRanking);

    // ============= Fase 2: Intent Detection + LLM Verification =============
    // Categorizar reflexes por confidence
    const intents = this.jevDetectIntents(userMessage, rawRanking);

    const verificationResults: Record<
      string,
      { llm_decision: "accept" | "reject"; reasoning: string }
    > = {};

    // Verificar cada candidate con LLM
    for (const candidate of intents.candidates) {
      const verified = await this.llmVerifyReflex(
        userMessage,
        candidate,
        tenant.cortex,
      );
      verificationResults[String(verified.reflexId)] = {
        llm_decision: verified.decision,
        reasoning: verified.reasoning,
      };

      // Si LLM acepta, mover a activated
      if (verified.decision === "accept") {
        intents.activated.push(candidate);
        intents.candidates = intents.candidates.filter(
          (c) => c.id !== candidate.id,
        );
      }
    }

    // top_match debe ser siempre del array activated, nunca de candidates
    const topMatch =
      intents.activated.length > 0
        ? enrichedRanking.find((r) => r.id === intents.activated[0].id) || null
        : null;
    const multiIntentDetected = intents.activated.length >= 2;

    // escalate_to_llm si: low reliability O multi-intent detectado
    const escalateToLLM =
      (topMatch && topMatch.reliability === "low") || multiIntentDetected;

    // ============= Fase 3: Multi-Intent Composition =============
    let executionChain: ExecutionChainNode[] = [];
    let executionStrategy: "sequential" | "parallel" = "sequential";
    let intentCount = intents.activated.length;
    let executionDependencies: ExecutionDependency[] = [];

    if (intents.activated.length >= 1) {
      if (intents.activated.length >= 2) {
        log.info(
          { tenantId, activatedCount: intents.activated.length },
          "[Multi-Intent Detection] Multi-intent detected, starting composition",
        );

        // Detectar secuencias implícitas
        const sequenceDetection = await this.detectMultiIntentSequence(
          userMessage,
          intents,
        );

        executionDependencies = sequenceDetection.dependencies;

        log.info(
          {
            dependencyCount: sequenceDetection.dependencies.length,
            impliedOrder: sequenceDetection.implied_order,
          },
          "[Dependency Resolution] Sequence detection complete",
        );

        // Convertir dependencies a Map<source, targets[]>
        const depMap = new Map<number, number[]>();
        for (const dep of sequenceDetection.dependencies) {
          if (!depMap.has(dep.source_id)) {
            depMap.set(dep.source_id, []);
          }
          depMap.get(dep.source_id)!.push(dep.target_id);
        }

        // Resolver orden de ejecución
        const orderResolution = this.resolveExecutionOrder(
          intents.activated,
          depMap,
        );

        log.info(
          {
            strategy: orderResolution.strategy,
            chainLength: orderResolution.chain.length,
            hasCycles: orderResolution.has_cycles,
          },
          "[Execution Plan] Execution order resolved",
        );

        // Construir execution_chain con metadata completa
        executionChain = this.buildExecutionChain(
          intents.activated,
          orderResolution,
        );
        executionStrategy = orderResolution.strategy;

        log.info(
          {
            executionChain: executionChain.map((n) => ({
              id: n.id,
              order: n.execution_order,
            })),
          },
          "[Execution Strategy] Execution chain finalized",
        );
      } else {
        // Single intent: create simple execution chain
        log.info(
          { tenantId, reflexId: intents.activated[0].id },
          "[Single-Intent] Single reflex detected, creating simple chain",
        );

        executionChain = [
          {
            id: intents.activated[0].id,
            task_summary: intents.activated[0].task_summary,
            confidence: intents.activated[0].confidence,
            status: "activated",
            execution_order: 1,
            depends_on: null,
          },
        ];
        executionStrategy = "sequential";

        log.info(
          { chainLength: executionChain.length },
          "[Execution Strategy] Single-intent chain created",
        );
      }
    }

    const result: SemanticRouteResult = {
      ranking: enrichedRanking,
      top_match: topMatch,
      model_confidence: topMatch ? topMatch.confidence / 100 : 0,
      escalate_to_llm: escalateToLLM,
      phase: process.env.TYPESAFE_API_KEY ? "jev-reranking" : "fast-search",
      activated_reflexes: intents.activated.map((r) => r.id),
      candidate_reflexes: intents.candidates.map((r) => r.id),
      multi_intent_detected: multiIntentDetected,
      verification_results: verificationResults,

      // Fase 3 fields
      execution_chain: executionChain,
      execution_strategy: executionStrategy,
      total_reflexes_activated: intents.activated.length,
      intent_count: intentCount,
      execution_dependencies:
        executionDependencies.length > 0 ? executionDependencies : undefined,
    };

    log.info(
      {
        tenantId,
        rankingCount: result.ranking.length,
        activatedCount: intents.activated.length,
        candidateCount: intents.candidates.length,
        multiIntent: multiIntentDetected,
        escalateToLLM,
        executionStrategy: result.execution_strategy,
        chainLength: result.execution_chain?.length || 0,
      },
      "=== evaluateSemanticRoute completed (Fase 1-2-3) ===",
    );

    return result;
  }

  /**
   * Lists reflexes for semantic routing (id + task_summary)
   */
  protected async listReflexesForSemanticRoute(
    tenantId: string,
  ): Promise<Array<{ id: number; task_summary: string }>> {
    try {
      const dbPath = process.env.DATABASE_PATH || "./biocore.db";
      log.info({ dbPath }, "Opening DB for semantic route");

      const Database = (await import("better-sqlite3")).default;
      const db = new Database(dbPath);

      // Query reflexes table for this tenant
      const stmt = db.prepare(`
        SELECT id, task_summary
        FROM reflexes
        ORDER BY success_count DESC, created_at DESC
        LIMIT 150
      `);

      const reflexes = stmt.all() as Array<{
        id: number;
        task_summary: string;
      }>;

      db.close();

      log.info(
        { tenantId, reflexCount: reflexes.length },
        "Loaded reflexes for semantic route",
      );

      return reflexes;
    } catch (error: any) {
      log.error(
        { error: error.message, stack: error.stack },
        "Failed to load reflexes",
      );
      return [];
    }
  }

  /**
   * Builds the prompt structure for semantic routing evaluation
   */
  private buildRoutingPrompt(
    userMessage: string,
    reflexes: Array<{ id: number; task_summary: string }>,
  ): string {
    // Return ONLY numbered task lines, nothing else
    // Format: "1. task_summary\n2. task_summary\n..."
    return reflexes.map((r) => `${r.id}. ${r.task_summary}`).join("\n");
  }

  /**
   * Two-phase semantic routing: Fast Search + Jev Re-ranking
   * Phase 1: Local similarity search to narrow down to Top 15
   * Phase 2: Jev re-ranks only the Top 15 for precision
   */
  protected async callSemanticRouter(
    tenant: TenantInfo,
    userMessage: string,
    basePrompt: string,
  ): Promise<Array<{ id: number; task_summary: string; confidence: number }>> {
    try {
      const reflexes = this.extractReflexesFromPrompt(basePrompt);

      if (reflexes.length === 0) {
        log.warn(
          { tenantId: tenant.id },
          "No reflexes found in prompt, returning empty ranking",
        );
        return [];
      }

      log.info(
        { tenantId: tenant.id, totalReflexes: reflexes.length },
        "Starting single-phase Jev routing",
      );

      // Single-phase: Evaluate ALL reflexes with Jev noul
      if (process.env.TYPESAFE_API_KEY) {
        log.info(
          { tenantId: tenant.id, reflexCount: reflexes.length },
          "Evaluating all reflexes with Jev",
        );
        return await this.jevEvaluateAll(userMessage, reflexes);
      }

      // Fallback: if Jev not available, return empty
      log.warn(
        { tenantId: tenant.id },
        "TYPESAFE_API_KEY not configured, cannot evaluate reflexes",
      );
      return [];
    } catch (error: any) {
      log.error(
        { error: error.message, stack: error.stack, tenantId: tenant.id },
        "Failed to evaluate semantic route",
      );
      throw new TenantError(
        tenant.id,
        `Semantic routing failed: ${error.message}`,
      );
    }
  }

  /**
   * Phase 1: Fast Search - Local similarity matching to identify Top N candidates
   */
  private fastSearchReflexes(
    userMessage: string,
    reflexes: Array<{ id: number; task_summary: string }>,
    topK: number,
  ): Array<{ id: number; task_summary: string; confidence: number }> {
    const userWords = userMessage.toLowerCase().split(/\s+/);
    const scored: Array<{
      id: number;
      task_summary: string;
      confidence: number;
    }> = [];

    for (const reflex of reflexes) {
      const taskWords = reflex.task_summary.toLowerCase().split(/\s+/);
      let matchCount = 0;

      for (const word of userWords) {
        if (taskWords.some((tw) => tw.includes(word) || word.includes(tw))) {
          matchCount++;
        }
      }

      const confidence = Math.min(
        100,
        Math.round(
          (matchCount / Math.max(userWords.length, taskWords.length)) * 100,
        ),
      );

      if (confidence > 0) {
        scored.push({
          id: reflex.id,
          task_summary: reflex.task_summary,
          confidence,
        });
      }
    }

    // Sort by confidence and return top K
    scored.sort((a, b) => b.confidence - a.confidence);
    return scored.slice(0, topK);
  }

  /**
   * Phase 2: Jev Re-ranking - Score each candidate precisely against user intent
   */
  private async jevRerank(
    userMessage: string,
    candidates: Array<{ id: number; task_summary: string; confidence: number }>,
  ): Promise<Array<{ id: number; task_summary: string; confidence: number }>> {
    try {
      const { TypeSafeClient, noul } = await import("@typesafe-ai/sdk");

      const client = new TypeSafeClient({
        apiKey: process.env.TYPESAFE_API_KEY,
        defaultModel: "jev-latest",
        timeout: 10000,
      });

      log.info({ candidateCount: candidates.length }, "Jev re-ranking started");

      // Build batch questions: one noul per candidate
      // Batch up to 10 questions per request for efficiency
      const batchSize = 10;
      const allRescored: Array<{
        id: number;
        task_summary: string;
        confidence: number;
      }> = [];

      for (let i = 0; i < candidates.length; i += batchSize) {
        const batch = candidates.slice(i, i + batchSize);
        const questions: Record<string, any> = {};

        batch.forEach((candidate, idx) => {
          questions[`candidate_${idx}`] = noul(
            `How well does "${candidate.task_summary}" address the user intent: "${userMessage}"?`,
          );
        });

        log.debug(
          {
            batchNumber: Math.floor(i / batchSize) + 1,
            batchSize: batch.length,
          },
          "Submitting batch to Jev",
        );

        const response = await client.systemOne({
          state: userMessage,
          questions,
        });

        // Extract noul scores and convert to confidence (0-1 → 0-100)
        batch.forEach((candidate, idx) => {
          const noulResponse = response.answers[`candidate_${idx}`] as
            | {
                noul?: number;
              }
            | undefined;
          const noulScore = noulResponse?.noul || 0;
          const confidence = Math.round(noulScore * 100);

          allRescored.push({
            id: candidate.id,
            task_summary: candidate.task_summary,
            confidence,
          });
        });

        log.debug(
          {
            batchNumber: Math.floor(i / batchSize) + 1,
            inputTokens: response.usage?.input_tokens,
          },
          "Batch processed",
        );
      }

      // Sort by confidence descending
      allRescored.sort((a, b) => b.confidence - a.confidence);

      log.info(
        {
          rescored: allRescored.length,
          topMatch: allRescored[0] || null,
        },
        "Jev re-ranking complete",
      );

      return allRescored;
    } catch (error: any) {
      log.warn(
        { error: error.message },
        "Jev re-ranking failed, returning Phase 1 results",
      );
      // Fallback to fast search results
      return candidates;
    }
  }

  /**
   * Single-phase: Evaluate ALL reflexes with Jev noul
   */
  private async jevEvaluateAll(
    userMessage: string,
    reflexes: Array<{ id: number; task_summary: string }>,
  ): Promise<Array<{ id: number; task_summary: string; confidence: number }>> {
    try {
      const { TypeSafeClient, noul } = await import("@typesafe-ai/sdk");

      const client = new TypeSafeClient({
        apiKey: process.env.TYPESAFE_API_KEY,
        defaultModel: "jev-latest",
        timeout: 10000,
      });

      log.info(
        { reflexCount: reflexes.length },
        "Jev single-phase evaluation started",
      );

      // Build batch questions: one noul per reflex
      // Batch up to 10 questions per request for efficiency
      const batchSize = 10;
      const allScored: Array<{
        id: number;
        task_summary: string;
        confidence: number;
      }> = [];

      for (let i = 0; i < reflexes.length; i += batchSize) {
        const batch = reflexes.slice(i, i + batchSize);
        const questions: Record<string, any> = {};

        batch.forEach((reflex, idx) => {
          questions[`reflex_${idx}`] = noul(
            `Does "${reflex.task_summary}" solve: "${userMessage}"?`,
          );
        });

        log.debug(
          {
            batchNumber: Math.floor(i / batchSize) + 1,
            batchSize: batch.length,
          },
          "Submitting batch to Jev",
        );

        const response = await client.systemOne({
          state: userMessage,
          questions,
        });

        // Extract noul scores and convert to confidence (0-1 → 0-100)
        batch.forEach((reflex, idx) => {
          const noulResponse = response.answers[`reflex_${idx}`] as
            | {
                noul?: number;
              }
            | undefined;
          const noulScore = noulResponse?.noul || 0;
          const confidence = Math.round(noulScore * 100);

          allScored.push({
            id: reflex.id,
            task_summary: reflex.task_summary,
            confidence,
          });
        });

        log.debug(
          {
            batchNumber: Math.floor(i / batchSize) + 1,
            inputTokens: response.usage?.input_tokens,
          },
          "Batch processed",
        );
      }

      // Sort by confidence descending
      allScored.sort((a, b) => b.confidence - a.confidence);

      log.info(
        {
          scored: allScored.length,
          topMatch: allScored[0] || null,
        },
        "Jev single-phase evaluation complete",
      );

      return allScored;
    } catch (error: any) {
      log.error({ error: error.message }, "Jev single-phase evaluation failed");
      throw error;
    }
  }

  /**
   * Enriches ranking with reliability classification based on confidence
   * High: > 70% confidence (trust the result)
   * Medium: 50-70% (usable but not perfect)
   * Low: < 50% (escalate to full LLM)
   */
  private enrichRankingWithReliability(
    rawRanking: Array<{ id: number; task_summary: string; confidence: number }>,
  ): SemanticRouteRanking[] {
    return rawRanking.map((item) => ({
      ...item,
      reliability:
        item.confidence >= 70
          ? "high"
          : item.confidence >= 50
            ? "medium"
            : "low",
    }));
  }

  /**
   * Extracts reflex data from the base prompt
   */
  private extractReflexesFromPrompt(basePrompt: string): Array<{
    id: number;
    task_summary: string;
  }> {
    const reflexes: Array<{ id: number; task_summary: string }> = [];
    const lines = basePrompt.split("\n");

    for (const line of lines) {
      const match = line.match(/^(\d+)\.\s+(.+)$/);
      if (match) {
        reflexes.push({
          id: parseInt(match[1]),
          task_summary: match[2].trim(),
        });
      }
    }

    return reflexes;
  }

  /**
   * Simple similarity-based matching as fallback when Jev is not available
   */
  private simpleSimilarityMatch(
    userMessage: string,
    reflexes: Array<{ id: number; task_summary: string }>,
  ): Array<{ id: number; task_summary: string; confidence: number }> {
    const evaluations: Array<{
      id: number;
      task_summary: string;
      confidence: number;
    }> = [];

    // Simple word-based matching
    const userWords = userMessage.toLowerCase().split(/\s+/);

    for (const reflex of reflexes) {
      const taskWords = reflex.task_summary.toLowerCase().split(/\s+/);

      // Count word matches
      let matchCount = 0;
      for (const word of userWords) {
        if (taskWords.some((tw) => tw.includes(word) || word.includes(tw))) {
          matchCount++;
        }
      }

      // Calculate confidence based on word overlap
      const confidence = Math.min(
        100,
        Math.round(
          (matchCount / Math.max(userWords.length, taskWords.length)) * 100,
        ),
      );

      if (confidence > 0) {
        evaluations.push({
          id: reflex.id,
          task_summary: reflex.task_summary,
          confidence,
        });
      }
    }

    // Sort by confidence descending
    evaluations.sort((a, b) => b.confidence - a.confidence);

    log.info(
      { evaluationCount: evaluations.length, topMatch: evaluations[0] || null },
      "Similarity match complete",
    );

    return evaluations.slice(0, 10); // Return top 10
  }
}

function normalizeProviderConfig(config: LLMProviderConfig): LLMProviderConfig {
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

  const uniqueFallback = [
    ...new Set(
      fallback.filter((provider) => provider !== config.primaryProvider),
    ),
  ];
  if (uniqueFallback.length === 0) {
    throw new ValidationError(
      "La configuración multi-tenant requiere al menos un fallback",
    );
  }

  return {
    primaryProvider: config.primaryProvider,
    fallbackOrder: uniqueFallback,
  };
}

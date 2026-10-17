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

const __dirname = getModuleDir(import.meta.url);

const log = createLogger("TenantManager");

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
      if (registryRecord && registryRecord.status === "inactive") {
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

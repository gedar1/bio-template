import { GeminiCortex } from "../system/implementations/GeminiCortex.js";
import { UnifiedCortex } from "../system/implementations/UnifiedCortex.js";
import { NvidiaCortex } from "../system/implementations/NvidiaCortex.js";
import { BaseOrchestrator } from "../system/BaseOrchestrator.js";
import { BaseOrganisms } from "../organisms/BaseOrganisms.js";
import { createLogger } from "../config/logger.js";
import { TenantError } from "../errors.js";
import {
  registerDomainProfile,
  getAvailableProfiles,
  getDefaultProfile,
} from "../config/profileRegistry.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getModuleDir } from "../atoms/paths.js";
import type { TenantRegistryService } from "./services/TenantRegistryService.js";
import type { UsageMetricsCollector } from "./services/UsageMetricsCollector.js";

const __dirname = getModuleDir(import.meta.url);

const log = createLogger("TenantManager");

// Cargar perfiles de tenant — buscar en múltiples ubicaciones
function loadTenantProfiles(): {
  profiles: Record<string, TenantProfile>;
  defaultProfile: string;
} {
  const paths = [
    join(__dirname, "../config/tenant-profiles.json"),
    join(__dirname, "../../config/tenant-profiles.json"),
    join(process.cwd(), "src/biocore/config/tenant-profiles.json"),
    join(process.cwd(), "dist/biocore/config/tenant-profiles.json"),
  ];

  for (const p of paths) {
    try {
      const content = readFileSync(p, "utf-8");
      return JSON.parse(content);
    } catch {
      // intentar siguiente path
    }
  }

  // Fallback: perfil dev por defecto
  return {
    profiles: {
      dev: {
        description: "Desarrollo de software",
        allowedCells: [],
        agentFile: "dev-agent.md",
      },
    },
    defaultProfile: "dev",
  };
}

const tenantProfiles = loadTenantProfiles();

// Register JSON-loaded profiles in the composed profile registry
// so they're also available via getAvailableProfiles()
for (const [profileId, profileConfig] of Object.entries(
  tenantProfiles.profiles,
)) {
  try {
    registerDomainProfile(profileId, profileConfig);
  } catch {
    // Skip profiles that don't pass registry validation (e.g. empty allowedCells)
    log.debug(
      { profileId },
      "Skipped registering profile in registry (validation failed)",
    );
  }
}

export interface TenantProfile {
  description: string;
  allowedCells: string[];
  agentFile: string;
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
  cortex: BaseOrchestrator;
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
  private readonly metricsCollector: UsageMetricsCollector | null;

  constructor(
    maxTenants: number = 50,
    idleTimeoutMs: number = 30 * 60 * 1000,
    registry?: TenantRegistryService,
    metricsCollector?: UsageMetricsCollector,
  ) {
    this.maxTenants = maxTenants;
    this.idleTimeoutMs = idleTimeoutMs;
    this.registry = registry ?? null;
    this.metricsCollector = metricsCollector ?? null;
  }

  /**
   * Obtiene o crea un Cortex para el tenant indicado.
   * @param tenantId - Identificador único del tenant
   * @param profileName - Perfil de industria (default: env TENANT_PROFILE o "dev")
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

    const provider = process.env.LLM_PROVIDER || "unified";
    let cortex: BaseOrchestrator;

    if (provider === "unified") {
      cortex = new UnifiedCortex();
    } else if (provider === "nvidia") {
      cortex = new NvidiaCortex();
    } else {
      cortex = new GeminiCortex();
    }

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
        cortex["history"].create(cortex.getSessionId(), {
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

    // Wire metrics collector into cortex (if available and cortex supports it)
    if (this.metricsCollector && cortex instanceof UnifiedCortex) {
      cortex.setMetricsCollector(this.metricsCollector, tenantId);
    }

    // Wire tenant registry into cortex for token limit enforcement
    if (this.registry && cortex instanceof UnifiedCortex) {
      cortex.setTenantRegistry(this.registry);
    }

    this.tenants.set(tenantId, tenant);
    log.info(
      { tenantId, profile, totalTenants: this.tenants.size },
      "Tenant listo",
    );
    return tenant;
  }

  /**
   * Envía un mensaje al Cortex de un tenant.
   */
  async chat(tenantId: string, message: string): Promise<string> {
    const tenant = await this.getTenant(tenantId);
    tenant.lastActivity = Date.now();

    const beforeSize = tenant.cortex.getHistory().length;

    try {
      await tenant.cortex.chat(message);

      const messages = tenant.cortex.getHistory();
      const newMessages = messages.slice(beforeSize);
      const assistantMsg = newMessages
        .filter((m) => m.role === "assistant")
        .pop();

      // Record task_completed event
      this.recordTaskMetric(tenantId, "task_completed");

      return assistantMsg?.content || "Sin respuesta";
    } catch (error: any) {
      // Record task_error event
      this.recordTaskMetric(tenantId, "task_error");
      throw error;
    }
  }

  /**
   * Stream de respuesta del Cortex de un tenant.
   * Yields chunks de texto conforme el LLM los genera.
   */
  async *chatStream(tenantId: string, message: string): AsyncGenerator<string> {
    const tenant = await this.getTenant(tenantId);
    tenant.lastActivity = Date.now();
    yield* tenant.cortex.chatStream(message);
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

  /**
   * Safely records a task lifecycle metric. No-op if no collector is set.
   */
  private recordTaskMetric(
    tenantId: string,
    eventType: "task_completed" | "task_error",
  ): void {
    if (!this.metricsCollector) return;
    try {
      this.metricsCollector.record(tenantId, eventType, 1);
    } catch (err: any) {
      log.warn(
        { tenantId, eventType, error: err.message },
        "Failed to record task metric (non-fatal)",
      );
    }
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

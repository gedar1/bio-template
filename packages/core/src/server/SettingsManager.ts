import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getModuleDir } from "../atoms/paths.js";
import { createLogger } from "../config/logger.js";
import { resolveProviderApiKey } from "../config/llmConfig.js";
import {
  SettingsPatchSchema,
  RESTART_REQUIRED_KEYS,
} from "./validators/settingsValidators.js";
import type { UnifiedCortex } from "../system/implementations/UnifiedCortex.js";
import type { CircuitBreakerSnapshot, TenantManager } from "./TenantManager.js";
import type { TemplateStateStore } from "./TemplateStateStore.js";
import type {
  SystemSettings,
  SettingsPatch,
  LLMProviderName,
  LLMProviderConfig,
  ApiKeyStatus,
  CircuitBreakerInfo,
  TemplateState,
} from "./types/settings.js";
import type { TaskTemplate } from "./types/dashboard.js";

const __dirname = getModuleDir(import.meta.url);
const log = createLogger("SettingsManager");

// ─── Dependencies Interface ─────────────────────────────────────────────────

export interface SettingsManagerDeps {
  cortex: UnifiedCortex;
  tenantManager: TenantManager;
  templateState: TemplateStateStore;
}

// ─── SettingsManager ────────────────────────────────────────────────────────

/**
 * SettingsManager — Clase central que agrega estado de todos los subsistemas
 * y aplica cambios hot-reload (providers LLM, templates, business config).
 */
export class SettingsManager {
  private readonly cortex: UnifiedCortex;
  private readonly tenantManager: TenantManager;
  private readonly templateState: TemplateStateStore;
  private readonly templates: TaskTemplate[];

  constructor(deps: SettingsManagerDeps) {
    this.cortex = deps.cortex;
    this.tenantManager = deps.tenantManager;
    this.templateState = deps.templateState;
    this.templates = this.loadTemplates();
    log.info("SettingsManager inicializado");
  }

  // ─── READ ───────────────────────────────────────────────────────────────────

  /**
   * Obtiene configuración completa del sistema (READ).
   * Agrega estado de UnifiedCortex, TenantManager, TemplateStateStore,
   * CircuitBreakers y variables de entorno.
   */
  getSettings(): SystemSettings {
    const providerConfig = this.tenantManager.getProviderConfig();
    const tenantProfile = this.getTenantProfileInfo();
    const businessConfig = this.getBusinessConfig();
    const apiKeyStatuses = this.getApiKeyStatuses();
    const circuitBreakers = this.getCircuitBreakerInfos();
    const templateItems = this.getTemplateStates();

    return {
      tenant: {
        profile: tenantProfile.profile,
        description: tenantProfile.description,
        allowedCells: tenantProfile.allowedCells,
        metadata: {
          reloadType: "restart-required",
          description: "Perfil de tenant — requiere reinicio para cambiar",
        },
      },
      business: {
        name: businessConfig.name,
        timezone: businessConfig.timezone,
        language: businessConfig.language,
        metadata: {
          reloadType: "hot-reload",
          description: "Configuración de negocio — editable en caliente",
        },
      },
      llm: {
        providers: providerConfig,
        apiKeyStatuses,
        circuitBreakers,
        metadata: {
          reloadType: "hot-reload",
          description: "Proveedores LLM — hot-reload sin reinicio",
        },
      },
      templates: {
        items: templateItems,
        metadata: {
          reloadType: "hot-reload",
          description: "Templates — habilitación/deshabilitación en caliente",
        },
      },
    };
  }

  // ─── WRITE ──────────────────────────────────────────────────────────────────

  /**
   * Aplica un patch parcial (WRITE) — solo hot-reload settings.
   * Valida con Zod, clasifica hot-reload vs restart-required, aplica cambios.
   */
  async applySettings(patch: SettingsPatch): Promise<SystemSettings> {
    // 1. Check for restart-required keys in the raw patch
    this.rejectRestartRequiredKeys(patch);

    // 2. Validate with Zod
    const parseResult = SettingsPatchSchema.safeParse(patch);
    if (!parseResult.success) {
      const error = new Error("Validation failed");
      (error as any).details = parseResult.error.errors;
      throw error;
    }

    const validPatch = parseResult.data as SettingsPatch;

    // 3. Apply LLM provider changes
    if (validPatch.llm) {
      await this.applyLLMChanges(validPatch.llm);
    }

    // 4. Apply template changes
    if (validPatch.templates) {
      this.applyTemplateChanges(validPatch.templates);
    }

    // 5. Apply business config changes
    if (validPatch.business) {
      this.applyBusinessChanges(validPatch.business);
    }

    log.info({ patchKeys: Object.keys(validPatch) }, "Settings patch aplicado");

    // Return updated settings
    return this.getSettings();
  }

  // ─── Private: Health Check ──────────────────────────────────────────────────

  /**
   * Health check local de un provider antes de activarlo.
   * Solo inspecciona la key resuelta; nunca hace una llamada externa.
   */
  private async healthCheckProvider(
    provider: LLMProviderName,
  ): Promise<boolean> {
    const apiKey = resolveProviderApiKey(provider);

    // If key is missing or invalid format, provider is unreachable
    if (!apiKey || apiKey.length < 10) {
      log.warn(
        { provider },
        "Health check failed — API key missing or invalid",
      );
      return false;
    }

    // Key exists with valid format — consider provider reachable
    log.debug({ provider }, "Health check passed");
    return true;
  }

  // ─── Private: Reject Restart-Required ───────────────────────────────────────

  private rejectRestartRequiredKeys(patch: unknown): void {
    if (typeof patch !== "object" || patch === null) return;

    const patchObj = patch as Record<string, unknown>;
    for (const key of RESTART_REQUIRED_KEYS) {
      if (key in patchObj) {
        const error = new Error(
          `Setting '${key}' requires server restart and cannot be changed via PATCH`,
        );
        (error as any).setting = key;
        (error as any).requiresRestart = true;
        throw error;
      }
    }
  }

  // ─── Private: Apply LLM Changes ────────────────────────────────────────────

  private async applyLLMChanges(
    llmPatch: NonNullable<SettingsPatch["llm"]>,
  ): Promise<void> {
    const previousConfig = this.tenantManager.getProviderConfig();
    const nextConfig: LLMProviderConfig = {
      primaryProvider:
        llmPatch.primaryProvider ?? previousConfig.primaryProvider,
      fallbackOrder: [
        ...(llmPatch.fallbackOrder ?? previousConfig.fallbackOrder),
      ],
    };

    // TenantManager is the authority for traffic. Keep the configured chain
    // intact even when a key is missing: the provider reports missing_key and
    // UnifiedCortex can apply its approved fallback policy.
    this.tenantManager.reconfigureAll(nextConfig);
    this.cortex.reconfigure(nextConfig);

    log.info(
      {
        primaryProvider: nextConfig.primaryProvider,
        fallbackOrder: nextConfig.fallbackOrder,
      },
      "LLM provider reconfigured",
    );
  }

  // ─── Private: Apply Template Changes ────────────────────────────────────────

  private applyTemplateChanges(
    templatesPatch: NonNullable<SettingsPatch["templates"]>,
  ): void {
    for (const [templateId, state] of Object.entries(templatesPatch)) {
      this.templateState.setEnabled(templateId, state.enabled);
    }
    log.info(
      { count: Object.keys(templatesPatch).length },
      "Template states updated",
    );
  }

  // ─── Private: Apply Business Changes ────────────────────────────────────────

  private applyBusinessChanges(
    businessPatch: NonNullable<SettingsPatch["business"]>,
  ): void {
    // Business config is stored in environment variables for hot-reload
    if (businessPatch.name !== undefined) {
      process.env.BUSINESS_NAME = businessPatch.name;
    }
    if (businessPatch.timezone !== undefined) {
      process.env.BUSINESS_TIMEZONE = businessPatch.timezone;
    }
    if (businessPatch.language !== undefined) {
      process.env.BUSINESS_LANGUAGE = businessPatch.language;
    }
    log.info({ businessPatch }, "Business config updated");
  }

  // ─── Private: Aggregation Helpers ───────────────────────────────────────────

  private getTenantProfileInfo(): {
    profile: string;
    description: string;
    allowedCells: string[];
  } {
    const profileName = process.env.TENANT_PROFILE || "dev";
    const profiles = this.tenantManager.getAvailableProfilesList();
    const profile = profiles[profileName];

    if (profile) {
      return {
        profile: profileName,
        description: profile.description,
        allowedCells: profile.allowedCells,
      };
    }

    return {
      profile: profileName,
      description: "Unknown profile",
      allowedCells: [],
    };
  }

  private getBusinessConfig(): {
    name: string;
    timezone: string;
    language: string;
  } {
    return {
      name: process.env.BUSINESS_NAME || "BioCore",
      timezone: process.env.BUSINESS_TIMEZONE || "America/Bogota",
      language: process.env.BUSINESS_LANGUAGE || "es",
    };
  }

  private getApiKeyStatuses(): Record<LLMProviderName, ApiKeyStatus> {
    return {
      gemini: this.classifyApiKey(resolveProviderApiKey("gemini")),
      claude: this.classifyApiKey(resolveProviderApiKey("claude")),
      nvidia: this.classifyApiKey(resolveProviderApiKey("nvidia")),
    };
  }

  /**
   * Clasifica el estado de una API key:
   * - undefined/empty → "missing"
   * - non-empty but <10 chars → "invalid_format"
   * - >=10 chars → "configured"
   */
  private classifyApiKey(value: string | undefined): ApiKeyStatus {
    if (!value) {
      return "missing";
    }
    if (value.length < 10) {
      return "invalid_format";
    }
    return "configured";
  }

  private getCircuitBreakerInfos(): CircuitBreakerInfo[] {
    const snapshots = this.tenantManager.getCircuitBreakerSnapshot();
    const source =
      snapshots.length > 0 ? snapshots : this.getAdministrativeSnapshots();
    const grouped = new Map<LLMProviderName, CircuitBreakerSnapshot[]>();

    for (const snapshot of source) {
      const entries = grouped.get(snapshot.provider) ?? [];
      entries.push(snapshot);
      grouped.set(snapshot.provider, entries);
    }

    return (["claude", "gemini", "nvidia"] as const).map((provider) => {
      const entries = grouped.get(provider) ?? [];
      const state = entries.some((entry) => entry.state === "OPEN")
        ? "OPEN"
        : entries.some((entry) => entry.state === "HALF_OPEN")
          ? "HALF_OPEN"
          : "CLOSED";
      const failureCount = entries.reduce(
        (total, entry) => total + entry.failureCount,
        0,
      );
      const lastFailureTimestamp = entries.reduce<number | null>(
        (latest, entry) =>
          entry.lastFailureTimestamp !== null &&
          (latest === null || entry.lastFailureTimestamp > latest)
            ? entry.lastFailureTimestamp
            : latest,
        null,
      );
      const recoveryTimes = entries
        .filter(
          (entry) =>
            entry.state === "OPEN" && entry.estimatedRecoveryMs !== null,
        )
        .map((entry) => entry.estimatedRecoveryMs as number);

      return {
        provider,
        state,
        failureCount,
        lastFailureTimestamp,
        estimatedRecoveryMs:
          state === "OPEN" && recoveryTimes.length > 0
            ? Math.min(...recoveryTimes)
            : null,
      };
    });
  }

  private getAdministrativeSnapshots(): CircuitBreakerSnapshot[] {
    return Array.from(this.cortex.getCircuitBreakers()).map(
      ([provider, breaker]) => {
        const state = breaker.getState();
        const lastFailureTime = breaker.getLastFailureTime();
        return {
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
        };
      },
    );
  }

  private getTemplateStates(): TemplateState[] {
    const persistedStates = this.templateState.getAllStates();
    const profileName = process.env.TENANT_PROFILE || "dev";

    return this.templates
      .filter((t) => !t.profile || t.profile === profileName)
      .map((t) => ({
        id: t.id,
        name: t.name,
        category: t.category,
        enabled: persistedStates.get(t.id) ?? true, // Default: enabled
        profile: t.profile,
      }));
  }

  // ─── Private: Load Templates ────────────────────────────────────────────────

  private loadTemplates(): TaskTemplate[] {
    const templates: TaskTemplate[] = [];

    try {
      const configDir = join(__dirname, "../config");
      const templatesPath = join(configDir, "templates.json");
      const raw = readFileSync(templatesPath, "utf-8");
      templates.push(...(JSON.parse(raw) as TaskTemplate[]));

      // Load domain templates
      const domainPaths = [
        join(process.cwd(), "packages/restaurant/src/config/templates.json"),
        join(configDir, "../../restaurant/src/config/templates.json"),
      ];

      for (const domainPath of domainPaths) {
        try {
          const domainRaw = readFileSync(domainPath, "utf-8");
          const domainTemplates = JSON.parse(domainRaw) as TaskTemplate[];
          templates.push(...domainTemplates);
          break;
        } catch {
          // Domain template file not found, try next
        }
      }

      log.info(
        { count: templates.length },
        "Templates cargados para SettingsManager",
      );
    } catch (err) {
      log.error(
        { error: err instanceof Error ? err.message : String(err) },
        "Error cargando templates.json",
      );
    }

    return templates;
  }
}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getModuleDir } from "../atoms/paths.js";
import { createLogger } from "../config/logger.js";
import {
  SettingsPatchSchema,
  RESTART_REQUIRED_KEYS,
} from "./validators/settingsValidators.js";
import type { UnifiedCortex } from "../system/implementations/UnifiedCortex.js";
import type { TenantManager } from "./TenantManager.js";
import type { TemplateStateStore } from "./TemplateStateStore.js";
import type {
  SystemSettings,
  SettingsPatch,
  LLMProviderName,
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

// ─── Environment variable mapping per provider ──────────────────────────────

const API_KEY_ENV_MAP: Record<LLMProviderName, string> = {
  gemini: "GOOGLE_AI_API_KEY",
  claude: "ANTHROPIC_API_KEY",
  nvidia: "NVIDIA_API_KEY",
};

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
    const providerConfig = this.cortex.getProviderConfig();
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
   * Health check de un provider antes de activarlo.
   * Verifica que la API key exista y tenga formato válido.
   */
  private async healthCheckProvider(
    provider: LLMProviderName,
  ): Promise<boolean> {
    const envVar = API_KEY_ENV_MAP[provider];
    const apiKey = process.env[envVar];

    // If key is missing or invalid format, provider is unreachable
    if (!apiKey || apiKey.length < 10) {
      log.warn(
        { provider, envVar },
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
    const previousConfig = this.cortex.getProviderConfig();

    // If primaryProvider is changing, run health check first
    if (
      llmPatch.primaryProvider &&
      llmPatch.primaryProvider !== previousConfig.primaryProvider
    ) {
      const healthy = await this.healthCheckProvider(llmPatch.primaryProvider);
      if (!healthy) {
        // Revert: don't apply any LLM changes
        const error = new Error(
          `Provider '${llmPatch.primaryProvider}' is unreachable — reverting to previous configuration`,
        );
        (error as any).provider = llmPatch.primaryProvider;
        (error as any).reverted = true;
        throw error;
      }
    }

    // Apply reconfiguration
    this.cortex.reconfigure({
      primaryProvider: llmPatch.primaryProvider,
      fallbackOrder: llmPatch.fallbackOrder,
    });

    log.info(
      {
        primaryProvider: llmPatch.primaryProvider,
        fallbackOrder: llmPatch.fallbackOrder,
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
      gemini: this.classifyApiKey(process.env[API_KEY_ENV_MAP.gemini]),
      claude: this.classifyApiKey(process.env[API_KEY_ENV_MAP.claude]),
      nvidia: this.classifyApiKey(process.env[API_KEY_ENV_MAP.nvidia]),
    };
  }

  /**
   * Clasifica el estado de una API key:
   * - undefined/empty → "missing"
   * - non-empty but <10 chars → "invalid_format"
   * - >=10 chars → "configured"
   */
  private classifyApiKey(value: string | undefined): ApiKeyStatus {
    if (!value || value.length === 0) {
      return "missing";
    }
    if (value.length < 10) {
      return "invalid_format";
    }
    return "configured";
  }

  private getCircuitBreakerInfos(): CircuitBreakerInfo[] {
    const breakers: Array<{ provider: LLMProviderName; breaker: any }> = [
      { provider: "claude", breaker: this.cortex.claudeBreaker },
      { provider: "gemini", breaker: this.cortex.geminiBreaker },
      { provider: "nvidia", breaker: this.cortex.nvidiaBreaker },
    ];

    return breakers.map(({ provider, breaker }) => {
      const state = breaker.getState() as CircuitBreakerInfo["state"];
      const failureCount = breaker.getFailureCount();
      const lastFailureTime = breaker.getLastFailureTime() as number;
      const resetTimeout = breaker.getResetTimeout() as number;

      let estimatedRecoveryMs: number | null = null;
      if (state === "OPEN" && lastFailureTime > 0) {
        const elapsed = Date.now() - lastFailureTime;
        estimatedRecoveryMs = Math.max(0, resetTimeout - elapsed);
      }

      return {
        provider,
        state,
        failureCount,
        lastFailureTimestamp: lastFailureTime > 0 ? lastFailureTime : null,
        estimatedRecoveryMs,
      };
    });
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

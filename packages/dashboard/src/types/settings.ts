/**
 * Frontend types for the Admin Settings Panel.
 * Mirrors the backend SystemSettings and SettingsPatch interfaces
 * defined in packages/core/src/server/types/settings.ts.
 */

// ─── Enums / Literal Types ──────────────────────────────────────────────────

export type LLMProviderName = "gemini" | "claude" | "nvidia";

export type ApiKeyStatus = "configured" | "missing" | "invalid_format";

export type SettingReloadType = "hot-reload" | "restart-required";

// ─── Setting Metadata ───────────────────────────────────────────────────────

export interface SettingMetadata {
  reloadType: SettingReloadType;
  description: string;
}

// ─── LLM Provider Configuration ─────────────────────────────────────────────

export interface LLMProviderConfig {
  primaryProvider: LLMProviderName;
  fallbackOrder: LLMProviderName[];
}

// ─── Circuit Breaker Info ───────────────────────────────────────────────────

export interface CircuitBreakerInfo {
  provider: LLMProviderName;
  state: "CLOSED" | "OPEN" | "HALF_OPEN";
  failureCount: number;
  lastFailureTimestamp: number | null;
  /** Only present when state is "OPEN" */
  estimatedRecoveryMs: number | null;
}

// ─── Template State ─────────────────────────────────────────────────────────

export interface TemplateState {
  id: string;
  name: string;
  category: string;
  enabled: boolean;
  profile?: string;
}

// ─── System Settings (GET /api/settings response) ───────────────────────────

export interface SystemSettings {
  tenant: {
    profile: string;
    description: string;
    allowedCells: string[];
    metadata: SettingMetadata;
  };
  business: {
    name: string;
    timezone: string;
    language: string;
    metadata: SettingMetadata;
  };
  llm: {
    providers: LLMProviderConfig;
    apiKeyStatuses: Record<LLMProviderName, ApiKeyStatus>;
    circuitBreakers: CircuitBreakerInfo[];
    metadata: SettingMetadata;
  };
  templates: {
    items: TemplateState[];
    metadata: SettingMetadata;
  };
}

// ─── Settings Patch (PATCH /api/settings request body) ──────────────────────

export interface SettingsPatch {
  llm?: {
    primaryProvider?: LLMProviderName;
    fallbackOrder?: LLMProviderName[];
  };
  templates?: {
    [templateId: string]: { enabled: boolean };
  };
  business?: {
    name?: string;
    timezone?: string;
    language?: string;
  };
}

// ─── Update Result (returned by updateSettings) ─────────────────────────────

export interface UpdateResult {
  /** Whether the update succeeded */
  success: boolean;
  /** Error message if the update failed */
  error?: string;
  /** Validation error details (for 400/422 responses) */
  details?: any;
  /** Whether the server reverted the change (for 409 provider unreachable) */
  reverted?: boolean;
}

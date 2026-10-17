/**
 * Shared backend types for the BioCore Admin Settings Panel.
 * Defines the API contract for GET/PATCH /api/settings endpoints.
 */

// ─── Enums / Literal Types ──────────────────────────────────────────────────

export type {
  LLMProviderName,
  LLMProviderConfig,
} from "../../config/llmTypes.js";
import type {
  LLMProviderName,
  LLMProviderConfig,
} from "../../config/llmTypes.js";

export type ApiKeyStatus = "configured" | "missing" | "invalid_format";

export type SettingReloadType = "hot-reload" | "restart-required";

// ─── Setting Metadata ───────────────────────────────────────────────────────

export interface SettingMetadata {
  reloadType: SettingReloadType;
  description: string;
}

// ─── LLM Provider Configuration ─────────────────────────────────────────────

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

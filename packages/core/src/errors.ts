/**
 * Jerarquía de errores de BioCore.
 * Cada error tiene un código único para identificación en logs y API responses.
 */

import type { LLMProviderName } from "./config/llmTypes.js";

export class BioCoreError extends Error {
  readonly code: string;
  readonly context?: Record<string, any>;

  constructor(message: string, code: string, context?: Record<string, any>) {
    super(message);
    this.name = "BioCoreError";
    this.code = code;
    this.context = context;
  }

  toJSON() {
    return {
      error: this.name,
      code: this.code,
      message: this.message,
      ...(this.context && { context: this.context }),
    };
  }
}

export class MutationError extends BioCoreError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, "MUTATION_ERROR", context);
    this.name = "MutationError";
  }
}

export class ToolExecutionError extends BioCoreError {
  constructor(
    toolName: string,
    message: string,
    context?: Record<string, any>,
  ) {
    super(message, "TOOL_EXECUTION_ERROR", { toolName, ...context });
    this.name = "ToolExecutionError";
  }
}

export type ProviderErrorCategory =
  | "authentication"
  | "rate_limit"
  | "timeout"
  | "network"
  | "malformed_response"
  | "missing_key"
  | "circuit_open"
  | "cancelled"
  | "unavailable"
  | "internal";

export interface ProviderAttempt {
  readonly provider: LLMProviderName | "all";
  readonly category: ProviderErrorCategory;
  readonly status?: number;
  readonly message: string;
}

export interface ProviderErrorOptions {
  readonly status?: number;
  readonly retryable?: boolean;
  readonly safeContext?: Readonly<Record<string, unknown>>;
  readonly attempts?: readonly ProviderAttempt[];
}

export class ProviderError extends BioCoreError {
  readonly provider: LLMProviderName | "all";
  readonly category: ProviderErrorCategory;
  readonly status?: number;
  readonly retryable: boolean;
  readonly safeContext: Readonly<Record<string, unknown>>;
  readonly attempts?: readonly ProviderAttempt[];

  constructor(
    provider: LLMProviderName | "all",
    message: string,
    context?: Record<string, unknown>,
  );
  constructor(
    provider: LLMProviderName | "all",
    category: ProviderErrorCategory,
    message: string,
    options?: ProviderErrorOptions,
  );
  constructor(
    provider: LLMProviderName | "all",
    categoryOrMessage: string,
    messageOrContext?: string | Record<string, unknown>,
    options: ProviderErrorOptions = {},
  ) {
    const isCategory = [
      "authentication",
      "rate_limit",
      "timeout",
      "network",
      "malformed_response",
      "missing_key",
      "circuit_open",
      "cancelled",
      "unavailable",
      "internal",
    ].includes(categoryOrMessage);
    const category = isCategory
      ? (categoryOrMessage as ProviderErrorCategory)
      : "internal";
    const message =
      isCategory && typeof messageOrContext === "string"
        ? messageOrContext
        : categoryOrMessage;
    const legacyContext =
      !isCategory && isRecordContext(messageOrContext)
        ? messageOrContext
        : undefined;
    const merged = legacyContext ?? options.safeContext;
    super(message, "PROVIDER_ERROR", { provider, category, ...(merged ?? {}) });
    this.name = "ProviderError";
    this.provider = provider;
    this.category = category;
    this.status = options.status;
    this.retryable =
      options.retryable ??
      [
        "authentication",
        "rate_limit",
        "timeout",
        "network",
        "malformed_response",
        "missing_key",
        "unavailable",
        "circuit_open",
      ].includes(category);
    this.safeContext = merged ?? {};
    this.attempts = options.attempts;
  }

  override toJSON() {
    return {
      error: this.name,
      code: this.code,
      message: this.message,
      provider: this.provider,
      category: this.category,
      ...(this.status !== undefined ? { status: this.status } : {}),
      retryable: this.retryable,
      ...(this.attempts ? { attempts: this.attempts } : {}),
    };
  }
}

function isRecordContext(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class CircuitOpenError extends BioCoreError {
  constructor(provider: string) {
    super(`Circuito abierto para ${provider}`, "CIRCUIT_OPEN", { provider });
    this.name = "CircuitOpenError";
  }
}

export class ValidationError extends BioCoreError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, "VALIDATION_ERROR", context);
    this.name = "ValidationError";
  }
}

export class TenantError extends BioCoreError {
  constructor(
    tenantId: string,
    message: string,
    context?: Record<string, any>,
  ) {
    super(message, "TENANT_ERROR", { tenantId, ...context });
    this.name = "TenantError";
  }
}

export class MoleculeError extends BioCoreError {
  constructor(
    molecule: string,
    message: string,
    context?: Record<string, any>,
  ) {
    super(message, "MOLECULE_ERROR", { molecule, ...context });
    this.name = "MoleculeError";
  }
}

export class GuardrailBlockedError extends BioCoreError {
  /** Nombre de la herramienta bloqueada */
  readonly toolName: string;
  /** safetyScore calculado por Jev (0–1) */
  readonly safetyScore: number;

  constructor(toolName: string, safetyScore: number, reason: string) {
    super(reason, "GUARDRAIL_BLOCKED", { toolName, safetyScore });
    this.name = "GuardrailBlockedError";
    this.toolName = toolName;
    this.safetyScore = safetyScore;
  }
}

export class HeadlessEscalationError extends BioCoreError {
  /** Instrucción original que no pudo resolverse sin LLM */
  readonly instruction: string;
  /** Confianza de Jev en el routing (undefined si Jev no estaba disponible) */
  readonly jevConfidence?: number;

  constructor(instruction: string, reason: string, jevConfidence?: number) {
    super(
      `HeadlessOrchestrator no puede resolver la tarea sin LLM: ${reason}`,
      "HEADLESS_ESCALATION",
      {
        instruction: instruction.substring(0, 200),
        reason,
        ...(jevConfidence !== undefined && { jevConfidence }),
      },
    );
    this.name = "HeadlessEscalationError";
    this.instruction = instruction;
    this.jevConfidence = jevConfidence;
  }
}

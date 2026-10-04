/**
 * Jerarquía de errores de BioCore.
 * Cada error tiene un código único para identificación en logs y API responses.
 *
 * BioCoreError
 * ├── MutationError        — fallos al mutar células
 * ├── ToolExecutionError   — fallos al ejecutar herramientas MCP
 * ├── ProviderError        — fallos de LLM (Claude, Gemini)
 * ├── ValidationError      — inputs inválidos (Zod, schemas)
 * ├── TenantError          — problemas de multi-tenancy
 * └── MoleculeError        — fallos en moléculas (DB, HTTP, etc.)
 */

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

export class ProviderError extends BioCoreError {
  constructor(
    provider: string,
    message: string,
    context?: Record<string, any>,
  ) {
    super(message, "PROVIDER_ERROR", { provider, ...context });
    this.name = "ProviderError";
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

import { z } from "zod";
import { ProviderError, ValidationError } from "../../errors.js";
import type {
  JSONObject,
  JSONSchemaObject,
  JSONValue,
  LLMMessage,
  LLMRequest,
  LLMTool,
  NormalizedLLMRequest,
} from "./providerTypes.js";

const jsonValueSchema: z.ZodType<JSONValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

const jsonObjectSchema: z.ZodType<JSONObject> = z.record(jsonValueSchema);

const schemaTypeSchema = z.enum([
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
  "null",
]);

const jsonSchemaObjectSchema: z.ZodType<JSONSchemaObject> = z.lazy(() =>
  z
    .object({
      type: schemaTypeSchema.optional(),
      description: z.string().optional(),
      properties: z.record(jsonSchemaObjectSchema).optional(),
      required: z.array(z.string()).optional(),
      items: jsonSchemaObjectSchema.optional(),
      enum: z.array(jsonValueSchema).optional(),
      additionalProperties: z.boolean().optional(),
    })
    .strict(),
);

const toolSchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().optional(),
    inputSchema: jsonSchemaObjectSchema,
  })
  .strict();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JSONValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

export function assertJSONObject(value: unknown, context: string): JSONObject {
  const parsed = jsonObjectSchema.safeParse(value);
  if (!parsed.success) {
    throw new ProviderError(
      "all",
      "malformed_response",
      `Los argumentos de ${context} deben ser un objeto JSON`,
      { retryable: true, safeContext: { field: context } },
    );
  }
  return parsed.data;
}

function validateSchemaSemantics(schema: JSONSchemaObject, path: string): void {
  if (schema.type === "object" && schema.items) {
    throw new ValidationError(
      `Schema incompatible en ${path}: object no admite items`,
    );
  }
  if (schema.type === "array" && !schema.items) {
    throw new ValidationError(
      `Schema incompatible en ${path}: array requiere items`,
    );
  }
  if (schema.required) {
    const properties = schema.properties ?? {};
    for (const name of schema.required) {
      if (!(name in properties)) {
        throw new ValidationError(
          `Required no definido en properties: ${path}.${name}`,
        );
      }
    }
  }
  if (schema.properties) {
    for (const [name, child] of Object.entries(schema.properties)) {
      validateSchemaSemantics(child, `${path}.properties.${name}`);
    }
  }
  if (schema.items) validateSchemaSemantics(schema.items, `${path}.items`);
}

export function validateJSONSchema(
  schema: unknown,
  path = "inputSchema",
): JSONSchemaObject {
  const parsed = jsonSchemaObjectSchema.safeParse(schema);
  if (!parsed.success) {
    throw new ValidationError(`Schema JSON no representable en ${path}`, {
      field: path,
    });
  }
  validateSchemaSemantics(parsed.data, path);
  return parsed.data;
}

export function normalizeTools(tools: readonly LLMTool[]): readonly LLMTool[] {
  const names = new Set<string>();
  return tools.map((tool, index) => {
    const parsed = toolSchema.safeParse(tool);
    if (!parsed.success) {
      throw new ValidationError(`Tool inválida en índice ${index}`, {
        field: `tools[${index}]`,
      });
    }
    if (names.has(parsed.data.name)) {
      throw new ValidationError(
        `Nombre de tool duplicado: ${parsed.data.name}`,
      );
    }
    names.add(parsed.data.name);
    const schema = validateJSONSchema(
      parsed.data.inputSchema,
      `tools[${index}].inputSchema`,
    );
    return {
      name: parsed.data.name,
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description }
        : {}),
      inputSchema: schema,
    };
  });
}

function validateMessage(message: LLMMessage, index: number): void {
  if (message.role === "system" || message.role === "user") {
    if (typeof message.content !== "string") {
      throw new ValidationError(`Contenido inválido en messages[${index}]`);
    }
    return;
  }
  if (message.role === "tool") {
    if (
      typeof message.toolCallId !== "string" ||
      typeof message.name !== "string" ||
      typeof message.content !== "string" ||
      typeof message.isError !== "boolean"
    ) {
      throw new ValidationError(`Tool result inválido en messages[${index}]`);
    }
    return;
  }
  if (message.content !== null && typeof message.content !== "string") {
    throw new ValidationError(
      `Contenido assistant inválido en messages[${index}]`,
    );
  }
  if (!Array.isArray(message.toolCalls)) {
    throw new ValidationError(`toolCalls inválido en messages[${index}]`);
  }
  const ids = new Set<string>();
  for (const call of message.toolCalls) {
    if (!call.id.trim() || !call.name.trim() || ids.has(call.id)) {
      throw new ValidationError(`Tool call inválida en messages[${index}]`);
    }
    ids.add(call.id);
    if (!jsonObjectSchema.safeParse(call.arguments).success) {
      throw new ValidationError(`Argumentos no-objeto en messages[${index}]`);
    }
  }
}

function validateTranscript(messages: readonly LLMMessage[]): void {
  const knownCalls = new Map<string, string>();
  const completedCalls = new Set<string>();
  let pending: readonly string[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    validateMessage(message, index);
    if (message.role === "system") continue;

    if (message.role === "tool") {
      if (
        !pending.includes(message.toolCallId) ||
        completedCalls.has(message.toolCallId)
      ) {
        throw new ValidationError(
          `Tool result sin assistant previo en messages[${index}]`,
        );
      }
      const expectedName = knownCalls.get(message.toolCallId);
      if (
        !message.toolCallId.trim() ||
        !message.name.trim() ||
        expectedName !== message.name
      ) {
        throw new ValidationError(
          `Tool result no coincide con su llamada en messages[${index}]`,
        );
      }
      completedCalls.add(message.toolCallId);
      pending = pending.filter((id) => id !== message.toolCallId);
      continue;
    }

    if (pending.length > 0) {
      throw new ValidationError(
        `Faltan tool results antes de messages[${index}]`,
      );
    }

    if (message.role === "assistant") {
      for (const call of message.toolCalls) {
        if (knownCalls.has(call.id))
          throw new ValidationError(`Tool call duplicada: ${call.id}`);
        knownCalls.set(call.id, call.name);
      }
      pending = message.toolCalls.map((call) => call.id);
    }
  }
  if (pending.length > 0) {
    throw new ValidationError(
      `Tool calls sin resultado: ${pending.join(", ")}`,
    );
  }
}

export function normalizeLLMRequest(request: LLMRequest): NormalizedLLMRequest {
  if (!isRecord(request))
    throw new ValidationError("LLMRequest debe ser un objeto");
  if (!Array.isArray(request.messages))
    throw new ValidationError("messages debe ser un array");
  if (!Array.isArray(request.tools))
    throw new ValidationError("tools debe ser un array");

  const maxTokens = request.maxTokens ?? 1024;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8192) {
    throw new ValidationError("maxTokens debe ser un entero entre 1 y 8192");
  }
  if (
    request.temperature !== undefined &&
    (!Number.isFinite(request.temperature) ||
      request.temperature < 0 ||
      request.temperature > 2)
  ) {
    throw new ValidationError("temperature debe estar entre 0 y 2");
  }
  if (request.model !== undefined && !request.model.trim()) {
    throw new ValidationError("model no puede estar vacío");
  }

  const tools = normalizeTools(request.tools);
  validateTranscript(request.messages);

  return {
    messages: request.messages,
    tools,
    ...(request.model !== undefined ? { model: request.model.trim() } : {}),
    maxTokens,
    ...(request.temperature !== undefined
      ? { temperature: request.temperature }
      : {}),
    ...(request.signal !== undefined ? { signal: request.signal } : {}),
  };
}

export function parseProviderJSON(
  value: unknown,
  provider: "gemini" | "claude" | "nvidia",
  field: string,
): JSONObject {
  if (!isJsonValue(value) || !isRecord(value)) {
    throw new ProviderError(
      provider,
      "malformed_response",
      `Respuesta ${field} inválida`,
      {
        retryable: true,
        safeContext: { field },
      },
    );
  }
  return value;
}

export function normalizeUsage(
  inputTokens: unknown,
  outputTokens: unknown,
): {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
} {
  const input =
    typeof inputTokens === "number" &&
    Number.isFinite(inputTokens) &&
    inputTokens >= 0
      ? inputTokens
      : 0;
  const output =
    typeof outputTokens === "number" &&
    Number.isFinite(outputTokens) &&
    outputTokens >= 0
      ? outputTokens
      : 0;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
  };
}

export function mapFinishReason(
  reason: unknown,
  blocked = false,
): "stop" | "tool_use" | "length" | "blocked" | "unknown" {
  if (blocked) return "blocked";
  if (
    reason === "tool_use" ||
    reason === "TOOL_CALLS" ||
    reason === "function_call"
  )
    return "tool_use";
  if (
    reason === "max_tokens" ||
    reason === "MAX_TOKENS" ||
    reason === "length" ||
    reason === "LENGTH"
  )
    return "length";
  if (
    reason === "end_turn" ||
    reason === "stop_sequence" ||
    reason === "STOP" ||
    reason === "stop"
  )
    return "stop";
  return "unknown";
}

export function providerError(
  provider: "gemini" | "claude" | "nvidia",
  error: unknown,
  phase: string,
): ProviderError {
  const record = isRecord(error) ? error : {};
  const response = isRecord(record.response) ? record.response : undefined;
  const statusValue = response?.status ?? record.status;
  const status = typeof statusValue === "number" ? statusValue : undefined;
  const message =
    error instanceof Error ? error.message : "Error de transporte del provider";
  const errorMessage = message.toLowerCase();
  const category =
    status === 401 || status === 403
      ? "authentication"
      : status === 429
        ? "rate_limit"
        : status !== undefined && status >= 500
          ? "unavailable"
          : errorMessage.includes("timeout") ||
              errorMessage.includes("timed out")
            ? "timeout"
            : "internal";
  return new ProviderError(provider, category, message, {
    status,
    retryable: category !== "internal",
    safeContext: { phase },
  });
}

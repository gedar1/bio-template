import {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
} from "@google/generative-ai";
import { resolveProviderApiKey } from "../../config/llmConfig.js";
import { ProviderError } from "../../errors.js";
import { formatToolsForGemini } from "../../atoms/toolFormat.js";
import type { ILLMProvider } from "./ILLMProvider.js";
import {
  mapFinishReason,
  normalizeLLMRequest,
  normalizeUsage,
  parseProviderJSON,
  providerError,
} from "./providerSchemas.js";
import type {
  JSONObject,
  LLMMessage,
  LLMRequest,
  LLMResponse,
  LLMStreamEvent,
  LLMToolCall,
  NormalizedLLMRequest,
  ProviderOptions,
} from "./providerTypes.js";

export interface GeminiChatSession {
  sendMessage(
    message: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<unknown>;
  sendMessageStream?(
    message: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<unknown>;
}

export interface GeminiModel {
  startChat(options: unknown): GeminiChatSession;
}

export interface GeminiClient {
  getGenerativeModel(options: unknown): GeminiModel;
}

export interface GeminiProviderOptions extends Omit<ProviderOptions, "model"> {
  readonly model?: string;
  readonly client?: GeminiClient;
  readonly createClient?: (apiKey: string) => GeminiClient;
}

type UnknownRecord = Record<string, unknown>;
function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asObject(value: unknown, field: string): JSONObject {
  return parseProviderJSON(value, "gemini", field);
}
function transportError(
  error: unknown,
  signal: AbortSignal | undefined,
  phase: string,
): ProviderError {
  if (signal?.aborted || (isRecord(error) && error.name === "AbortError"))
    return new ProviderError("gemini", "cancelled", "Operación cancelada", {
      retryable: false,
      safeContext: { phase },
    });
  return providerError("gemini", error, phase);
}

interface GeminiToolCorrelation {
  readonly id: string;
  readonly name: string;
  readonly index: number;
}
interface GeminiProjection {
  readonly systemInstruction?: string;
  readonly history: readonly UnknownRecord[];
  readonly current: readonly UnknownRecord[];
  readonly correlation: readonly GeminiToolCorrelation[];
}
function projectMessages(messages: readonly LLMMessage[]): GeminiProjection {
  const systemParts = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content);
  const nonSystem = messages.filter((message) => message.role !== "system");
  const grouped: UnknownRecord[] = [];
  const calls = new Map<string, GeminiToolCorrelation>();
  const correlation: GeminiToolCorrelation[] = [];
  let callIndex = 0;
  let lastToolResultIndex = -1;

  for (const message of nonSystem) {
    const role = message.role === "assistant" ? "model" : "user";
    const parts: UnknownRecord[] = [];
    if (message.role === "user") {
      parts.push({ text: message.content });
    } else if (message.role === "assistant") {
      if (message.content) parts.push({ text: message.content });
      for (const call of message.toolCalls) {
        const entry = { id: call.id, name: call.name, index: callIndex++ };
        calls.set(call.id, entry);
        correlation.push(entry);
        parts.push({ functionCall: { name: call.name, args: call.arguments } });
      }
    } else if (message.role === "tool") {
      const entry = calls.get(message.toolCallId);
      if (
        !entry ||
        entry.name !== message.name ||
        entry.index < lastToolResultIndex
      ) {
        throw new ProviderError(
          "gemini",
          "malformed_response",
          "Correlación de tool Gemini inválida",
          { retryable: false, safeContext: { field: "functionResponse" } },
        );
      }
      lastToolResultIndex = entry.index;
      parts.push({
        functionResponse: {
          name: entry.name,
          response: {
            content: message.content,
            isError: message.isError,
          },
        },
      });
    }
    const previous = grouped[grouped.length - 1];
    if (previous?.role === role && Array.isArray(previous.parts))
      previous.parts.push(...parts);
    else grouped.push({ role, parts });
  }
  const last = grouped.pop();
  const current =
    last && Array.isArray(last.parts) ? (last.parts as UnknownRecord[]) : [];
  return {
    ...(systemParts.length
      ? { systemInstruction: systemParts.join("\n") }
      : {}),
    history: grouped,
    current,
    correlation,
  };
}

function responseToCommon(
  value: unknown,
  requestId: string,
  indexOffset = 0,
): LLMResponse {
  if (!isRecord(value)) {
    throw new ProviderError(
      "gemini",
      "malformed_response",
      "Respuesta Gemini inválida",
      { retryable: true, safeContext: { field: "response" } },
    );
  }
  const response = isRecord(value.response) ? value.response : value;
  if (
    !Array.isArray(response.candidates) &&
    response.promptFeedback === undefined
  ) {
    throw new ProviderError(
      "gemini",
      "malformed_response",
      "Respuesta Gemini inválida",
      { retryable: true, safeContext: { field: "response" } },
    );
  }
  const candidates = Array.isArray(response.candidates)
    ? response.candidates
    : [];
  const candidate = candidates[0];
  const content =
    candidate && isRecord(candidate.content) ? candidate.content : undefined;
  if (candidate && !content) {
    throw new ProviderError(
      "gemini",
      "malformed_response",
      "Respuesta Gemini sin contenido",
      { retryable: true, safeContext: { field: "candidate.content" } },
    );
  }
  const parts = content && Array.isArray(content.parts) ? content.parts : [];
  const textParts: string[] = [];
  const toolCalls: LLMToolCall[] = [];
  let callIndex = indexOffset;
  for (const part of parts) {
    if (!isRecord(part))
      throw new ProviderError(
        "gemini",
        "malformed_response",
        "Parte Gemini inválida",
        { retryable: true, safeContext: { field: "parts" } },
      );
    const hasText = Object.prototype.hasOwnProperty.call(part, "text");
    const hasFunctionCall = Object.prototype.hasOwnProperty.call(
      part,
      "functionCall",
    );
    if (hasText && typeof part.text !== "string")
      throw new ProviderError(
        "gemini",
        "malformed_response",
        "Texto Gemini inválido",
        { retryable: true, safeContext: { field: "parts.text" } },
      );
    if (hasFunctionCall && !isRecord(part.functionCall))
      throw new ProviderError(
        "gemini",
        "malformed_response",
        "Function call Gemini inválida",
        { retryable: true, safeContext: { field: "parts.functionCall" } },
      );
    if (!hasText && !hasFunctionCall)
      throw new ProviderError(
        "gemini",
        "malformed_response",
        "Parte Gemini no soportada",
        { retryable: true, safeContext: { field: "parts" } },
      );
    if (hasText) textParts.push(part.text as string);
    if (hasFunctionCall) {
      const functionCall = part.functionCall as UnknownRecord;
      if (typeof functionCall.name !== "string")
        throw new ProviderError(
          "gemini",
          "malformed_response",
          "Function call Gemini sin nombre",
          { retryable: true, safeContext: { field: "functionCall" } },
        );
      toolCalls.push({
        id: `gemini-${requestId}-${callIndex++}`,
        name: functionCall.name,
        arguments: asObject(functionCall.args ?? {}, "functionCall.args"),
      });
    }
  }
  const usage = isRecord(response.usageMetadata) ? response.usageMetadata : {};
  const blocked =
    !candidate &&
    isRecord(response.promptFeedback) &&
    response.promptFeedback.blockReason !== undefined;
  return {
    text: textParts.join(""),
    toolCalls,
    usage: normalizeUsage(usage.promptTokenCount, usage.candidatesTokenCount),
    finishReason: mapFinishReason(candidate?.finishReason, blocked),
  };
}

export class GeminiProvider implements ILLMProvider {
  readonly name = "gemini" as const;
  readonly model: string;
  private readonly client: GeminiClient;
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly supportsStreaming: boolean;
  constructor(options: GeminiProviderOptions = {}) {
    this.model = options.model ?? "gemini-2.5-flash";
    this.env = options.env ?? process.env;
    const key = resolveProviderApiKey("gemini", this.env) ?? "";
    this.client =
      options.client ??
      options.createClient?.(key) ??
      (new GoogleGenerativeAI(key) as unknown as GeminiClient);
    this.supportsStreaming = options.supportsStreaming ?? true;
  }
  private getModel(request: NormalizedLLMRequest): GeminiModel {
    const model = this.client.getGenerativeModel({
      model: request.model ?? this.model,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ],
      tools: formatToolsForGemini(request.tools),
      ...(request.temperature !== undefined || request.maxTokens !== undefined
        ? {
            generationConfig: {
              maxOutputTokens: request.maxTokens,
              ...(request.temperature !== undefined
                ? { temperature: request.temperature }
                : {}),
            },
          }
        : {}),
      ...(projectMessages(request.messages).systemInstruction
        ? {
            systemInstruction: projectMessages(request.messages)
              .systemInstruction,
          }
        : {}),
    });
    return model;
  }
  private async send(
    request: NormalizedLLMRequest,
    stream: boolean,
  ): Promise<unknown> {
    const projection = projectMessages(request.messages);
    const session = this.getModel(request).startChat({
      history: projection.history,
    });
    const method = stream ? session.sendMessageStream : session.sendMessage;
    if (!method)
      throw new ProviderError(
        "gemini",
        "malformed_response",
        "Streaming Gemini no disponible",
        { retryable: true, safeContext: { phase: "stream" } },
      );
    return method.call(session, projection.current, { signal: request.signal });
  }
  async complete(
    request: LLMRequest | NormalizedLLMRequest,
  ): Promise<LLMResponse> {
    const normalized = normalizeLLMRequest(request);
    const key = resolveProviderApiKey("gemini", this.env);
    if (!key)
      throw new ProviderError("gemini", "missing_key", "Falta GOOGLE_API_KEY", {
        retryable: true,
        safeContext: { env: "GOOGLE_API_KEY" },
      });
    if (normalized.signal?.aborted)
      throw transportError(undefined, normalized.signal, "complete");
    try {
      return responseToCommon(
        await this.send(normalized, false),
        `request-${Date.now()}`,
      );
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw transportError(error, normalized.signal, "complete");
    }
  }
  async *stream(
    request: LLMRequest | NormalizedLLMRequest,
  ): AsyncGenerator<LLMStreamEvent> {
    const normalized = normalizeLLMRequest(request);
    if (!this.supportsStreaming) {
      const response = await this.complete(normalized);
      if (response.text) yield { type: "text_delta", text: response.text };
      yield { type: "completed", response };
      return;
    }
    const key = resolveProviderApiKey("gemini", this.env);
    if (!key)
      throw new ProviderError("gemini", "missing_key", "Falta GOOGLE_API_KEY", {
        retryable: true,
        safeContext: { env: "GOOGLE_API_KEY" },
      });
    if (normalized.signal?.aborted)
      throw transportError(undefined, normalized.signal, "stream");
    try {
      const raw = await this.send(normalized, true);
      const streamResult =
        isRecord(raw) && raw.stream !== undefined ? raw : { stream: raw };
      if (
        !(
          streamResult.stream &&
          Symbol.asyncIterator in Object(streamResult.stream)
        )
      )
        throw new ProviderError(
          "gemini",
          "malformed_response",
          "Stream Gemini inválido",
          { retryable: true, safeContext: { phase: "stream" } },
        );
      const responses: unknown[] = [];
      const requestId = `request-${Date.now()}`;
      const textParts: string[] = [];
      const toolCalls: LLMToolCall[] = [];
      let inputTokens = 0;
      let outputTokens = 0;
      let finishReason: LLMResponse["finishReason"] = "unknown";
      for await (const chunk of streamResult.stream as AsyncIterable<unknown>) {
        responses.push(chunk);
        const parsed = responseToCommon(
          { response: chunk },
          requestId,
          toolCalls.length,
        );
        if (parsed.text) {
          textParts.push(parsed.text);
          yield { type: "text_delta", text: parsed.text };
        }
        toolCalls.push(...parsed.toolCalls);
        inputTokens += parsed.usage.inputTokens;
        outputTokens += parsed.usage.outputTokens;
        if (parsed.finishReason !== "unknown")
          finishReason = parsed.finishReason;
      }
      if (responses.length === 0)
        throw new ProviderError(
          "gemini",
          "malformed_response",
          "Stream Gemini vacío",
          { retryable: true, safeContext: { phase: "stream" } },
        );
      if (toolCalls.length > 0) finishReason = "tool_use";
      yield {
        type: "completed",
        response: {
          text: textParts.join(""),
          toolCalls,
          usage: normalizeUsage(inputTokens, outputTokens),
          finishReason,
        },
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw transportError(error, normalized.signal, "stream");
    }
  }
}

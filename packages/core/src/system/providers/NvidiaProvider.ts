import axios from "axios";
import { resolveProviderApiKey } from "../../config/llmConfig.js";
import { ProviderError } from "../../errors.js";
import { formatToolsForOpenAI } from "../../atoms/toolFormat.js";
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

export interface HttpResponse {
  readonly status: number;
  readonly data: unknown;
}
export interface IHttpClient {
  post(url: string, data: unknown, config?: unknown): Promise<HttpResponse>;
}
export interface NvidiaProviderOptions extends Omit<ProviderOptions, "model"> {
  readonly model?: string;
  readonly baseUrl?: string;
  readonly httpClient?: IHttpClient;
}
type UnknownRecord = Record<string, unknown>;
function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function httpProviderError(status: number, phase: string): ProviderError {
  const category =
    status === 401 || status === 403
      ? "authentication"
      : status === 408
        ? "timeout"
        : status === 429
          ? "rate_limit"
          : status >= 500
            ? "unavailable"
            : "malformed_response";
  return new ProviderError(
    "nvidia",
    category,
    "Respuesta HTTP NVIDIA inválida",
    {
      status,
      retryable: true,
      safeContext: { phase },
    },
  );
}

function transportError(
  error: unknown,
  signal: AbortSignal | undefined,
  phase: string,
): ProviderError {
  if (signal?.aborted || (isRecord(error) && error.name === "AbortError"))
    return new ProviderError("nvidia", "cancelled", "Operación cancelada", {
      retryable: false,
      safeContext: { phase },
    });
  return providerError("nvidia", error, phase);
}
function projectMessages(
  messages: readonly LLMMessage[],
): readonly UnknownRecord[] {
  return messages.map((message) => {
    if (message.role === "user" || message.role === "system")
      return { role: message.role, content: message.content };
    if (message.role === "assistant")
      return {
        role: "assistant",
        content: message.content,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments),
          },
        })),
      };
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content,
      is_error: message.isError,
    };
  });
}
function payload(
  request: NormalizedLLMRequest,
  model: string,
  stream: boolean,
): UnknownRecord {
  const value: UnknownRecord = {
    model: request.model ?? model,
    messages: projectMessages(request.messages),
    max_tokens: request.maxTokens,
    stream,
    tools: formatToolsForOpenAI(request.tools),
    tool_choice: "auto",
  };
  if (request.temperature !== undefined)
    value.temperature = request.temperature;
  else value.temperature = 0.2;
  return value;
}
function parseCompletion(value: unknown): LLMResponse {
  if (
    !isRecord(value) ||
    !Array.isArray(value.choices) ||
    value.choices.length === 0 ||
    !isRecord(value.choices[0])
  )
    throw new ProviderError(
      "nvidia",
      "malformed_response",
      "Respuesta NVIDIA sin choices",
      { retryable: true, safeContext: { field: "choices" } },
    );
  const choice = value.choices[0];
  const message = isRecord(choice.message) ? choice.message : undefined;
  if (!message) {
    throw new ProviderError(
      "nvidia",
      "malformed_response",
      "Respuesta NVIDIA sin message",
      { retryable: true, safeContext: { field: "choices[0].message" } },
    );
  }
  const hasContent = Object.prototype.hasOwnProperty.call(message, "content");
  const hasToolCalls = Object.prototype.hasOwnProperty.call(
    message,
    "tool_calls",
  );
  if (!hasContent && !hasToolCalls) {
    throw new ProviderError(
      "nvidia",
      "malformed_response",
      "Respuesta NVIDIA sin contenido ni tools",
      { retryable: true, safeContext: { field: "message" } },
    );
  }
  const text =
    message.content === null || typeof message.content === "string"
      ? (message.content ?? "")
      : (() => {
          throw new ProviderError(
            "nvidia",
            "malformed_response",
            "Contenido NVIDIA inválido",
            { retryable: true, safeContext: { field: "message.content" } },
          );
        })();
  const calls: LLMToolCall[] = [];
  if (message.tool_calls !== undefined) {
    if (!Array.isArray(message.tool_calls))
      throw new ProviderError(
        "nvidia",
        "malformed_response",
        "tool_calls NVIDIA inválido",
        { retryable: true, safeContext: { field: "tool_calls" } },
      );
    for (const call of message.tool_calls) {
      if (
        !isRecord(call) ||
        typeof call.id !== "string" ||
        !isRecord(call.function) ||
        typeof call.function.name !== "string" ||
        typeof call.function.arguments !== "string"
      )
        throw new ProviderError(
          "nvidia",
          "malformed_response",
          "Tool call NVIDIA inválida",
          { retryable: true, safeContext: { field: "tool_calls" } },
        );
      let args: unknown;
      try {
        args = JSON.parse(call.function.arguments) as unknown;
      } catch {
        throw new ProviderError(
          "nvidia",
          "malformed_response",
          "Argumentos JSON NVIDIA inválidos",
          { retryable: true, safeContext: { field: "arguments" } },
        );
      }
      calls.push({
        id: call.id,
        name: call.function.name,
        arguments: parseProviderJSON(args, "nvidia", "tool_calls.arguments"),
      });
    }
  }
  const usage = isRecord(value.usage) ? value.usage : {};
  return {
    text,
    toolCalls: calls,
    usage: normalizeUsage(usage.prompt_tokens, usage.completion_tokens),
    finishReason: mapFinishReason(choice.finish_reason),
  };
}

export class NvidiaProvider implements ILLMProvider {
  readonly name = "nvidia" as const;
  readonly model: string;
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly http: IHttpClient;
  constructor(options: NvidiaProviderOptions = {}) {
    this.model = options.model ?? "nvidia/llama-3.3-nemotron-super-49b-v1";
    this.env = options.env ?? process.env;
    this.baseUrl =
      options.baseUrl ??
      this.env.NVIDIA_BASE_URL ??
      "https://integrate.api.nvidia.com/v1";
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.http = options.httpClient ?? (axios as unknown as IHttpClient);
  }
  private async post(
    request: NormalizedLLMRequest,
    stream: boolean,
  ): Promise<HttpResponse> {
    const key = resolveProviderApiKey("nvidia", this.env);
    if (!key)
      throw new ProviderError("nvidia", "missing_key", "Falta NVIDIA_API_KEY", {
        retryable: true,
        safeContext: { env: "NVIDIA_API_KEY" },
      });
    return this.http.post(
      `${this.baseUrl}/chat/completions`,
      payload(request, this.model, stream),
      {
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Accept: stream ? "text/event-stream" : "application/json",
        },
        timeout: this.timeoutMs,
        signal: request.signal,
        responseType: stream ? "stream" : "json",
      },
    );
  }
  async complete(
    request: LLMRequest | NormalizedLLMRequest,
  ): Promise<LLMResponse> {
    const normalized = normalizeLLMRequest(request);
    if (normalized.signal?.aborted)
      throw transportError(undefined, normalized.signal, "complete");
    try {
      const response = await this.post(normalized, false);
      if (response.status < 200 || response.status >= 300)
        throw httpProviderError(response.status, "complete");
      return parseCompletion(response.data);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw transportError(error, normalized.signal, "complete");
    }
  }
  async *stream(
    request: LLMRequest | NormalizedLLMRequest,
  ): AsyncGenerator<LLMStreamEvent> {
    const normalized = normalizeLLMRequest(request);
    if (normalized.signal?.aborted)
      throw transportError(undefined, normalized.signal, "stream");
    try {
      const response = await this.post(normalized, true);
      if (response.status < 200 || response.status >= 300)
        throw httpProviderError(response.status, "stream");
      const source = response.data;
      let buffer = "";
      let sawDone = false;
      let text = "";
      let finishReason: LLMResponse["finishReason"] = "unknown";
      let inputTokens = 0;
      let outputTokens = 0;
      const calls = new Map<
        number,
        { id?: string; name?: string; argumentText: string }
      >();
      const consume = (line: string): LLMStreamEvent | undefined => {
        const value = line.trim();
        if (!value || !value.startsWith("data:")) return undefined;
        const data = value.slice(5).trim();
        if (data === "[DONE]") {
          sawDone = true;
          return undefined;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(data) as unknown;
        } catch {
          throw new ProviderError(
            "nvidia",
            "malformed_response",
            "SSE NVIDIA inválido",
            { retryable: true, safeContext: { phase: "stream" } },
          );
        }
        if (
          !isRecord(parsed) ||
          !Array.isArray(parsed.choices) ||
          parsed.choices.length === 0
        )
          throw new ProviderError(
            "nvidia",
            "malformed_response",
            "Chunk SSE NVIDIA inválido",
            { retryable: true, safeContext: { phase: "stream" } },
          );
        if (isRecord(parsed.usage)) {
          inputTokens =
            typeof parsed.usage.prompt_tokens === "number"
              ? parsed.usage.prompt_tokens
              : inputTokens;
          outputTokens =
            typeof parsed.usage.completion_tokens === "number"
              ? parsed.usage.completion_tokens
              : outputTokens;
        }
        const choice = parsed.choices[0];
        if (!isRecord(choice))
          throw new ProviderError(
            "nvidia",
            "malformed_response",
            "Choice SSE NVIDIA inválido",
            { retryable: true, safeContext: { phase: "stream" } },
          );
        if (choice.finish_reason !== null && choice.finish_reason !== undefined)
          finishReason = mapFinishReason(choice.finish_reason);
        const delta = isRecord(choice.delta) ? choice.delta : {};
        if (typeof delta.content === "string" && delta.content) {
          text += delta.content;
          return { type: "text_delta", text: delta.content };
        }
        if (Array.isArray(delta.tool_calls))
          for (const rawCall of delta.tool_calls) {
            if (!isRecord(rawCall) || typeof rawCall.index !== "number")
              throw new ProviderError(
                "nvidia",
                "malformed_response",
                "Índice tool call NVIDIA inválido",
                { retryable: true, safeContext: { phase: "stream" } },
              );
            const current = calls.get(rawCall.index) ?? { argumentText: "" };
            if (
              typeof rawCall.id === "string" &&
              current.id &&
              current.id !== rawCall.id
            )
              throw new ProviderError(
                "nvidia",
                "malformed_response",
                "IDs tool call NVIDIA conflictivos",
                { retryable: true, safeContext: { phase: "stream" } },
              );
            if (typeof rawCall.id === "string") current.id = rawCall.id;
            if (isRecord(rawCall.function)) {
              if (typeof rawCall.function.name === "string")
                current.name = current.name ?? rawCall.function.name;
              if (typeof rawCall.function.arguments === "string")
                current.argumentText += rawCall.function.arguments;
            }
            calls.set(rawCall.index, current);
          }
        return undefined;
      };
      if (typeof source === "string") buffer = source;
      if (typeof source === "string") {
        for (const line of buffer.split(/\r?\n/)) {
          const event = consume(line);
          if (event) yield event;
        }
      } else if (
        source &&
        typeof (source as AsyncIterable<unknown>)[Symbol.asyncIterator] ===
          "function"
      ) {
        for await (const chunk of source as AsyncIterable<unknown>) {
          buffer +=
            typeof chunk === "string"
              ? chunk
              : chunk instanceof Uint8Array
                ? new TextDecoder().decode(chunk)
                : "";
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const event = consume(line);
            if (event) yield event;
          }
        }
        if (buffer.trim()) {
          const event = consume(buffer);
          if (event) yield event;
        }
      } else
        throw new ProviderError(
          "nvidia",
          "malformed_response",
          "Stream NVIDIA inválido",
          { retryable: true, safeContext: { phase: "stream" } },
        );
      if (!sawDone)
        throw new ProviderError(
          "nvidia",
          "malformed_response",
          "SSE NVIDIA sin [DONE]",
          { retryable: true, safeContext: { phase: "stream" } },
        );
      const toolCalls: LLMToolCall[] = [];
      for (const [index, call] of [...calls.entries()].sort(
        ([a], [b]) => a - b,
      )) {
        if (!call.name)
          throw new ProviderError(
            "nvidia",
            "malformed_response",
            "Tool call NVIDIA sin nombre",
            { retryable: true, safeContext: { phase: "stream" } },
          );
        let args: unknown;
        try {
          args = JSON.parse(call.argumentText || "{}");
        } catch {
          throw new ProviderError(
            "nvidia",
            "malformed_response",
            "Argumentos SSE NVIDIA incompletos",
            { retryable: true, safeContext: { phase: "stream" } },
          );
        }
        toolCalls.push({
          id: call.id ?? `nvidia-stream-${index}`,
          name: call.name,
          arguments: parseProviderJSON(
            args,
            "nvidia",
            "stream.tool_calls.arguments",
          ),
        });
      }
      if (toolCalls.length) finishReason = "tool_use";
      yield {
        type: "completed",
        response: {
          text,
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

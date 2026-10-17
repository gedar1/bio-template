import Anthropic from "@anthropic-ai/sdk";
import { resolveProviderApiKey } from "../../config/llmConfig.js";
import { ProviderError } from "../../errors.js";
import { formatToolsForAnthropic } from "../../atoms/toolFormat.js";
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
  LLMResponse,
  LLMStreamEvent,
  NormalizedLLMRequest,
  LLMRequest,
  LLMToolCall,
  ProviderOptions,
} from "./providerTypes.js";

export interface AnthropicClient {
  readonly messages: {
    create(
      input: unknown,
      options?: { readonly signal?: AbortSignal },
    ): Promise<unknown>;
    stream?: (
      input: unknown,
      options?: { readonly signal?: AbortSignal },
    ) => AsyncIterable<unknown>;
  };
}

export interface AnthropicProviderOptions extends Omit<
  ProviderOptions,
  "model"
> {
  readonly model?: string;
  readonly client?: AnthropicClient;
  readonly createClient?: (apiKey: string) => AnthropicClient;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function transportError(
  provider: "claude",
  error: unknown,
  signal: AbortSignal | undefined,
  phase: string,
): ProviderError {
  if (signal?.aborted || (isRecord(error) && error.name === "AbortError")) {
    return new ProviderError(provider, "cancelled", "Operación cancelada", {
      retryable: false,
      safeContext: { phase },
    });
  }
  return providerError(provider, error, phase);
}

function asObject(value: unknown, field: string): JSONObject {
  return parseProviderJSON(value, "claude", field);
}

function toAnthropicMessages(messages: readonly LLMMessage[]): {
  readonly system?: string;
  readonly messages: readonly UnknownRecord[];
} {
  const system = messages
    .filter(
      (message): message is Extract<LLMMessage, { role: "system" }> =>
        message.role === "system",
    )
    .map((message) => message.content)
    .join("\n");
  const result: UnknownRecord[] = [];

  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "user") {
      result.push({ role: "user", content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      const content: UnknownRecord[] = [];
      if (message.content !== null && message.content.length > 0) {
        content.push({ type: "text", text: message.content });
      }
      for (const call of message.toolCalls) {
        content.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.arguments,
        });
      }
      result.push({ role: "assistant", content });
      continue;
    }

    const toolResults = [
      {
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content: message.content,
        is_error: message.isError,
      },
    ];
    const previous = result[result.length - 1];
    if (previous?.role === "user" && Array.isArray(previous.content)) {
      previous.content.push(...toolResults);
    } else {
      result.push({ role: "user", content: toolResults });
    }
  }
  return {
    ...(system ? { system } : {}),
    messages: result,
  };
}

function toPayload(
  request: NormalizedLLMRequest,
  model: string,
): UnknownRecord {
  const projected = toAnthropicMessages(request.messages);
  const payload: UnknownRecord = {
    model: request.model ?? model,
    max_tokens: request.maxTokens,
    messages: projected.messages,
    tools: formatToolsForAnthropic(request.tools),
  };
  if (projected.system) payload.system = projected.system;
  if (request.temperature !== undefined)
    payload.temperature = request.temperature;
  return payload;
}

function parseResponse(value: unknown): LLMResponse {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    throw new ProviderError(
      "claude",
      "malformed_response",
      "Respuesta Anthropic inválida",
      {
        retryable: true,
        safeContext: { field: "content" },
      },
    );
  }
  const textParts: string[] = [];
  const toolCalls: LLMToolCall[] = [];
  for (const block of value.content) {
    if (!isRecord(block) || typeof block.type !== "string") {
      throw new ProviderError(
        "claude",
        "malformed_response",
        "Bloque Anthropic inválido",
        {
          retryable: true,
          safeContext: { field: "content" },
        },
      );
    }
    if (block.type === "text") {
      if (typeof block.text !== "string")
        throw new ProviderError(
          "claude",
          "malformed_response",
          "Texto Anthropic inválido",
          { retryable: true, safeContext: { field: "text" } },
        );
      textParts.push(block.text);
    } else if (block.type === "tool_use") {
      if (typeof block.id !== "string" || typeof block.name !== "string") {
        throw new ProviderError(
          "claude",
          "malformed_response",
          "Tool call Anthropic inválida",
          { retryable: true, safeContext: { field: "tool_use" } },
        );
      }
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: asObject(block.input, "tool_use.input"),
      });
    } else {
      throw new ProviderError(
        "claude",
        "malformed_response",
        `Bloque Anthropic no soportado: ${block.type}`,
        { retryable: true, safeContext: { field: "content" } },
      );
    }
  }
  const usage = isRecord(value.usage) ? value.usage : {};
  return {
    text: textParts.join(""),
    toolCalls,
    usage: normalizeUsage(usage.input_tokens, usage.output_tokens),
    finishReason: mapFinishReason(value.stop_reason),
  };
}

export class AnthropicProvider implements ILLMProvider {
  readonly name = "claude" as const;
  readonly model: string;
  private readonly client: AnthropicClient;
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly supportsStreaming: boolean;

  constructor(options: AnthropicProviderOptions = {}) {
    this.model = options.model ?? "claude-3-5-sonnet-latest";
    this.env = options.env ?? process.env;
    const key = resolveProviderApiKey("claude", this.env) ?? "";
    this.client =
      options.client ??
      options.createClient?.(key) ??
      (new Anthropic({ apiKey: key }) as unknown as AnthropicClient);
    this.supportsStreaming =
      options.supportsStreaming ??
      typeof this.client.messages.stream === "function";
  }

  async complete(
    request: LLMRequest | NormalizedLLMRequest,
  ): Promise<LLMResponse> {
    const normalized = normalizeLLMRequest(request);
    const key = resolveProviderApiKey("claude", this.env);
    if (!key)
      throw new ProviderError(
        "claude",
        "missing_key",
        "Falta ANTHROPIC_API_KEY",
        { retryable: true, safeContext: { env: "ANTHROPIC_API_KEY" } },
      );
    if (normalized.signal?.aborted)
      throw transportError("claude", undefined, normalized.signal, "complete");
    try {
      const response = await this.client.messages.create(
        toPayload(normalized, this.model),
        { signal: normalized.signal },
      );
      return parseResponse(response);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw transportError("claude", error, normalized.signal, "complete");
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
    const key = resolveProviderApiKey("claude", this.env);
    if (!key)
      throw new ProviderError(
        "claude",
        "missing_key",
        "Falta ANTHROPIC_API_KEY",
        { retryable: true, safeContext: { env: "ANTHROPIC_API_KEY" } },
      );
    if (normalized.signal?.aborted)
      throw transportError("claude", undefined, normalized.signal, "stream");

    const textParts: string[] = [];
    const toolParts = new Map<
      number,
      { id: string; name: string; argumentText: string }
    >();
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: LLMResponse["finishReason"] = "unknown";
    let sawEvent = false;
    try {
      const stream = this.client.messages.stream?.(
        toPayload(normalized, this.model),
        { signal: normalized.signal },
      );
      if (!stream)
        throw new ProviderError(
          "claude",
          "malformed_response",
          "Stream Anthropic no disponible",
          { retryable: true, safeContext: { phase: "stream" } },
        );
      for await (const raw of stream) {
        sawEvent = true;
        if (!isRecord(raw) || typeof raw.type !== "string")
          throw new ProviderError(
            "claude",
            "malformed_response",
            "Evento Anthropic inválido",
            { retryable: true, safeContext: { phase: "stream" } },
          );
        const knownEventTypes = new Set([
          "message_start",
          "content_block_start",
          "content_block_delta",
          "content_block_stop",
          "message_delta",
          "message_stop",
          "ping",
        ]);
        if (!knownEventTypes.has(raw.type))
          throw new ProviderError(
            "claude",
            "malformed_response",
            `Evento Anthropic no soportado: ${raw.type}`,
            { retryable: true, safeContext: { phase: "stream" } },
          );
        if (
          raw.type === "message_start" &&
          isRecord(raw.message) &&
          isRecord(raw.message.usage)
        ) {
          inputTokens =
            typeof raw.message.usage.input_tokens === "number"
              ? raw.message.usage.input_tokens
              : 0;
        }
        if (
          raw.type === "content_block_start" &&
          typeof raw.index === "number" &&
          isRecord(raw.content_block) &&
          raw.content_block.type === "tool_use"
        ) {
          if (
            typeof raw.content_block.id !== "string" ||
            typeof raw.content_block.name !== "string"
          )
            throw new ProviderError(
              "claude",
              "malformed_response",
              "Tool use sin id o nombre",
              { retryable: true, safeContext: { phase: "stream" } },
            );
          toolParts.set(raw.index, {
            id: raw.content_block.id,
            name: raw.content_block.name,
            argumentText: "",
          });
        }
        if (raw.type === "content_block_delta" && isRecord(raw.delta)) {
          if (
            raw.delta.type === "text_delta" &&
            typeof raw.delta.text === "string"
          ) {
            textParts.push(raw.delta.text);
            yield { type: "text_delta", text: raw.delta.text };
          } else if (
            raw.delta.type === "input_json_delta" &&
            typeof raw.index === "number" &&
            typeof raw.delta.partial_json === "string"
          ) {
            const tool = toolParts.get(raw.index);
            if (!tool)
              throw new ProviderError(
                "claude",
                "malformed_response",
                "Delta de tool sin bloque inicial",
                { retryable: true, safeContext: { phase: "stream" } },
              );
            tool.argumentText += raw.delta.partial_json;
          }
        }
        if (raw.type === "message_delta" && isRecord(raw.delta)) {
          finishReason = mapFinishReason(raw.delta.stop_reason);
          if (
            isRecord(raw.usage) &&
            typeof raw.usage.output_tokens === "number"
          )
            outputTokens = raw.usage.output_tokens;
        }
      }
      if (!sawEvent)
        throw new ProviderError(
          "claude",
          "malformed_response",
          "Stream Anthropic vacío",
          { retryable: true, safeContext: { phase: "stream" } },
        );
      const toolCalls: LLMToolCall[] = [];
      for (const tool of toolParts.values()) {
        const rawArgs = tool.argumentText.trim() || "{}";
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawArgs) as unknown;
        } catch {
          throw new ProviderError(
            "claude",
            "malformed_response",
            "Argumentos JSON Anthropic inválidos",
            { retryable: true, safeContext: { phase: "stream" } },
          );
        }
        toolCalls.push({
          id: tool.id,
          name: tool.name,
          arguments: asObject(parsed, "stream.tool_use.input"),
        });
      }
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
      throw transportError("claude", error, normalized.signal, "stream");
    }
  }
}

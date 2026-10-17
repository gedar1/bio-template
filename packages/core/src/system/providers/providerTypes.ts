import type { ILogger } from "../../config/ILogger.js";
import type { LLMProviderName } from "../../config/llmTypes.js";

export type JSONValue =
  | null
  | boolean
  | number
  | string
  | readonly JSONValue[]
  | JSONObject;

export interface JSONObject {
  readonly [key: string]: JSONValue;
}

export type JSONSchemaType =
  | "object"
  | "array"
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "null";

export interface JSONSchemaObject {
  readonly type?: JSONSchemaType;
  readonly description?: string;
  readonly properties?: Readonly<Record<string, JSONSchemaObject>>;
  readonly required?: readonly string[];
  readonly items?: JSONSchemaObject;
  readonly enum?: readonly JSONValue[];
  readonly additionalProperties?: boolean;
}

export interface LLMTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: JSONSchemaObject;
}

export interface LLMToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: JSONObject;
}

export type LLMMessage =
  | { readonly role: "system"; readonly content: string }
  | { readonly role: "user"; readonly content: string }
  | {
      readonly role: "assistant";
      readonly content: string | null;
      readonly toolCalls: readonly LLMToolCall[];
    }
  | {
      readonly role: "tool";
      readonly toolCallId: string;
      readonly name: string;
      readonly content: string;
      readonly isError: boolean;
    };

export interface LLMRequest {
  readonly messages: readonly LLMMessage[];
  readonly tools: readonly LLMTool[];
  readonly model?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly signal?: AbortSignal;
}

export interface NormalizedLLMRequest
  extends Omit<LLMRequest, "maxTokens" | "model" | "temperature"> {
  readonly model?: string;
  readonly maxTokens: number;
  readonly temperature?: number;
}

export interface LLMUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export type LLMFinishReason =
  | "stop"
  | "tool_use"
  | "length"
  | "blocked"
  | "unknown";

export interface LLMResponse {
  readonly text: string;
  readonly toolCalls: readonly LLMToolCall[];
  readonly usage: LLMUsage;
  readonly finishReason: LLMFinishReason;
}

export type LLMStreamEvent =
  | { readonly type: "text_delta"; readonly text: string }
  | { readonly type: "completed"; readonly response: LLMResponse };

export interface ProviderOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly logger?: ILogger;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly supportsStreaming?: boolean;
}

export interface ProviderFactoryOptions
  extends Omit<ProviderOptions, "model"> {
  readonly models?: Partial<Record<LLMProviderName, string>>;
  readonly createAnthropicClient?: (apiKey: string) => unknown;
  readonly createGeminiClient?: (apiKey: string) => unknown;
  readonly httpClient?: unknown;
}

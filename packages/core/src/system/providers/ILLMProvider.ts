import type { LLMProviderName } from "../../config/llmTypes.js";
import type {
  LLMRequest,
  LLMResponse,
  LLMStreamEvent,
  NormalizedLLMRequest,
} from "./providerTypes.js";

export type {
  JSONSchemaObject,
  JSONObject,
  JSONValue,
  LLMFinishReason,
  LLMMessage,
  LLMRequest,
  LLMResponse,
  LLMStreamEvent,
  LLMTool,
  LLMToolCall,
  LLMUsage,
  NormalizedLLMRequest,
} from "./providerTypes.js";

export interface ILLMProvider {
  readonly name: LLMProviderName;
  readonly model: string;
  complete(request: LLMRequest | NormalizedLLMRequest): Promise<LLMResponse>;
  stream(
    request: LLMRequest | NormalizedLLMRequest,
  ): AsyncGenerator<LLMStreamEvent>;
}

import { AnthropicProvider, type AnthropicClient } from "./AnthropicProvider.js";
import { GeminiProvider, type GeminiClient } from "./GeminiProvider.js";
import { NvidiaProvider, type IHttpClient } from "./NvidiaProvider.js";
import type { ILLMProvider } from "./ILLMProvider.js";
import type { LLMProviderName } from "../../config/llmTypes.js";
import type { ProviderFactoryOptions } from "./providerTypes.js";

export type ProviderFactory = (options?: Partial<ProviderFactoryOptions>) => ReadonlyMap<LLMProviderName, ILLMProvider>;

export function createProviderFactory(defaults: Partial<ProviderFactoryOptions> = {}): ProviderFactory {
  return (overrides = {}) => {
    const options = { ...defaults, ...overrides };
    const env = options.env ?? process.env;
    const models = options.models ?? {};
    const anthropicFactory = options.createAnthropicClient as ((key: string) => AnthropicClient) | undefined;
    const geminiFactory = options.createGeminiClient as ((key: string) => GeminiClient) | undefined;
    const httpClient = options.httpClient as IHttpClient | undefined;
    const providers = new Map<LLMProviderName, ILLMProvider>();
    providers.set("claude", new AnthropicProvider({ env, logger: options.logger, timeoutMs: options.timeoutMs, supportsStreaming: options.supportsStreaming, model: models.claude ?? "claude-3-5-sonnet-latest", ...(anthropicFactory ? { createClient: anthropicFactory } : {}) }));
    providers.set("gemini", new GeminiProvider({ env, logger: options.logger, timeoutMs: options.timeoutMs, supportsStreaming: options.supportsStreaming, model: models.gemini ?? "gemini-2.5-flash", ...(geminiFactory ? { createClient: geminiFactory } : {}) }));
    providers.set("nvidia", new NvidiaProvider({ env, logger: options.logger, timeoutMs: options.timeoutMs, model: models.nvidia ?? "nvidia/llama-3.3-nemotron-super-49b-v1", ...(httpClient ? { httpClient } : {}) }));
    return providers;
  };
}

export const providerFactory: ProviderFactory = createProviderFactory();

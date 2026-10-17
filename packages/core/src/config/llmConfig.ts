import type { LLMProviderName } from "./llmTypes.js";

const PROVIDER_KEY_NAMES: Readonly<Record<LLMProviderName, readonly string[]>> = {
  gemini: ["GOOGLE_API_KEY", "GOOGLE_AI_API_KEY"],
  claude: ["ANTHROPIC_API_KEY"],
  nvidia: ["NVIDIA_API_KEY"],
};

export function resolveProviderApiKey(
  provider: LLMProviderName,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  for (const name of PROVIDER_KEY_NAMES[provider]) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function getProviderApiKeyNames(
  provider: LLMProviderName,
): readonly string[] {
  return PROVIDER_KEY_NAMES[provider];
}

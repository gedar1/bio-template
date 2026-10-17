import { z } from "zod";
import { ValidationError } from "../errors.js";

export const LLMProviderNameSchema = z.enum(["gemini", "claude", "nvidia"]);
export type LLMProviderName = z.infer<typeof LLMProviderNameSchema>;

export type LLMSelection = "unified" | LLMProviderName;

export interface LLMProviderConfig {
  primaryProvider: LLMProviderName;
  fallbackOrder: LLMProviderName[];
}

export const DEFAULT_LLM_PROVIDER_CONFIG: LLMProviderConfig = {
  primaryProvider: "gemini",
  fallbackOrder: ["claude", "nvidia"],
};

export function resolveInitialProvider(
  value: string | undefined,
): LLMProviderName {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === undefined ||
    normalized === "" ||
    normalized === "unified"
  ) {
    return "gemini";
  }
  const parsed = LLMProviderNameSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new ValidationError(`Proveedor LLM desconocido: ${value}`, {
      field: "LLM_PROVIDER",
    });
  }
  return parsed.data;
}

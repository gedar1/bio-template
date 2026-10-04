import { z } from "zod";

// ─── LLM Provider Name Schema ───────────────────────────────────────────────

export const LLMProviderNameSchema = z.enum(["gemini", "claude", "nvidia"]);

// ─── Settings Patch Schema (PATCH /api/settings body) ───────────────────────

export const SettingsPatchSchema = z
  .object({
    llm: z
      .object({
        primaryProvider: LLMProviderNameSchema.optional(),
        fallbackOrder: z.array(LLMProviderNameSchema).max(3).optional(),
      })
      .optional(),
    templates: z.record(z.object({ enabled: z.boolean() })).optional(),
    business: z
      .object({
        name: z.string().min(1).max(100).optional(),
        timezone: z.string().min(1).optional(),
        language: z.string().length(2).optional(),
      })
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Patch body cannot be empty",
  });

// ─── Restart-Required Keys ──────────────────────────────────────────────────

/**
 * Settings that cannot be changed at runtime via PATCH.
 * Modifications to these require a full server restart.
 */
export const RESTART_REQUIRED_KEYS = [
  "tenant",
  "port",
  "databaseType",
] as const;

export type RestartRequiredKey = (typeof RESTART_REQUIRED_KEYS)[number];

import { z } from "zod";
import { BioCoreError } from "../errors.js";
import { DOMAIN_PROFILE_ID, domainProfile } from "./domain-profile.js";

const ProfileIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, "profileId must be alphanumeric with hyphens");

const ProfileConfigSchema = z.object({
  allowedCells: z
    .array(z.string())
    .min(1, "allowedCells must have at least 1 element"),
  agentFile: z.string().min(1, "agentFile must be a non-empty string"),
  description: z.string().max(256).optional(),
});

export type ProfileConfig = z.infer<typeof ProfileConfigSchema>;

interface ProfileStore {
  profiles: Map<string, ProfileConfig>;
  defaultProfile: string;
}

const store: ProfileStore = {
  profiles: new Map([[DOMAIN_PROFILE_ID, domainProfile]]),
  defaultProfile: DOMAIN_PROFILE_ID,
};

/**
 * Registra un perfil de dominio en el sistema.
 * Si el profileId ya existe, lo sobrescribe.
 * Lanza BioCoreError si los parámetros son inválidos.
 */
export function registerDomainProfile(
  profileId: string,
  profileConfig: unknown,
): void {
  const idResult = ProfileIdSchema.safeParse(profileId);
  if (!idResult.success) {
    throw new BioCoreError(
      `Invalid profileId: ${idResult.error.issues.map((i) => i.message).join(", ")}`,
      "VALIDATION_ERROR",
      { profileId },
    );
  }

  const configResult = ProfileConfigSchema.safeParse(profileConfig);
  if (!configResult.success) {
    throw new BioCoreError(
      `Invalid profileConfig: ${configResult.error.issues.map((i) => i.message).join(", ")}`,
      "VALIDATION_ERROR",
      { profileConfig },
    );
  }

  store.profiles.set(profileId, configResult.data);
}

/**
 * Retorna todos los perfiles disponibles (core + registrados por domains).
 */
export function getAvailableProfiles(): Record<string, ProfileConfig> {
  return Object.fromEntries(store.profiles);
}

/**
 * Obtiene el perfil por defecto. Usado cuando no hay TENANT_PROFILE ni profileName explícito.
 */
export function getDefaultProfile(): string {
  return store.defaultProfile;
}

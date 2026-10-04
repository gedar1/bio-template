import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { createLogger } from "../../config/logger.js";
import type { TenantRegistryService } from "./TenantRegistryService.js";

const log = createLogger("TenantAuthService");

const scryptAsync = promisify(scrypt);

// ─── Constants ──────────────────────────────────────────────────────────────

/** API key length: 32 bytes = 64 hex characters */
const API_KEY_BYTES = 32;

/** scrypt cost parameters (N=16384, r=8, p=1) — equivalent security to bcrypt cost 10 */
const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

/** Salt length for hashing */
const SALT_BYTES = 16;

/** JWT expiration: 24 hours in seconds */
const JWT_EXPIRATION_SECONDS = 86400;

// ─── Zod Schemas ────────────────────────────────────────────────────────────

/** Login request schema */
export const TenantLoginSchema = z.object({
  api_key: z.string().min(1),
  role: z.enum(["admin", "operator", "viewer"]).default("operator"),
});

export type TenantLoginInput = z.infer<typeof TenantLoginSchema>;

/** JWT payload for tenant tokens */
export interface TenantTokenPayload {
  tenant_id: string;
  role: "admin" | "operator" | "viewer";
  profile: string;
  iat: number;
  exp: number;
}

// ─── TenantAuthService ──────────────────────────────────────────────────────

/**
 * TenantAuthService — Gestiona la generación y verificación de API keys para tenants.
 *
 * Usa crypto.scrypt (Node.js built-in) para hashing con salt, y
 * crypto.timingSafeEqual para comparación en tiempo constante.
 *
 * El hash se almacena en formato: `salt:derivedKey` (ambos en hex).
 */
export class TenantAuthService {
  private readonly registry: TenantRegistryService;

  constructor(registry: TenantRegistryService) {
    this.registry = registry;
  }

  /**
   * Generate a cryptographically random API key (32 bytes hex = 64 chars).
   * Returns both the raw key and its scrypt hash for storage.
   *
   * The hash format is `salt:derivedKey` where both are hex-encoded.
   * This provides equivalent security to bcrypt with cost factor 10.
   */
  async generateApiKey(): Promise<{ raw: string; hash: string }> {
    const raw = randomBytes(API_KEY_BYTES).toString("hex");
    const hash = await this.hashKey(raw);

    log.debug("API key generated");

    return { raw, hash };
  }

  /**
   * Verify a provided API key against a stored hash.
   * Uses scrypt derivation + timingSafeEqual for constant-time comparison,
   * preventing timing attacks.
   *
   * @param tenantId - The tenant whose stored hash to compare against
   * @param providedKey - The raw API key provided by the caller
   * @returns true if the key matches, false otherwise
   */
  async verifyApiKey(tenantId: string, providedKey: string): Promise<boolean> {
    const storedHash = this.registry.getApiKeyHash(tenantId);

    if (!storedHash) {
      log.debug({ tenantId }, "No API key hash found for tenant");
      return false;
    }

    return this.compareKeyWithHash(providedKey, storedHash);
  }

  /**
   * Authenticate a tenant and issue a JWT.
   * - Finds tenant by API key hash comparison (iterates active tenants)
   * - Validates tenant status (must be 'active')
   * - Issues JWT signed with derived secret
   *
   * @returns JWT token info on success, or error object on failure
   */
  async login(
    input: TenantLoginInput,
  ): Promise<
    | { token: string; tenant_id: string; profile: string; expires_in: number }
    | { error: string; status: 401 | 403 }
  > {
    const platformSecret = process.env.PLATFORM_SECRET;
    if (!platformSecret) {
      log.error("PLATFORM_SECRET not configured — cannot issue tenant JWT");
      return { error: "Authentication service unavailable", status: 401 };
    }

    // Get all active tenants with keys
    const tenantsWithKeys = this.registry.getActiveTenantsWithKeys();

    // Find matching tenant by verifying the API key against each stored hash
    let matchedTenant: {
      tenant_id: string;
      profile: string;
      status: string;
    } | null = null;

    for (const tenant of tenantsWithKeys) {
      const isMatch = await this.compareKeyWithHash(
        input.api_key,
        tenant.api_key_hash,
      );
      if (isMatch) {
        matchedTenant = tenant;
        break;
      }
    }

    // No matching key found — generic 401 (no hints about tenant existence)
    if (!matchedTenant) {
      log.debug("Login failed: no tenant matched the provided API key");
      return { error: "Invalid API key", status: 401 };
    }

    // Tenant found but inactive
    if (matchedTenant.status !== "active") {
      log.info(
        { tenantId: matchedTenant.tenant_id },
        "Login rejected: tenant is inactive",
      );
      return { error: "Tenant account is suspended", status: 403 };
    }

    // Issue JWT with tenant claims
    const signingSecret = this.deriveSigningSecret(matchedTenant.tenant_id);
    const role = input.role ?? "operator";

    const payload = {
      tenant_id: matchedTenant.tenant_id,
      role,
      profile: matchedTenant.profile,
    };

    const token = jwt.sign(payload, signingSecret, {
      algorithm: "HS256",
      expiresIn: JWT_EXPIRATION_SECONDS,
    });

    log.info(
      { tenantId: matchedTenant.tenant_id, role },
      "Tenant login successful",
    );

    return {
      token,
      tenant_id: matchedTenant.tenant_id,
      profile: matchedTenant.profile,
      expires_in: JWT_EXPIRATION_SECONDS,
    };
  }

  /**
   * Validate a tenant JWT token.
   * Decodes without verifying first to get tenant_id, then verifies
   * signature + expiration with the derived secret for that tenant.
   *
   * @returns Payload on success, or error object on failure
   */
  validateToken(
    token: string,
  ): TenantTokenPayload | { error: string; status: 401 } {
    try {
      // Decode without verification to extract tenant_id
      const decoded = jwt.decode(token) as Record<string, unknown> | null;

      if (!decoded || typeof decoded.tenant_id !== "string") {
        return { error: "Invalid token structure", status: 401 };
      }

      const tenantId = decoded.tenant_id;

      // Derive the signing secret for this tenant
      const signingSecret = this.deriveSigningSecret(tenantId);

      // Verify signature and expiration
      const verified = jwt.verify(token, signingSecret, {
        algorithms: ["HS256"],
      }) as TenantTokenPayload;

      return verified;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        log.debug("Tenant token expired");
        return { error: "Token has expired", status: 401 };
      }
      if (err instanceof jwt.JsonWebTokenError) {
        log.debug({ message: (err as Error).message }, "Invalid tenant token");
        return { error: "Invalid token", status: 401 };
      }
      log.error({ err }, "Unexpected error validating tenant token");
      return { error: "Token validation failed", status: 401 };
    }
  }

  /**
   * Regenerate API key for a tenant.
   * Generates a new key, hashes it, updates the registry, and returns the new raw key.
   */
  async regenerateApiKey(tenantId: string): Promise<{ raw: string }> {
    const { raw, hash } = await this.generateApiKey();

    this.registry.setApiKeyHash(tenantId, hash);

    log.info({ tenantId }, "API key regenerated");

    return { raw };
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Derive the signing secret for a tenant's JWT.
   * Uses HMAC-SHA256(PLATFORM_SECRET, tenant_id) as the per-tenant signing key.
   * This ensures cryptographic isolation: a JWT for tenant A cannot validate with tenant B's secret.
   */
  private deriveSigningSecret(tenantId: string): string {
    const platformSecret = process.env.PLATFORM_SECRET;
    if (!platformSecret) {
      throw new Error("PLATFORM_SECRET is not configured");
    }

    return createHmac("sha256", platformSecret).update(tenantId).digest("hex");
  }

  /**
   * Hash a raw API key using scrypt with a random salt.
   * Returns the hash in format: `salt:derivedKey` (hex-encoded).
   */
  private async hashKey(raw: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES).toString("hex");
    const derived = (await scryptAsync(raw, salt, SCRYPT_KEYLEN)) as Buffer;

    return `${salt}:${derived.toString("hex")}`;
  }

  /**
   * Compare a provided key against a stored hash using constant-time comparison.
   * Extracts the salt from the stored hash, derives the key with the same salt,
   * and compares using timingSafeEqual.
   */
  private async compareKeyWithHash(
    providedKey: string,
    storedHash: string,
  ): Promise<boolean> {
    const separatorIndex = storedHash.indexOf(":");
    if (separatorIndex === -1) {
      log.warn("Invalid hash format (missing separator)");
      return false;
    }

    const salt = storedHash.substring(0, separatorIndex);
    const storedDerived = storedHash.substring(separatorIndex + 1);

    try {
      const derived = (await scryptAsync(
        providedKey,
        salt,
        SCRYPT_KEYLEN,
      )) as Buffer;

      const storedBuffer = Buffer.from(storedDerived, "hex");

      // Ensure buffers are the same length before comparing
      if (derived.length !== storedBuffer.length) {
        return false;
      }

      return timingSafeEqual(derived, storedBuffer);
    } catch (err) {
      log.error({ err }, "Error during key verification");
      return false;
    }
  }
}

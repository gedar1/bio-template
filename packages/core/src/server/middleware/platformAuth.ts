import jwt from "jsonwebtoken";
import { z } from "zod";
import { createLogger } from "../../config/logger.js";

const log = createLogger("PlatformAuth");

// ─── Zod Schemas ────────────────────────────────────────────────────────────

/** JWT payload schema for platform tokens */
export const PlatformTokenPayloadSchema = z.object({
  sub: z.string(),
  role: z.literal("super_admin"),
  iat: z.number(),
  exp: z.number(),
});

export type PlatformTokenPayload = z.infer<typeof PlatformTokenPayloadSchema>;

/** Login request body schema */
export const PlatformLoginSchema = z.object({
  secret: z.string().min(1),
});

export type PlatformLoginInput = z.infer<typeof PlatformLoginSchema>;

// ─── Constants ──────────────────────────────────────────────────────────────

/** Token expiration: 24 hours in seconds */
const TOKEN_EXPIRATION_SECONDS = 24 * 60 * 60;

// ─── Functions ──────────────────────────────────────────────────────────────

/**
 * Checks if the Platform API is enabled.
 * Returns true if `PLATFORM_SECRET` environment variable is set and non-empty.
 */
export function isPlatformEnabled(): boolean {
  const secret = process.env.PLATFORM_SECRET;
  return typeof secret === "string" && secret.length > 0;
}

/**
 * Issues a JWT token for platform super_admin access.
 * Validates that the provided secret matches PLATFORM_SECRET env var,
 * then signs with HMAC-SHA256.
 *
 * @param secret - The secret provided by the user (must match PLATFORM_SECRET)
 * @returns Signed JWT token string, or null if secret is invalid
 */
export function issuePlatformToken(secret: string): string | null {
  const platformSecret = process.env.PLATFORM_SECRET;

  if (!platformSecret || secret !== platformSecret) {
    log.warn("Platform token issuance failed: invalid secret");
    return null;
  }

  const payload = {
    sub: "platform-admin",
    role: "super_admin" as const,
  };

  const token = jwt.sign(payload, platformSecret, {
    algorithm: "HS256",
    expiresIn: TOKEN_EXPIRATION_SECONDS,
  });

  log.info("Platform token issued");
  return token;
}

/**
 * Validates a JWT token from the Authorization header.
 * Extracts Bearer token, verifies signature and expiration,
 * and validates payload structure with Zod.
 *
 * @param authHeader - The Authorization header value (e.g. "Bearer <token>")
 * @returns Object with payload on success, or error string and HTTP status on failure
 */
export function validatePlatformToken(
  authHeader: string | undefined,
): { payload: PlatformTokenPayload } | { error: string; status: 401 | 403 } {
  const secret = process.env.PLATFORM_SECRET;

  if (!secret) {
    return { error: "Platform API is not configured", status: 401 };
  }

  if (!authHeader) {
    return { error: "Authorization header is required", status: 401 };
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    return {
      error: "Invalid authorization format. Expected: Bearer <token>",
      status: 401,
    };
  }

  const token = parts[1];

  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });

    // Validate payload structure with Zod
    const result = PlatformTokenPayloadSchema.safeParse(decoded);
    if (!result.success) {
      log.warn(
        { errors: result.error.issues },
        "Token payload validation failed",
      );
      return { error: "Invalid token payload structure", status: 401 };
    }

    // Verify the role is super_admin
    if (result.data.role !== "super_admin") {
      return {
        error: "Insufficient role: super_admin required",
        status: 403,
      };
    }

    return { payload: result.data };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      log.debug("Platform token expired");
      return { error: "Token has expired", status: 401 };
    }
    if (err instanceof jwt.JsonWebTokenError) {
      log.debug({ message: err.message }, "Invalid platform token");
      return { error: "Invalid token signature", status: 401 };
    }
    log.error({ err }, "Unexpected error validating platform token");
    return { error: "Token validation failed", status: 401 };
  }
}

import { createLogger } from "../../config/logger.js";
import type { HealthServer } from "../HealthServer.js";
import {
  TenantLoginSchema,
  type TenantAuthService,
} from "../services/TenantAuthService.js";
import type { LoginRateLimiter } from "../middleware/loginRateLimiter.js";
import type { AuditLogger } from "../services/AuditLogger.js";
import { successEnvelope, errorEnvelope } from "../utils/apiEnvelope.js";

const log = createLogger("TenantAuthRoutes");

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Response wrapper that carries HTTP status code for HealthServer integration.
 */
export interface PlatformResponse {
  _statusCode: number;
  body: unknown;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function platformResponse(statusCode: number, body: unknown): PlatformResponse {
  return { _statusCode: statusCode, body };
}

/**
 * Extracts rate-limit identifier from the API key (first 8 chars prefix).
 * Since we don't know the tenant_id before authentication, we use the key prefix
 * as a rate-limiting identifier to prevent brute-force attacks.
 */
function getRateLimitIdentifier(apiKey: string): string {
  return apiKey.length >= 8 ? apiKey.substring(0, 8) : apiKey;
}

// ─── Setup ──────────────────────────────────────────────────────────────────

/**
 * Registers tenant authentication endpoints on the HealthServer.
 *
 * Endpoints:
 *   POST /api/tenant/auth/login — Authenticate with API key, receive JWT
 *   GET  /api/tenant/auth/me    — Get current tenant context from JWT
 *
 * @param health - HealthServer instance for route registration
 * @param authService - TenantAuthService for authentication logic
 * @param rateLimiter - LoginRateLimiter for brute-force protection
 * @param auditLogger - Optional AuditLogger for recording auth events
 */
export function setupTenantAuthRoutes(
  health: HealthServer,
  authService: TenantAuthService,
  rateLimiter: LoginRateLimiter,
  auditLogger?: AuditLogger,
): void {
  // ─── POST /api/tenant/auth/login ──────────────────────────────────────────
  // Public endpoint: validates Tenant API key and issues a tenant-scoped JWT
  health.registerData("tenant/auth/login", async (params?: any) => {
    // Validate input with Zod schema
    const parseResult = TenantLoginSchema.safeParse(params);
    if (!parseResult.success) {
      return platformResponse(
        422,
        errorEnvelope("VALIDATION_ERROR", "Invalid login request body", {
          issues: parseResult.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        }),
      );
    }

    const { api_key, role } = parseResult.data;

    // Rate limit by API key prefix (first 8 chars) since tenant_id is unknown pre-auth
    const identifier = getRateLimitIdentifier(api_key);

    if (!rateLimiter.isAllowed(identifier)) {
      const retryAfter = rateLimiter.getRetryAfterSeconds(identifier);
      log.warn(
        { identifier: identifier.substring(0, 4) + "..." },
        "Tenant login rate limited",
      );
      return platformResponse(
        429,
        errorEnvelope(
          "RATE_LIMITED",
          "Too many failed login attempts. Please try again later.",
          {
            retry_after: retryAfter,
          },
        ),
      );
    }

    // Attempt authentication
    const result = await authService.login(parseResult.data);

    // Login failed — record failure and return error
    if ("error" in result) {
      rateLimiter.recordFailure(identifier);

      if (auditLogger) {
        auditLogger.log("tenant.login_failed", identifier, "unknown", {
          reason: result.error,
          status: result.status,
        });
      }

      const code =
        result.status === 403 ? "TENANT_INACTIVE" : "AUTH_INVALID_KEY";
      return platformResponse(result.status, errorEnvelope(code, result.error));
    }

    // Login success — reset rate limiter and return token
    rateLimiter.reset(identifier);

    if (auditLogger) {
      auditLogger.log(
        "tenant.login_success",
        result.tenant_id,
        result.tenant_id,
        {
          role,
          profile: result.profile,
        },
      );
    }

    log.info(
      { tenantId: result.tenant_id, role },
      "Tenant auth login successful",
    );

    return platformResponse(
      200,
      successEnvelope({
        token: result.token,
        tenant_id: result.tenant_id,
        profile: result.profile,
        expires_in: result.expires_in,
      }),
    );
  });

  // ─── GET /api/tenant/auth/me ──────────────────────────────────────────────
  // Protected endpoint: returns current tenant context from JWT
  health.registerData("tenant/auth/me", async (params?: any) => {
    // Extract Authorization header from params (injected by HealthServer)
    const authHeader = params?._authHeader as string | undefined;

    if (!authHeader?.startsWith("Bearer ")) {
      return platformResponse(
        401,
        errorEnvelope(
          "AUTH_INVALID_TOKEN",
          "Missing or invalid Authorization header",
        ),
      );
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    // Validate the tenant JWT
    const result = authService.validateToken(token);

    if ("error" in result) {
      return platformResponse(
        result.status,
        errorEnvelope("AUTH_INVALID_TOKEN", result.error),
      );
    }

    return platformResponse(
      200,
      successEnvelope({
        tenant_id: result.tenant_id,
        role: result.role,
        profile: result.profile,
      }),
    );
  });
}

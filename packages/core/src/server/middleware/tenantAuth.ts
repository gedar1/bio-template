import jwt from "jsonwebtoken";
import { createLogger } from "../../config/logger.js";
import { validatePlatformToken } from "./platformAuth.js";
import type { TenantAuthService } from "../services/TenantAuthService.js";

const log = createLogger("TenantAuth");

// ─── Interfaces ─────────────────────────────────────────────────────────────

/**
 * Resolved authentication context for an incoming request.
 * Contains the tenant_id, role, profile, and the method used to authenticate.
 */
export interface TenantContext {
  tenant_id: string;
  role: "super_admin" | "admin" | "operator" | "viewer";
  profile: string;
  auth_type: "tenant_jwt" | "platform_jwt" | "api_secret";
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Read API_SECRET from environment at module load */
const API_SECRET = process.env.API_SECRET || "";

/** Default tenant profile when using API_SECRET auth */
const DEFAULT_PROFILE = process.env.TENANT_PROFILE || "dev";

// ─── Main Function ──────────────────────────────────────────────────────────

/**
 * Resolves the authentication context for an incoming request.
 *
 * Evaluates auth methods in priority order:
 * 1. Tenant JWT — Bearer token with `tenant_id` in payload
 * 2. Platform JWT — Bearer token with `sub: "platform-admin"` in payload
 * 3. API_SECRET — Bearer token or query param matching process.env.API_SECRET
 *
 * If a Bearer token is present, it first decodes (without verifying) to determine
 * the JWT type by inspecting the payload structure:
 * - Payload has `tenant_id` field → Tenant JWT → validate with TenantAuthService
 * - Payload has `sub: "platform-admin"` → Platform JWT → validate with validatePlatformToken
 *
 * JWT tenant_id always takes precedence over any body `tenantId` parameter.
 *
 * @param authHeader - The Authorization header value (e.g. "Bearer <token>")
 * @param tenantAuthService - The TenantAuthService instance for tenant JWT validation
 * @returns TenantContext on success, or an error object with status code
 */
export function resolveRequestAuth(
  authHeader: string | undefined,
  tenantAuthService: TenantAuthService,
): TenantContext | { error: string; status: 401 | 403 } {
  // Step 1: Try Bearer token (JWT-based auth)
  const token = extractBearerToken(authHeader);

  if (token) {
    // Decode without verifying to inspect payload structure
    const decoded = decodeTokenPayload(token);

    if (decoded) {
      // Check if it's a Tenant JWT (has tenant_id field)
      if (typeof decoded.tenant_id === "string") {
        return resolveTenantJwt(token, tenantAuthService);
      }

      // Check if it's a Platform JWT (sub: "platform-admin")
      if (decoded.sub === "platform-admin") {
        return resolvePlatformJwt(authHeader);
      }
    }

    // Token is present but doesn't match known JWT structures
    // Still try API_SECRET match (token might be the raw secret)
    if (API_SECRET && token === API_SECRET) {
      return resolveApiSecret();
    }

    // Token exists but is neither a valid JWT structure nor API_SECRET
    log.debug("Bearer token present but not a recognized JWT or API_SECRET");
    return { error: "Authentication required", status: 401 };
  }

  // Step 2: No Bearer token — check API_SECRET via header value without Bearer prefix
  // (The existing pattern also supports query params, but resolveRequestAuth
  //  only receives the auth header. API_SECRET via query is handled at route level.)
  if (API_SECRET && authHeader && authHeader === API_SECRET) {
    return resolveApiSecret();
  }

  // Step 3: No auth provided at all — check if API_SECRET is disabled (dev mode)
  if (!API_SECRET) {
    // Dev mode: no API_SECRET configured, allow with default context
    return resolveApiSecret();
  }

  // Nothing matched
  log.debug("No valid authentication method found");
  return { error: "Authentication required", status: 401 };
}

// ─── Private Helpers ────────────────────────────────────────────────────────

/**
 * Extract the Bearer token from an Authorization header.
 * Returns null if the header is missing or not in "Bearer <token>" format.
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;

  const parts = authHeader.split(" ");
  if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
    return parts[1];
  }

  return null;
}

/**
 * Decode a JWT token without verification to inspect payload structure.
 * Returns null if the token cannot be decoded.
 */
function decodeTokenPayload(token: string): Record<string, unknown> | null {
  try {
    const decoded = jwt.decode(token);
    if (decoded && typeof decoded === "object") {
      return decoded;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve authentication for a Tenant JWT.
 * Validates the token using TenantAuthService and returns the tenant context.
 */
function resolveTenantJwt(
  token: string,
  tenantAuthService: TenantAuthService,
): TenantContext | { error: string; status: 401 | 403 } {
  const result = tenantAuthService.validateToken(token);

  if ("error" in result) {
    log.debug({ error: result.error }, "Tenant JWT validation failed");
    return result;
  }

  log.debug(
    { tenantId: result.tenant_id, role: result.role },
    "Authenticated via Tenant JWT",
  );

  return {
    tenant_id: result.tenant_id,
    role: result.role,
    profile: result.profile,
    auth_type: "tenant_jwt",
  };
}

/**
 * Resolve authentication for a Platform JWT (super_admin).
 * Returns cross-tenant context with super_admin role.
 */
function resolvePlatformJwt(
  authHeader: string | undefined,
): TenantContext | { error: string; status: 401 | 403 } {
  const result = validatePlatformToken(authHeader);

  if ("error" in result) {
    log.debug({ error: result.error }, "Platform JWT validation failed");
    return result;
  }

  log.debug("Authenticated via Platform JWT (super_admin)");

  return {
    tenant_id: "*",
    role: "super_admin",
    profile: "all",
    auth_type: "platform_jwt",
  };
}

/**
 * Resolve authentication for API_SECRET-based auth.
 * Returns admin context for the default tenant profile.
 */
function resolveApiSecret(): TenantContext {
  log.debug({ profile: DEFAULT_PROFILE }, "Authenticated via API_SECRET");

  return {
    tenant_id: "default",
    role: "admin",
    profile: DEFAULT_PROFILE,
    auth_type: "api_secret",
  };
}

// ─── Tenant Isolation Guard ─────────────────────────────────────────────────

/**
 * Validates that the authenticated tenant has access to the target resource.
 *
 * Rules:
 * - super_admin (Platform JWT, tenant_id = "*") can access any tenant's resources.
 * - A tenant can only access resources belonging to their own tenant_id.
 * - Cross-tenant attempts are rejected with HTTP 403 and ACCESS_DENIED code.
 *
 * @param authContext - The resolved authentication context from resolveRequestAuth
 * @param targetTenantId - The tenant_id of the resource being accessed
 * @returns null if access is allowed, or an error object with status 403 if denied
 */
export function validateTenantAccess(
  authContext: TenantContext,
  targetTenantId: string,
): { error: string; code: string; status: 403 } | null {
  // super_admin (Platform JWT) retains cross-tenant access
  if (authContext.role === "super_admin") return null;

  // API_SECRET auth with "default" tenant_id has unrestricted access (legacy/dev mode)
  if (authContext.auth_type === "api_secret") return null;

  // Tenant can only access their own resources
  if (authContext.tenant_id !== targetTenantId) {
    log.debug(
      { authTenantId: authContext.tenant_id, targetTenantId },
      "Cross-tenant access denied",
    );
    return {
      error: "Access denied: cannot access resources from another tenant",
      code: "ACCESS_DENIED",
      status: 403,
    };
  }

  // Access allowed
  return null;
}

import {
  getDeploymentMode,
  getSingleTenantId,
} from "../../config/deploymentMode.js";
import {
  isAuthEnabled,
  isApiSecretRequest,
  type TokenDecision,
} from "./apiAuth.js";
import { validatePlatformToken } from "./platformAuth.js";
import { resolveRequestAuth } from "./tenantAuth.js";
import type { TenantAuthService } from "../services/TenantAuthService.js";

/**
 * Control de acceso por petición.
 *
 * Dos capas:
 * 1. Tenant: resolveTenantAccess decide a qué tenant puede actuar la petición.
 * 2. Rol: ENDPOINT_MIN_ROLE decide qué rol mínimo necesita cada endpoint. La
 *    compuerta global (buildTokenVerifier) lo aplica a todas las rutas /api/.
 *
 * Reglas de tenant:
 * - single: siempre el tenant único (TENANT_ID), sin importar el body.
 * - Sin API_SECRET (desarrollo): acceso abierto, igual que el resto del sistema.
 * - Tenant JWT: solo su propio tenant; el body se ignora.
 * - API_SECRET o platform JWT: tenant indicado en el body (obligatorio).
 */

export type AccessRole =
  | "viewer"
  | "operator"
  | "tenant_owner"
  | "platform_owner";

export type TenantAccessResult =
  | { ok: true; tenantId: string }
  | { ok: false; error: string; code: "ACCESS_DENIED" };

export type PlatformAccessResult =
  | { ok: true }
  | { ok: false; error: string; code: "ACCESS_DENIED" };

const denied = (error: string) => ({
  ok: false as const,
  error,
  code: "ACCESS_DENIED" as const,
});

/** Tenant al que puede actuar la petición. */
export function resolveTenantAccess(
  params: Record<string, unknown>,
  tenantAuthService?: TenantAuthService,
): TenantAccessResult {
  if (getDeploymentMode() === "single") {
    return { ok: true, tenantId: getSingleTenantId() };
  }

  const requested = params.tenantId as string | undefined;

  if (!isAuthEnabled()) {
    return { ok: true, tenantId: requested || "default" };
  }

  const authHeader = params._authHeader as string | undefined;
  if (!authHeader) {
    return denied("Se requiere autenticación");
  }

  if (tenantAuthService) {
    const ctx = resolveRequestAuth(authHeader, tenantAuthService);
    if (!("error" in ctx) && ctx.auth_type === "tenant_jwt") {
      return { ok: true, tenantId: ctx.tenant_id };
    }
  }

  const isPlatform = "payload" in validatePlatformToken(authHeader);
  if (isPlatform || isApiSecretRequest(authHeader)) {
    return requested
      ? { ok: true, tenantId: requested }
      : denied("tenantId requerido");
  }

  return denied("Credenciales no válidas para este tenant");
}

/** Acceso de plataforma: API_SECRET o platform JWT. Abierto sin API_SECRET. */
export function resolvePlatformAccess(
  params: Record<string, unknown>,
): PlatformAccessResult {
  if (!isAuthEnabled()) return { ok: true };

  const authHeader = params._authHeader as string | undefined;
  if (isApiSecretRequest(authHeader)) return { ok: true };
  if ("payload" in validatePlatformToken(authHeader)) return { ok: true };

  return denied("Requiere credenciales de plataforma");
}

// ─── Permisos por endpoint ──────────────────────────────────────────────────

const ROLE_LEVEL: Record<AccessRole, number> = {
  viewer: 0,
  operator: 1,
  tenant_owner: 2,
  platform_owner: 3,
};

/**
 * Rol mínimo por endpoint (nombre sin "/api/"). Es la única fuente de permisos.
 * Cualquier endpoint que no aparezca aquí requiere platform_owner (fail-closed).
 */
const ENDPOINT_MIN_ROLE: Readonly<Record<string, AccessRole>> = {
  // Lectura del propio tenant
  tools: "viewer",
  perf: "viewer",
  "tenant-profile": "viewer",
  history: "viewer",
  mutations: "viewer",
  reflex: "viewer",
  "orders/active": "viewer",
  "orders/summary": "viewer",
  "inventory/alerts": "viewer",
  websocket: "viewer",
  role: "viewer",

  // Operación diaria del tenant
  chat: "operator",
  "template/execute": "operator",

  // Cambios que afectan al tenant completo
  "mutations/trigger": "tenant_owner",
  "mutations/record": "tenant_owner",
  "reflex/invalidate": "tenant_owner",
  "websocket/broadcast": "tenant_owner",
  "websocket/disconnect": "tenant_owner",

  // Solo plataforma (también es el valor por defecto): tenants, logs, monitor,
  // registry, circuit-breaker, scheduler y platform/*
};

/**
 * Rol mínimo para un endpoint. `settings` depende del modo: en single es
 * configuración del único negocio (lo administra su dueño); en studio es global
 * para todos los tenants y queda solo para la plataforma.
 */
function requiredRole(endpoint: string): AccessRole {
  if (endpoint === "settings") {
    return getDeploymentMode() === "single" ? "tenant_owner" : "platform_owner";
  }
  if (endpoint.startsWith("platform/")) return "platform_owner";
  return ENDPOINT_MIN_ROLE[endpoint] ?? "platform_owner";
}

/** true si el rol alcanza para el endpoint */
function isRoleAllowed(endpoint: string, role: AccessRole): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[requiredRole(endpoint)];
}

/**
 * Verificador de JWT para la compuerta global de HealthServer.
 * - JWT de plataforma: allow si el endpoint existe en la política (platform_owner
 *   alcanza todo).
 * - JWT de tenant: allow solo si su rol alcanza el endpoint; forbidden si no.
 * - Token no reconocido: invalid (401).
 */
export function buildTokenVerifier(
  getTenantAuthService: () => TenantAuthService | undefined,
): (authHeader: string, path: string) => TokenDecision {
  return (authHeader, path) => {
    const endpoint = path.split("?")[0].replace(/^\/api\//, "");

    if ("payload" in validatePlatformToken(authHeader)) {
      return "allow";
    }

    const service = getTenantAuthService();
    if (!service) return "invalid";

    const ctx = resolveRequestAuth(authHeader, service);
    if ("error" in ctx || ctx.auth_type !== "tenant_jwt") return "invalid";

    // Un rol heredado o desconocido no está en ROLE_LEVEL y queda fuera (fail-closed)
    if (!(ctx.role in ROLE_LEVEL)) return "forbidden";

    return isRoleAllowed(endpoint, ctx.role as AccessRole)
      ? "allow"
      : "forbidden";
  };
}

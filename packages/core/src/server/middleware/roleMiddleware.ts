import type { UserRole } from "../types/dashboard.js";
import { ROLE_HIERARCHY } from "../types/dashboard.js";
import { createLogger } from "../../config/logger.js";

const log = createLogger("RoleMiddleware");

/**
 * Obtiene el rol actual del dashboard desde la variable de entorno.
 * Si no está configurado, retorna "viewer" por defecto.
 */
export function getCurrentRole(): UserRole {
  const envRole = process.env.DASHBOARD_ROLE?.toLowerCase();
  if (
    envRole === "super_admin" ||
    envRole === "admin" ||
    envRole === "operator" ||
    envRole === "viewer"
  ) {
    return envRole;
  }
  return "viewer";
}

/**
 * Verifica si un rol tiene permisos suficientes para una acción.
 * Usa la jerarquía: admin > operator > viewer.
 *
 * @param currentRole - Rol del usuario actual
 * @param requiredRole - Rol mínimo requerido para la acción
 * @returns true si el usuario tiene permisos suficientes
 */
export function hasPermission(
  currentRole: UserRole,
  requiredRole: UserRole,
): boolean {
  return ROLE_HIERARCHY[currentRole] >= ROLE_HIERARCHY[requiredRole];
}

/**
 * Middleware de autorización para endpoints del dashboard.
 * Retorna un objeto de error 403 si el rol es insuficiente,
 * o null si la autorización es exitosa.
 *
 * @param requiredRole - Rol mínimo requerido para acceder al endpoint
 * @returns null si autorizado, o un objeto de error para retornar al cliente
 */
export function checkRole(requiredRole: UserRole): {
  error: string;
  requiredRole: UserRole;
  currentRole: UserRole;
} | null {
  const currentRole = getCurrentRole();

  if (!hasPermission(currentRole, requiredRole)) {
    log.warn(
      { currentRole, requiredRole },
      "Acceso denegado por rol insuficiente",
    );
    return {
      error: "Forbidden",
      requiredRole,
      currentRole,
    };
  }

  return null;
}

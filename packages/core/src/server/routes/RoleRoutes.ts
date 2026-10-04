import { HealthServer } from "../HealthServer.js";
import { getCurrentRole } from "../middleware/roleMiddleware.js";
import { ROLE_HIERARCHY } from "../types/dashboard.js";
import type { UserRole, RoleConfig } from "../types/dashboard.js";

/** Secciones permitidas por rol */
const ROLE_SECTIONS: Record<UserRole, string[]> = {
  super_admin: ["overview", "operations", "intelligence", "system", "platform"],
  admin: ["overview", "operations", "intelligence", "system"],
  operator: ["overview", "operations", "intelligence"],
  viewer: ["overview"],
};

/** Acciones permitidas por rol */
const ROLE_ACTIONS: Record<UserRole, string[]> = {
  super_admin: [
    "view",
    "invoke-tool",
    "force-mutation",
    "manage-scheduler",
    "invalidate-reflex",
    "broadcast-ws",
    "disconnect-ws",
    "manage-tenants",
    "manage-platform",
  ],
  admin: [
    "view",
    "invoke-tool",
    "force-mutation",
    "manage-scheduler",
    "invalidate-reflex",
    "broadcast-ws",
    "disconnect-ws",
  ],
  operator: ["view", "manage-scheduler"],
  viewer: ["view"],
};

/**
 * Rutas de rol: retorna el rol actual y su configuración de permisos.
 */
export function setupRoleRoutes(health: HealthServer): void {
  health.registerData("role", async () => {
    const role = getCurrentRole();
    const config: RoleConfig = {
      role,
      sections: ROLE_SECTIONS[role],
      actions: ROLE_ACTIONS[role],
    };
    return config;
  });
}

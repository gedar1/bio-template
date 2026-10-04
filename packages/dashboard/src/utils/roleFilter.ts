import type { UserRole } from "../types/dashboard";

/**
 * Role hierarchy: viewer ⊆ operator ⊆ admin ⊆ super_admin
 * Each role includes all permissions of lower roles.
 */
const ROLE_LEVEL: Record<UserRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
  super_admin: 4,
};

/**
 * Panels accessible by each role (cumulative).
 * viewer sees: overview panels (health, perf)
 * operator adds: scheduler, activity, chat, tools (read-only)
 * admin adds: everything else
 * super_admin adds: platform management panels
 */
const ROLE_PANELS: Record<UserRole, Set<string>> = {
  viewer: new Set(["health", "perf"]),
  operator: new Set(["health", "perf", "scheduler", "activity", "chat"]),
  admin: new Set([
    "health",
    "perf",
    "scheduler",
    "activity",
    "chat",
    "tools",
    "reflex",
    "circuit-breaker",
    "logs",
    "mutations",
    "registry",
    "websocket",
    "settings",
  ]),
  super_admin: new Set([
    "health",
    "perf",
    "scheduler",
    "activity",
    "chat",
    "tools",
    "reflex",
    "circuit-breaker",
    "logs",
    "mutations",
    "registry",
    "websocket",
    "settings",
    "platform",
    "tenant-overview",
    "tenant-metrics",
    "tenant-alerts",
    "tenant-management",
  ]),
};

/**
 * Actions accessible by each role (cumulative).
 */
const ROLE_ACTIONS: Record<UserRole, Set<string>> = {
  viewer: new Set(["view"]),
  operator: new Set(["view", "create-task", "send-chat"]),
  admin: new Set([
    "view",
    "create-task",
    "send-chat",
    "invoke-tool",
    "force-mutation",
    "invalidate-reflex",
    "broadcast-ws",
    "disconnect-ws",
  ]),
  super_admin: new Set([
    "view",
    "create-task",
    "send-chat",
    "invoke-tool",
    "force-mutation",
    "invalidate-reflex",
    "broadcast-ws",
    "disconnect-ws",
    "manage-tenants",
    "manage-platform",
  ]),
};

/**
 * Checks if a role has access to a specific panel.
 */
export function canAccessPanel(role: UserRole, panel: string): boolean {
  return ROLE_PANELS[role]?.has(panel) ?? false;
}

/**
 * Checks if a role can perform a specific action.
 */
export function canPerformAction(role: UserRole, action: string): boolean {
  return ROLE_ACTIONS[role]?.has(action) ?? false;
}

/**
 * Filters a list of panel IDs to only those accessible by the given role.
 */
export function filterPanelsByRole(role: UserRole, panels: string[]): string[] {
  const allowed = ROLE_PANELS[role];
  if (!allowed) return [];
  return panels.filter((panel) => allowed.has(panel));
}

/**
 * Filters a list of action IDs to only those permitted for the given role.
 */
export function filterActionsByRole(
  role: UserRole,
  actions: string[],
): string[] {
  const allowed = ROLE_ACTIONS[role];
  if (!allowed) return [];
  return actions.filter((action) => allowed.has(action));
}

/**
 * Checks if roleA has at least the same level as roleB.
 * Useful for middleware authorization checks.
 */
export function hasMinimumRole(
  currentRole: UserRole,
  requiredRole: UserRole,
): boolean {
  return ROLE_LEVEL[currentRole] >= ROLE_LEVEL[requiredRole];
}

/**
 * Returns the numeric level for a role (higher = more permissions).
 */
export function getRoleLevel(role: UserRole): number {
  return ROLE_LEVEL[role] ?? 0;
}

/**
 * Panels that are NEVER accessible to tenant-authenticated users,
 * regardless of their role within the tenant.
 * This is a belt-and-suspenders check: the role-based filtering already
 * excludes these (they're only in super_admin), but this makes the
 * tenant isolation explicit.
 */
const TENANT_EXCLUDED_PANELS: Set<string> = new Set([
  "platform",
  "tenant-overview",
  "tenant-metrics",
  "tenant-alerts",
  "tenant-management",
]);

/**
 * Filters panels for a tenant-authenticated user.
 * Applies role-based filtering AND explicitly removes platform panels.
 * Use this instead of filterPanelsByRole when the user is authenticated via tenant JWT.
 */
export function filterPanelsForTenant(
  role: UserRole,
  panels: string[],
): string[] {
  const roleFiltered = filterPanelsByRole(role, panels);
  return roleFiltered.filter((panel) => !TENANT_EXCLUDED_PANELS.has(panel));
}

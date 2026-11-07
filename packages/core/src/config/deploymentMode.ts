/**
 * Modo de despliegue del template.
 *
 * - "studio": varios clientes (tenants) administrados desde la plataforma.
 *   Es el valor por defecto y mantiene el comportamiento multi-tenant.
 * - "single": un solo negocio. La gestión de tenants de plataforma queda
 *   deshabilitada y todas las peticiones se resuelven al tenant único
 *   (TENANT_ID). El aislamiento de datos y la autenticación siguen activos.
 *
 * Se lee de DEPLOYMENT_MODE. Cualquier valor distinto de "single" es "studio".
 */
export type DeploymentMode = "single" | "studio";

export function getDeploymentMode(
  env: NodeJS.ProcessEnv = process.env,
): DeploymentMode {
  return env.DEPLOYMENT_MODE === "single" ? "single" : "studio";
}

/** Tenant único del despliegue en modo single. Por defecto "default". */
export function getSingleTenantId(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.TENANT_ID?.trim() || "default";
}

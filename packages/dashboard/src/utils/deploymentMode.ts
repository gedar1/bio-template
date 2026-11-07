/**
 * Modo de despliegue del dashboard. Se define en build time con
 * VITE_DEPLOYMENT_MODE en packages/dashboard/.env (mismo valor que DEPLOYMENT_MODE
 * del backend). Por defecto "studio".
 */
export type DeploymentMode = "single" | "studio";

export const DEPLOYMENT_MODE: DeploymentMode =
  import.meta.env.VITE_DEPLOYMENT_MODE === "single" ? "single" : "studio";

/** true si el despliegue administra varios clientes desde la plataforma */
export const IS_STUDIO_MODE = DEPLOYMENT_MODE === "studio";

/**
 * Tenant inicial del dashboard. En single es el tenant único del negocio
 * (debe coincidir con TENANT_ID del backend). Se define con VITE_TENANT_ID.
 */
export const DEFAULT_TENANT_ID: string =
  (import.meta.env.VITE_TENANT_ID as string | undefined)?.trim() || "default";

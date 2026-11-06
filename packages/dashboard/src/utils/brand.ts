/**
 * Nombre que se muestra en el encabezado del dashboard.
 * Se define con VITE_BRAND_NAME en packages/dashboard/.env. Por defecto "BioCore".
 */
export const BRAND_NAME: string =
  (import.meta.env.VITE_BRAND_NAME as string | undefined)?.trim() || "BioCore";

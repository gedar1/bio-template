/**
 * Etiquetas en lenguaje de negocio para cada herramienta.
 * El usuario ve estas etiquetas, nunca el nombre técnico de la herramienta.
 * Cada perfil de industria puede sobreescribir sus nombres aquí.
 */
export const TOOL_LABELS: Record<string, string> = {
  scrape_url: "Leer la página",
  extract_links: "Extraer enlaces",
  db_find: "Buscar en la base de datos",
  db_query: "Consultar la base de datos",
  db_insert: "Guardar la información",
  db_update: "Actualizar la información",
  db_delete: "Eliminar la información",
};

const FALLBACK_LABEL = "Paso del proceso";

export function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? FALLBACK_LABEL;
}

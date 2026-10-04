/**
 * Formateadores de resultados de herramientas MCP.
 * Funciones puras — sin estado, sin efectos secundarios.
 *
 * Convierte respuestas crudas (HTML, JSON largo) en resúmenes legibles
 * para mostrar al usuario en el chat o dashboard.
 */

type ToolFormatter = (result: string, args?: Record<string, unknown>) => string;

const TOOL_FORMATTERS: Record<string, ToolFormatter> = {
  // ─── Sensory ────────────────────────────────────────────────────────────
  scrape_url: (result, args) => {
    const url = (args?.url as string) || "";
    try {
      const parsed = JSON.parse(result);
      const title = parsed.title || parsed.name || "";
      return title
        ? `📄 Extraído: "${title}" (${url})`
        : `📄 Datos extraídos de ${url || "la fuente"}`;
    } catch {
      if (result.includes("<!doctype") || result.includes("<html")) {
        return `📄 Página extraída de ${url || "la URL"} (${result.length} chars)`;
      }
      return `📄 Contenido extraído (${result.length} chars)`;
    }
  },

  fetch_api: (result, args) => TOOL_FORMATTERS.scrape_url(result, args),

  extract_links: (result) => {
    try {
      const parsed = JSON.parse(result);
      const count = Array.isArray(parsed) ? parsed.length : 0;
      return `🔗 ${count} link(s) extraído(s)`;
    } catch {
      return `🔗 Links extraídos`;
    }
  },

  scrape_metadata: (result) => {
    try {
      const parsed = JSON.parse(result);
      const title = parsed.title || parsed.og_title || "";
      return title ? `📋 Metadata: "${title}"` : `📋 Metadata extraída`;
    } catch {
      return `📋 Metadata extraída`;
    }
  },

  // ─── HTTP ───────────────────────────────────────────────────────────────
  http_get: (result, args) => {
    const url = (args?.url as string) || "";
    if (result.includes("<!doctype") || result.includes("<html")) {
      return `✅ Endpoint activo — ${url || "URL"} respondió correctamente`;
    }
    try {
      const parsed = JSON.parse(result);
      if (parsed.status) return `✅ ${url} — status: ${parsed.status}`;
      return `✅ ${url || "Endpoint"} — respuesta recibida (${result.length} chars)`;
    } catch {
      return `✅ ${url || "Endpoint"} — respuesta recibida (${result.length} chars)`;
    }
  },

  http_post: (result, args) => {
    const url = (args?.url as string) || "";
    try {
      const parsed = JSON.parse(result);
      const status = parsed.status || parsed.statusCode || 200;
      return `📤 POST ${url} — status: ${status}`;
    } catch {
      return `📤 POST completado`;
    }
  },

  // ─── Memory ─────────────────────────────────────────────────────────────
  db_query: (result) => {
    try {
      const parsed = JSON.parse(result);
      const count = Array.isArray(parsed) ? parsed.length : (parsed.count ?? 1);
      return `🔍 ${count} resultado(s) encontrado(s)`;
    } catch {
      return `🔍 Consulta ejecutada`;
    }
  },

  db_find: (result) => TOOL_FORMATTERS.db_query(result),

  db_insert: (result) =>
    result.includes("ID:") ? `💾 ${result}` : `💾 Registro guardado`,

  db_update: () => `💾 Registro actualizado`,

  db_delete: () => `🗑️ Registro eliminado`,

  // ─── Filesystem ─────────────────────────────────────────────────────────
  read_file: (result) => `📖 Archivo leído (${result.length} chars)`,

  write_file: () => `📝 Archivo guardado`,

  list_files: (result) => {
    try {
      const parsed = JSON.parse(result);
      const count = Array.isArray(parsed) ? parsed.length : 0;
      return `📂 ${count} archivo(s) listado(s)`;
    } catch {
      return `📂 Archivos listados`;
    }
  },

  // ─── Communication ──────────────────────────────────────────────────────
  send_email: () => `📧 Email enviado`,

  send_whatsapp: () => `📱 WhatsApp enviado`,

  // ─── Version Control ────────────────────────────────────────────────────
  git_status: (result) => {
    if (result.includes("clean") || result.includes("nothing to commit")) {
      return `✅ Repositorio limpio`;
    }
    return `📋 ${result.length > 80 ? result.substring(0, 80) + "..." : result}`;
  },

  git_commit: (result) =>
    result.includes("Commit:") ? `✅ ${result}` : `✅ Commit realizado`,

  git_push: () => `🚀 Push completado`,

  git_pull: () => `⬇️ Pull completado`,

  // ─── System ─────────────────────────────────────────────────────────────
  execute_cli: (result) =>
    result.length > 200 ? `${result.substring(0, 200)}...` : result,

  check_command: (result) => result,

  system_info: () => `ℹ️ Información del sistema obtenida`,

  // ─── Orders (Restaurant) ────────────────────────────────────────────────
  create_order: (result) => result,

  update_order_status: (result) => result,

  list_orders: (result) => result,

  cancel_order: (result) => result,

  daily_summary: (result) => result,

  // ─── Inventory (Restaurant) ─────────────────────────────────────────────
  check_stock: (result) => result,

  upsert_inventory: (result) => result,

  list_inventory: (result) => result,

  low_stock_alerts: (result) => result,

  decrease_stock: (result) => result,

  // ─── Delivery (Restaurant) ──────────────────────────────────────────────
  assign_delivery: (result) => result,

  track_delivery: (result) => result,

  estimate_time: (result) => result,

  mark_delivered: (result) => result,

  // ─── WebSocket ──────────────────────────────────────────────────────────
  ws_broadcast: () => `📡 Broadcast enviado`,

  ws_send: () => `📡 Mensaje enviado`,

  ws_list_clients: (result) => {
    try {
      const parsed = JSON.parse(result);
      return `📡 ${parsed.count ?? 0} cliente(s) conectado(s)`;
    } catch {
      return `📡 Clientes listados`;
    }
  },
};

/**
 * Formatea el resultado de una herramienta en un resumen legible.
 * Si no hay formatter específico, trunca resultados largos.
 */
export function summarizeToolResult(
  tool: string,
  result: string,
  args?: Record<string, unknown>,
): string {
  const formatter = TOOL_FORMATTERS[tool];
  if (formatter) return formatter(result, args);

  // Default: truncar resultados largos
  return result.length > 300
    ? `• ${tool}: ${result.substring(0, 300)}...`
    : `• ${result}`;
}

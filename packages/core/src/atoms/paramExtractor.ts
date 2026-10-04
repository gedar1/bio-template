/**
 * Extracción de parámetros desde texto natural para la Memoria Refleja.
 * Funciones puras — sin estado, sin efectos secundarios.
 *
 * Permite que el modo REFLEX ejecute flujos completos sin LLM extrayendo
 * parámetros concretos (URLs, rutas, emails, tablas, etc.) directamente
 * del texto del usuario con patrones regex.
 */

/** Mapa de parámetros extraídos para un step: { url: "...", table: "..." } */
export type StepParams = Record<string, string>;

/** Mapa completo: nombre del tool → sus parámetros extraídos */
export type ExtractedParams = Record<string, StepParams>;

// ─── Patrones de extracción ───────────────────────────────────────────────────

const URL_PATTERN = /https?:\/\/[^\s"'<>()[\],]+/gi;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/gi;
const FILE_PATH_PATTERN =
  /(?:archivo|file|fichero|path|ruta)[:\s]+["']?([./\w\-. ]+\.\w+)["']?/gi;
const TABLE_PATTERN =
  /(?:tabla|table|coleccion|collection)[:\s]+["']?(\w+)["']?/gi;
const BRANCH_PATTERN = /(?:rama|branch)[:\s]+["']?([\w.\-/]+)["']?/gi;
const COMMIT_MSG_PATTERN = /(?:mensaje|message|commit)[:\s]+"([^"]+)"/gi;
const QUERY_PATTERN = /(?:query|consulta|sql)[:\s]+"([^"]+)"/gi;
const SUBJECT_PATTERN = /(?:asunto|subject)[:\s]+"([^"]+)"/gi;

/**
 * Extrae la primera URL del texto del usuario.
 */
function extractUrl(text: string): string | undefined {
  const matches = text.match(URL_PATTERN);
  return matches?.[0];
}

/**
 * Extrae todas las URLs del texto.
 */
function extractAllUrls(text: string): string[] {
  return text.match(URL_PATTERN) ?? [];
}

/**
 * Extrae el primer email del texto.
 */
function extractEmail(text: string): string | undefined {
  const matches = text.match(EMAIL_PATTERN);
  return matches?.[0];
}

/**
 * Extrae el nombre de tabla/colección mencionado en el texto.
 * Soporta: "tabla users", "table products", "en la tabla=orders"
 */
function extractTableName(text: string): string | undefined {
  TABLE_PATTERN.lastIndex = 0;
  const match = TABLE_PATTERN.exec(text);
  return match?.[1];
}

/**
 * Extrae una ruta de archivo del texto.
 * Soporta: "archivo ./data/out.json", "en el path src/config.ts"
 */
function extractFilePath(text: string): string | undefined {
  FILE_PATH_PATTERN.lastIndex = 0;
  const match = FILE_PATH_PATTERN.exec(text);
  if (match?.[1]) return match[1].trim();

  // Fallback: buscar patrones de ruta directos (./algo, /algo, algo.ext)
  const directPath = text.match(
    /(?:^|\s)(\.\/[\w./\-]+|\/[\w./\-]+|[\w\-]+\.(?:json|ts|js|txt|md|csv|yaml|yml))/,
  );
  return directPath?.[1]?.trim();
}

/**
 * Extrae rama de git del texto.
 */
function extractBranch(text: string): string {
  BRANCH_PATTERN.lastIndex = 0;
  const match = BRANCH_PATTERN.exec(text);
  return match?.[1] ?? "main";
}

/**
 * Extrae mensaje de commit del texto.
 * Si no encuentra uno explícito, genera uno genérico.
 */
function extractCommitMessage(text: string): string {
  COMMIT_MSG_PATTERN.lastIndex = 0;
  const match = COMMIT_MSG_PATTERN.exec(text);
  if (match?.[1]) return match[1];

  // Fallback: limpiar el texto del usuario como mensaje
  return (
    text
      .replaceAll(/(?:haz|make|do|sube|commit|push|guarda)[^a-z]*/gi, "")
      .trim()
      .substring(0, 72) || "chore: update"
  );
}

/**
 * Extrae asunto de email del texto.
 */
function extractSubject(text: string): string | undefined {
  SUBJECT_PATTERN.lastIndex = 0;
  const match = SUBJECT_PATTERN.exec(text);
  return match?.[1];
}

/**
 * Extrae una query SQL o descripción de búsqueda del texto.
 */
function extractQuery(text: string): string | undefined {
  QUERY_PATTERN.lastIndex = 0;
  const match = QUERY_PATTERN.exec(text);
  return match?.[1];
}

// ─── Extractor principal ──────────────────────────────────────────────────────

/**
 * Extrae parámetros del texto del usuario para cada herramienta en la secuencia.
 * Devuelve un mapa tool → params que puede pasarse directamente a executeReflex().
 *
 * @param userInput - Texto original del usuario
 * @param toolNames - Lista de nombres de herramientas en el reflex (sin mutaciones)
 * @returns Mapa con los parámetros extraídos por herramienta
 *
 * @example
 * extractParamsForReflex(
 *   "scrapea https://ejemplo.com y guarda en tabla users",
 *   ["scrape_url", "db_insert"]
 * )
 * // → { scrape_url: { url: "https://ejemplo.com" }, db_insert: { table: "users" } }
 */
export function extractParamsForReflex(
  userInput: string,
  toolNames: string[],
): ExtractedParams {
  const result: ExtractedParams = {};
  const url = extractUrl(userInput);
  const email = extractEmail(userInput);
  const table = extractTableName(userInput);
  const path = extractFilePath(userInput);
  const query = extractQuery(userInput);

  for (const tool of toolNames) {
    switch (tool) {
      // ── Scraping ──────────────────────────────────────────────────────────
      case "scrape_url":
      case "scrape_metadata":
      case "extract_links":
      case "extract_images":
      case "analyze_page":
        result[tool] = url ? { url } : {};
        break;

      case "scrape_multiple_pages":
        result[tool] = { urls: extractAllUrls(userInput).join(",") };
        break;

      // ── HTTP ──────────────────────────────────────────────────────────────
      case "http_get":
      case "http_post":
      case "http_put":
      case "http_delete":
        result[tool] = url ? { url } : {};
        break;

      case "fetch_api":
        result[tool] = url ? { url } : {};
        break;

      case "http_download":
        result[tool] = {
          ...(url ? { url } : {}),
          ...(path ? { destination: path } : {}),
        };
        break;

      case "http_upload":
        result[tool] = {
          ...(url ? { url } : {}),
          ...(path ? { filePath: path } : {}),
        };
        break;

      // ── Base de datos ─────────────────────────────────────────────────────
      case "db_insert":
        result[tool] = table ? { table } : {};
        break;

      case "db_query":
        result[tool] = {
          ...(query ? { query } : {}),
          ...(table ? { table } : {}),
        };
        break;

      case "db_find":
      case "db_update":
      case "db_delete":
        result[tool] = table ? { table } : {};
        break;

      case "create_table":
        result[tool] = table ? { name: table } : {};
        break;

      // ── Filesystem ────────────────────────────────────────────────────────
      case "read_file":
      case "delete_file":
        result[tool] = path ? { path } : {};
        break;

      case "write_file":
        result[tool] = path ? { path } : {};
        break;

      case "read_json":
      case "write_json":
        result[tool] = path ? { path } : {};
        break;

      case "list_files": {
        const dir = path?.replace(/[^/\\]*\.[^/\\]+$/, "") || "./";
        result[tool] = { path: dir };
        break;
      }

      case "copy_file":
      case "move_file": {
        const allPaths =
          userInput.match(/(?:\.\/[\w./\-]+|\/[\w./\-]+|[\w\-]+\.[\w]+)/g) ??
          [];
        result[tool] = {
          source: allPaths[0] ?? "",
          destination: allPaths[1] ?? "",
        };
        break;
      }

      // ── Git ───────────────────────────────────────────────────────────────
      case "git_add":
        result[tool] = { files: "." }; // por defecto agrega todo
        break;

      case "git_commit":
        result[tool] = { message: extractCommitMessage(userInput) };
        break;

      case "git_push":
      case "git_pull":
        result[tool] = { branch: extractBranch(userInput) };
        break;

      case "git_checkout":
        result[tool] = { branch: extractBranch(userInput) };
        break;

      case "git_status":
      case "git_log":
      case "git_init":
        result[tool] = {}; // no requieren parámetros
        break;

      // ── Comunicación ──────────────────────────────────────────────────────
      case "send_email":
      case "send_template_email": {
        const subject = extractSubject(userInput);
        result[tool] = {
          ...(email ? { to: email } : {}),
          ...(subject ? { subject } : {}),
        };
        break;
      }

      case "send_bulk_email":
        result[tool] = {};
        break;

      case "send_whatsapp":
        result[tool] = {};
        break;

      // ── Sistema ───────────────────────────────────────────────────────────
      case "system_info":
      case "check_command":
        result[tool] = {};
        break;

      case "execute_cli": {
        const cliMatch = userInput.match(
          /(?:ejecuta|run|corre)[:\s]+["']?([^"'\n]+)["']?/i,
        );
        result[tool] = cliMatch?.[1] ? { command: cliMatch[1].trim() } : {};
        break;
      }

      default:
        result[tool] = {};
    }
  }

  return result;
}

// ─── Extractor genérico para InterpolationEngine ──────────────────────────────

/**
 * Extrae todos los parámetros detectables del texto del usuario.
 * Retorna un mapa de tipo → valor para uso por el InterpolationEngine.
 *
 * @param text - Texto del usuario
 * @returns Mapa { url: "https://...", email: "user@...", table: "users", ... }
 */
export function extractParamsFromText(text: string): Record<string, string> {
  const params: Record<string, string> = {};

  const url = extractUrl(text);
  if (url) params.url = url;

  const email = extractEmail(text);
  if (email) params.email = email;

  const table = extractTableName(text);
  if (table) params.table = table;

  const path = extractFilePath(text);
  if (path) params.path = path;

  const query = extractQuery(text);
  if (query) params.query = query;

  const branch = extractBranch(text);
  if (branch && branch !== "main") params.branch = branch; // only if explicitly mentioned

  return params;
}

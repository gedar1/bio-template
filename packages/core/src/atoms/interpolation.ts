/**
 * Átomos de interpolación de plantillas para la Memoria Refleja de BioCore.
 * Funciones puras — sin estado, sin efectos secundarios.
 *
 * Implementa el sistema de Arg Templates: derivación de plantillas desde
 * argumentos concretos, interpolación con parámetros extraídos, y
 * serialización/deserialización para almacenamiento en SQLite.
 */

// ─── Interfaces ───────────────────────────────────────────────────────────────

/** Un placeholder en una plantilla de argumentos */
export interface TemplatePlaceholder {
  /** Nombre del placeholder, e.g. "$URL", "$TABLE" */
  name: string;
  /** La clave original del argumento, e.g. "url", "table" */
  argKey: string;
  /** Tipo del valor original para matching de fallback */
  valueType:
    | "url"
    | "email"
    | "path"
    | "table"
    | "query"
    | "branch"
    | "string"
    | "number"
    | "object";
}

/** Plantilla de argumentos para un paso de reflex */
export interface ArgTemplate {
  /** Mapa de argKey → nombre del placeholder */
  placeholders: Record<string, string>;
  /** Los argumentos concretos originales usados en la ejecución exitosa */
  originalArgs: Record<string, unknown>;
  /** Metadata de cada placeholder */
  placeholderMeta: TemplatePlaceholder[];
}

/** Plantillas de argumentos para todos los pasos de un reflex */
export type ReflexArgTemplates = ArgTemplate[];

// ─── Patrones de detección ────────────────────────────────────────────────────

const URL_REGEX = /^https?:\/\/.+/i;
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/i;
const PATH_REGEX = /^(?:\.\/|\.\.\/|\/|[a-zA-Z]:\\)[\w./\\ -]+$/;

// ─── Funciones de derivación ──────────────────────────────────────────────────

/**
 * Determina el tipo de valor y el nombre del placeholder para un par clave-valor.
 * Retorna null si el valor es un objeto (no se templatiza).
 */
function classifyArg(
  key: string,
  value: unknown,
): { name: string; valueType: TemplatePlaceholder["valueType"] } | null {
  // Objects are never templatized
  if (value !== null && typeof value === "object") {
    return null;
  }

  const strValue = String(value);

  // Check value patterns first
  if (typeof value === "string" && URL_REGEX.test(strValue)) {
    return { name: "$URL", valueType: "url" };
  }

  if (typeof value === "string" && EMAIL_REGEX.test(strValue)) {
    return { name: "$EMAIL", valueType: "email" };
  }

  if (typeof value === "string" && PATH_REGEX.test(strValue)) {
    return { name: "$PATH", valueType: "path" };
  }

  // Check key-based patterns
  const lowerKey = key.toLowerCase();

  if (lowerKey === "table" || lowerKey === "collection") {
    return { name: "$TABLE", valueType: "table" };
  }

  if (lowerKey === "query" || lowerKey === "sql") {
    return { name: "$QUERY", valueType: "query" };
  }

  if (lowerKey === "branch") {
    return { name: "$BRANCH", valueType: "branch" };
  }

  // Check number type
  if (typeof value === "number") {
    return { name: "$NUMBER", valueType: "number" };
  }

  // Default: string fallback
  return { name: `$${key.toUpperCase()}`, valueType: "string" };
}

/**
 * Deriva una ArgTemplate desde argumentos concretos usados en una ejecución exitosa.
 * Inspecciona cada valor para determinar su tipo y asignar un nombre de placeholder.
 *
 * @param args - Los argumentos concretos del paso
 * @returns ArgTemplate con placeholders, originalArgs (deep copy), y metadata
 *
 * @example
 * deriveTemplate({ url: "https://example.com", schema: { title: "string" } })
 * // → { placeholders: { url: "$URL" }, originalArgs: { url: "https://...", schema: {...} },
 * //     placeholderMeta: [{ name: "$URL", argKey: "url", valueType: "url" }] }
 */
export function deriveTemplate(args: Record<string, unknown>): ArgTemplate {
  const placeholders: Record<string, string> = {};
  const placeholderMeta: TemplatePlaceholder[] = [];
  const originalArgs: Record<string, unknown> = structuredClone(args);

  for (const [key, value] of Object.entries(args)) {
    const classification = classifyArg(key, value);

    if (classification !== null) {
      placeholders[key] = classification.name;
      placeholderMeta.push({
        name: classification.name,
        argKey: key,
        valueType: classification.valueType,
      });
    }
    // Objects: no placeholder, preserved as-is in originalArgs
  }

  return { placeholders, originalArgs, placeholderMeta };
}

// ─── Funciones de interpolación ───────────────────────────────────────────────

/** Tipos de placeholder que son requeridos (causan null si faltan) */
const REQUIRED_VALUE_TYPES: Set<TemplatePlaceholder["valueType"]> = new Set([
  "url",
  "email",
]);

/**
 * Interpola una ArgTemplate con valores extraídos del input del usuario.
 * Retorna los argumentos resueltos o null si faltan placeholders requeridos.
 *
 * @param template - La ArgTemplate almacenada
 * @param extractedParams - Valores extraídos del input del usuario por paramExtractor
 * @returns Objeto de argumentos resueltos, o null si la interpolación falla
 */
export function interpolateTemplate(
  template: ArgTemplate,
  extractedParams: Record<string, string>,
): Record<string, unknown> | null {
  const result: Record<string, unknown> = {};

  // Start with all originalArgs (includes objects and non-placeholder values)
  for (const [key, value] of Object.entries(template.originalArgs)) {
    // If this key has no placeholder, preserve the original value
    if (!(key in template.placeholders)) {
      result[key] = structuredClone(value);
    }
  }

  // Resolve each placeholder
  for (const meta of template.placeholderMeta) {
    const extractedValue = extractedParams[meta.valueType];

    if (extractedValue !== undefined && extractedValue !== "") {
      result[meta.argKey] = extractedValue;
    } else if (REQUIRED_VALUE_TYPES.has(meta.valueType)) {
      // Required placeholder missing → interpolation fails
      return null;
    } else {
      // Optional placeholder missing → fall back to originalArgs value
      result[meta.argKey] = template.originalArgs[meta.argKey];
    }
  }

  return result;
}

// ─── Funciones de serialización ───────────────────────────────────────────────

/**
 * Serializa ReflexArgTemplates a un string JSON para almacenamiento en SQLite.
 *
 * @param templates - Array de ArgTemplate a serializar
 * @returns String JSON
 */
export function serializeArgTemplates(templates: ReflexArgTemplates): string {
  return JSON.stringify(templates);
}

/**
 * Deserializa ReflexArgTemplates desde un string JSON.
 * Retorna null si el string es malformado.
 *
 * @param raw - String JSON desde SQLite
 * @returns ReflexArgTemplates o null si es inválido
 */
export function deserializeArgTemplates(
  raw: string,
): ReflexArgTemplates | null {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as ReflexArgTemplates;
  } catch {
    return null;
  }
}

/**
 * Átomo de extracción de URLs del mensaje del usuario.
 * Función pura: sin estado, sin I/O.
 *
 * La extracción no tiene fallback: si el mensaje no trae una URL explícita o un
 * dominio con TLD, devuelve null y el flujo debe preguntarla.
 */

/**
 * Similitud mínima del reflex seleccionado para ejecutar una cadena sin LLM.
 * Igual al MIN_CONFIDENCE de cellRouter. Jev devolvió 0.85 a 0.89 en pruebas,
 * así que 0.85 quedaba en el borde.
 */
export const CHAIN_MIN_SIMILARITY = 0.7;

/** Aviso cuando hay una ejecución pendiente y el siguiente mensaje no trae el dato requerido. */
export const PENDING_DISCARDED_WARNING =
  "Descarté la ejecución pendiente porque el mensaje no trae el dato que necesitaba. Envía de nuevo tu instrucción con ese dato.";

/** Extensiones de archivo comunes que no deben tomarse como TLD de un dominio. */
const FILE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
  "pdf",
  "csv",
  "json",
  "txt",
  "xml",
  "xlsx",
  "docx",
  "zip",
  "md",
  "mp4",
  "mp3",
  "js",
  "ts",
  "py",
]);

const EXPLICIT_URL = /\bhttps?:\/\/[^\s<>"'`]+/i;
const BARE_DOMAIN =
  /\b(?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}(?:\/[^\s<>"'`]*)?/i;

/**
 * Extrae una URL http(s) del texto. Acepta URL explícitas o dominios sin protocolo
 * (se les antepone https://). Devuelve null si no hay una URL válida.
 *
 * @example extractUrl("scrapea example.com y guarda") // → "https://example.com/"
 * @example extractUrl("scrapea la web y guarda en la bd") // → null
 */
export function extractUrl(text: string): string | null {
  const explicit = text.match(EXPLICIT_URL)?.[0];
  const bare = explicit ? undefined : text.match(BARE_DOMAIN)?.[0];
  const candidate = (explicit ?? bare)?.replace(/[.,;:!?)]+$/, "");
  if (!candidate) return null;
  // Sin protocolo, "tomates.jpg" parece un dominio. Se descarta si el TLD es un tipo de archivo.
  if (bare && FILE_EXTENSIONS.has(bare.split("/")[0].split(".").pop() ?? "")) {
    return null;
  }
  const withProtocol = /^https?:\/\//i.test(candidate)
    ? candidate
    : `https://${candidate}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

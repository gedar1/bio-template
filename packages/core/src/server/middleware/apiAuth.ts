import type { IncomingMessage } from "node:http";
import { createLogger } from "../../config/logger.js";

const log = createLogger("ApiAuth");

/**
 * Middleware de autenticación por API Key.
 *
 * Valida que el request incluya un header `Authorization: Bearer <API_SECRET>`
 * o un query param `?apiKey=<API_SECRET>`.
 *
 * Si `API_SECRET` no está configurado en .env, la autenticación se desactiva
 * (modo desarrollo / localhost).
 *
 * Endpoints excluidos (siempre públicos):
 * - /health (healthchecks de Docker/k8s)
 * - OPTIONS (preflight CORS)
 */

/** Lee el secret de la variable de entorno al inicio */
const API_SECRET = process.env.API_SECRET || "";

/**
 * Verifica si la autenticación está habilitada.
 * Si API_SECRET no está configurado, todo pasa (modo desarrollo).
 */
export function isAuthEnabled(): boolean {
  return API_SECRET.length > 0;
}

/**
 * Verifica la autenticación de un request HTTP.
 *
 * @returns null si autenticado (o auth deshabilitada), o un objeto de error si no autorizado
 */
export function checkAuth(
  req: IncomingMessage,
): { error: string; status: number } | null {
  // Si no hay secret configurado, auth deshabilitada (modo desarrollo)
  if (!API_SECRET) {
    return null;
  }

  const url = req.url || "/";

  // Endpoints públicos — no requieren auth
  if (url === "/health" || req.method === "OPTIONS") {
    return null;
  }

  // Archivos estáticos del dashboard — no requieren auth
  if (!url.startsWith("/api/") && !url.startsWith("/health")) {
    return null;
  }

  // Extraer token del header Authorization: Bearer <token>
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const parts = authHeader.split(" ");
    if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
      if (timingSafeEqual(parts[1], API_SECRET)) {
        return null; // Autenticado
      }
    }
  }

  // Fallback: query param ?apiKey=<token> (para SSE/EventSource que no soporta headers custom)
  const queryIdx = url.indexOf("?");
  if (queryIdx !== -1) {
    const params = new URLSearchParams(url.slice(queryIdx + 1));
    const apiKey = params.get("apiKey");
    if (apiKey && timingSafeEqual(apiKey, API_SECRET)) {
      return null; // Autenticado
    }
  }

  log.warn(
    { url, method: req.method, ip: req.socket.remoteAddress },
    "Request no autenticado rechazado",
  );

  return {
    error:
      "Unauthorized. Provide API key via Authorization: Bearer <key> header or ?apiKey=<key> query param.",
    status: 401,
  };
}

/**
 * Comparación de strings resistente a timing attacks.
 * Evita que un atacante pueda inferir el secret carácter por carácter
 * midiendo tiempos de respuesta.
 */
function timingSafeEqual(input: string, secret: string): boolean {
  if (input.length !== secret.length) {
    // Comparar contra sí mismo para mantener tiempo constante
    compareStrings(secret, secret);
    return false;
  }
  return compareStrings(input, secret);
}

function compareStrings(a: string, b: string): boolean {
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

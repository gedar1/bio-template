import type { IncomingMessage } from "node:http";

/**
 * Cookie de sesión del tenant.
 *
 * El login emite el JWT del tenant en una cookie `httpOnly`, así el dashboard
 * no lo guarda en JavaScript. El servidor la lee cuando la petición no trae
 * `Authorization`, de modo que HTTP y SSE usan el mismo mecanismo.
 *
 * `SameSite=Strict` impide que el navegador envíe la cookie desde otro sitio.
 * `Secure` se activa con `NODE_ENV=production`.
 */

export const TENANT_SESSION_COOKIE = "biocore_tenant_session";

/** Devuelve el valor de una cookie del request, o undefined si no existe. */
export function readCookie(
  req: IncomingMessage,
  name: string,
): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      const value = part.slice(idx + 1).trim();
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}

function secureFlag(): string {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

/** Valor para `Set-Cookie` que guarda la sesión del tenant durante `maxAgeSeconds`. */
export function buildTenantSessionCookie(
  token: string,
  maxAgeSeconds: number,
): string {
  return (
    `${TENANT_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; ` +
    `Max-Age=${maxAgeSeconds}${secureFlag()}`
  );
}

/** Valor para `Set-Cookie` que borra la sesión del tenant. */
export function buildClearTenantSessionCookie(): string {
  return (
    `${TENANT_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; ` +
    `Max-Age=0${secureFlag()}`
  );
}

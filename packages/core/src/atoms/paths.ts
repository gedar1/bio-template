import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Utilidades de resolución de rutas (átomo puro, sin estado ni dependencias).
 *
 * Centraliza el patrón repetido `dirname(fileURLToPath(import.meta.url))` que
 * aparecía disperso en múltiples módulos, reduciendo el acoplamiento con las
 * APIs de `node:url` / `node:path` a un único punto.
 */

/**
 * Retorna el directorio del módulo que invoca.
 * Reemplaza el patrón `const __dirname = dirname(fileURLToPath(import.meta.url))`.
 *
 * @param importMetaUrl - Siempre `import.meta.url` del módulo llamador.
 * @example
 * const __dirname = getModuleDir(import.meta.url);
 */
export function getModuleDir(importMetaUrl: string): string {
  return dirname(fileURLToPath(importMetaUrl));
}

/**
 * Retorna el directorio raíz del proyecto (monorepo `bio-core/`).
 * Resuelto relativo a la ubicación de este átomo (`packages/core/src/atoms/`).
 */
export function getProjectRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
}

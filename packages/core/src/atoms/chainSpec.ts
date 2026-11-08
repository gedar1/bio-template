/**
 * Átomos de las cadenas declaradas por el perfil. Funciones puras: sin estado ni I/O,
 * salvo `$now`, que lee la fecha actual.
 */

import type { ChainDefinition, ExtractorName } from "../config/chainSchema.js";
import { extractUrl } from "./chainExtraction.js";

/** Extractores del motor. El perfil referencia el nombre, no la implementación. */
export const EXTRACTORS: Record<ExtractorName, (text: string) => string | null> = {
  url: (text) => extractUrl(text),
  text: (text) => {
    const trimmed = text.trim();
    return trimmed === "" ? null : trimmed;
  },
};

/** Secuencia de herramientas de la cadena, con el formato que usa Jev: "a→b". */
export function chainSequence(chain: ChainDefinition): string {
  return chain.steps.map((step) => step.tool).join("→");
}

/**
 * Normaliza una secuencia. Los reflexes guardados usan "->" y Jev usa "→".
 * Ambas formas se llevan al formato "→".
 */
export function sequenceKey(sequence: string): string {
  return sequence
    .split(/→|->/)
    .map((step) => step.trim())
    .filter(Boolean)
    .join("→");
}

export type ResolvedArgs =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly missing: string };

/**
 * Resuelve los argumentos de un paso. Recorre objetos y arreglos y reemplaza las
 * referencias `$requires.*`, `$previous` y `$now`. Si falta un dato requerido,
 * devuelve el nombre del dato que falta.
 */
export function resolveArgs(
  template: unknown,
  values: Readonly<Record<string, string>>,
  previous: unknown,
): ResolvedArgs {
  if (typeof template === "string") {
    if (template === "$previous") return { ok: true, value: previous };
    if (template === "$now") return { ok: true, value: new Date().toISOString() };
    if (template.startsWith("$requires.")) {
      const name = template.slice("$requires.".length);
      return name in values
        ? { ok: true, value: values[name] }
        : { ok: false, missing: name };
    }
    return { ok: true, value: template };
  }

  if (Array.isArray(template)) {
    const items: unknown[] = [];
    for (const item of template) {
      const resolved = resolveArgs(item, values, previous);
      if (!resolved.ok) return resolved;
      items.push(resolved.value);
    }
    return { ok: true, value: items };
  }

  if (template !== null && typeof template === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(template)) {
      const resolved = resolveArgs(item, values, previous);
      if (!resolved.ok) return resolved;
      out[key] = resolved.value;
    }
    return { ok: true, value: out };
  }

  return { ok: true, value: template };
}

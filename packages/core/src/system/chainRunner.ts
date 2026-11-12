/**
 * Ejecuta los pasos de una cadena declarada por el perfil.
 *
 * El runner no conoce el cortex ni los organismos. Recibe un puerto con las tres
 * operaciones que necesita, y así puede probarse con un puerto falso.
 */

import type { ChainDefinition } from "../config/chainSchema.js";
import { resolveArgs } from "../atoms/chainSpec.js";

/** Célula que guarda las sentencias de preparación (`setup`). */
export const SETUP_CELL = "memory";

export interface ChainPort {
  /** Cambia la célula activa al tipo indicado. */
  mutate(cellType: string): Promise<void>;
  /** Ejecuta una herramienta de la célula activa y devuelve su salida. */
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  /** Ejecuta una sentencia SQL de preparación en la célula de memoria. */
  runSetup(sql: string): Promise<void>;
}

/**
 * Ejecuta la cadena. Lanza un error si un paso falla o si falta un dato requerido.
 * Devuelve la salida del último paso.
 */
export async function runChain(
  chain: ChainDefinition,
  values: Readonly<Record<string, string>>,
  port: ChainPort,
): Promise<unknown> {
  if (chain.setup.length > 0) {
    await port.mutate(SETUP_CELL);
    for (const sql of chain.setup) {
      await port.runSetup(sql);
    }
  }

  let previous: unknown = undefined;
  for (const step of chain.steps) {
    await port.mutate(step.cell);
    const resolved = resolveArgs(step.args, values, previous);
    if (!resolved.ok) {
      throw new Error(`falta el dato "${resolved.missing}" para ${step.tool}`);
    }
    previous = await port.callTool(
      step.tool,
      resolved.value as Record<string, unknown>,
    );
  }
  return previous;
}

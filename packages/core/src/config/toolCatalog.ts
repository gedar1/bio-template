/**
 * Catálogo de herramientas que Jev recibe como criterios para elegir la cadena.
 *
 * Fuente de nombres y descripciones: config/tools.json.
 * Este módulo solo filtra ese archivo: deja las herramientas que pertenecen a
 * una célula permitida para el tenant. La pertenencia a célula sale de
 * registry.json y domain-registry.json (célula → herramientas).
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

interface RegistryCell {
  readonly type: string;
  readonly tools?: readonly string[];
}

interface RegistryFile {
  readonly cells?: readonly RegistryCell[];
}

const toolDescriptions = require("./tools.json") as Readonly<
  Record<string, string>
>;
const registryFiles = [
  require("./registry.json"),
  require("./domain-registry.json"),
] as RegistryFile[];

/** Mapa herramienta → tipos de célula que la declaran. */
function buildToolCells(): Map<string, Set<string>> {
  const toolCells = new Map<string, Set<string>>();
  for (const file of registryFiles) {
    for (const cell of file.cells ?? []) {
      for (const tool of cell.tools ?? []) {
        const cells = toolCells.get(tool) ?? new Set<string>();
        cells.add(cell.type);
        toolCells.set(tool, cells);
      }
    }
  }
  return toolCells;
}

const TOOL_CELLS = buildToolCells();

/**
 * Devuelve las entradas de tools.json cuya célula está entre las permitidas.
 *
 * @param allowedCells - Tipos de célula permitidos para el tenant
 * @returns Mapa nombre → descripción para los criterios de Jev
 */
export function buildJevToolCatalog(
  allowedCells: readonly string[],
): Record<string, string> {
  const allowed = new Set(allowedCells);
  const catalog: Record<string, string> = {};
  for (const [name, description] of Object.entries(toolDescriptions)) {
    const cells = TOOL_CELLS.get(name);
    if (!cells) continue;
    if ([...cells].some((cell) => allowed.has(cell))) {
      catalog[name] = description;
    }
  }
  return catalog;
}

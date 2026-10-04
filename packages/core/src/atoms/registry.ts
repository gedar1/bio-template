/**
 * Funciones puras para resolver herencia en el Cell Registry.
 * Sin estado, sin efectos secundarios.
 */

export interface CellTypeDefinition {
  type: string;
  description: string;
  tools: string[];
  parent?: string;
}

/**
 * Resuelve las herramientas de un tipo de célula, incluyendo las heredadas del parent.
 * Soporta herencia en cadena (A → B → C).
 * Detecta ciclos para evitar loops infinitos.
 */
export function resolveTools(
  cellType: string,
  cells: CellTypeDefinition[],
  visited: Set<string> = new Set()
): string[] {
  if (visited.has(cellType)) {
    throw new Error(`Ciclo de herencia detectado: ${[...visited, cellType].join(" → ")}`);
  }

  const cell = cells.find(c => c.type === cellType);
  if (!cell) return [];

  visited.add(cellType);

  // Si tiene parent, resolver herramientas del parent primero
  const parentTools = cell.parent
    ? resolveTools(cell.parent, cells, visited)
    : [];

  // Herramientas propias + heredadas, sin duplicados
  const allTools = [...new Set([...parentTools, ...cell.tools])];
  return allTools;
}

/**
 * Resuelve todas las herramientas de todos los tipos del registry.
 * Retorna un mapa tipo → herramientas resueltas.
 */
export function resolveAllTools(
  cells: CellTypeDefinition[]
): Map<string, string[]> {
  const resolved = new Map<string, string[]>();
  for (const cell of cells) {
    resolved.set(cell.type, resolveTools(cell.type, cells));
  }
  return resolved;
}

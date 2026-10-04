import type { RegistryCellType, HierarchyNode } from "../types/dashboard";

/**
 * Builds a hierarchy tree from a flat list of registry cell types.
 * Each cell type appears exactly once in the tree.
 * Children reference their declared parent.
 */
export function buildHierarchy(cells: RegistryCellType[]): HierarchyNode[] {
  // Create nodes for all cell types
  const nodeMap = new Map<string, HierarchyNode>();
  for (const cell of cells) {
    nodeMap.set(cell.type, {
      type: cell.type,
      description: cell.description,
      tools: cell.tools,
      children: [],
    });
  }

  // Build parent-child relationships
  const roots: HierarchyNode[] = [];
  for (const cell of cells) {
    const node = nodeMap.get(cell.type);
    if (!node) continue;
    if (cell.parent && nodeMap.has(cell.parent)) {
      const parentNode = nodeMap.get(cell.parent);
      if (parentNode) parentNode.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/**
 * Counts the total number of unique tools across all cell types.
 * Tools appearing in multiple cell types are counted only once.
 */
export function countUniqueTools(cells: RegistryCellType[]): number {
  const toolSet = new Set<string>();
  for (const cell of cells) {
    for (const tool of cell.tools) {
      toolSet.add(tool);
    }
  }
  return toolSet.size;
}

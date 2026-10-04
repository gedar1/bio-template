import type { CategorizedGroup } from "../types/dashboard";

/**
 * Groups items by their `category` field.
 * Items without a category are grouped under "uncategorized".
 */
export function groupByCategory<T extends { category: string }>(
  items: T[],
): CategorizedGroup<T>[] {
  const map = new Map<string, T[]>();

  for (const item of items) {
    const key = item.category || "uncategorized";
    const group = map.get(key);
    if (group) {
      group.push(item);
    } else {
      map.set(key, [item]);
    }
  }

  return Array.from(map.entries()).map(([category, groupItems]) => ({
    category,
    items: groupItems,
  }));
}

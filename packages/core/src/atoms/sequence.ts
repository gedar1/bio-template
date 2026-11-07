/**
 * Normaliza una secuencia de pasos de herramientas a un string canónico.
 * Se usa como identificador legible de la secuencia y para deduplicación.
 *
 * @param steps - Pasos de ejecución: ["mutate:sensory", "scrape_url", "mutate:memory", "db_insert"]
 * @returns String canónico: "mutate:sensory->scrape_url->mutate:memory->db_insert"
 *
 * @example
 * normalizeSequence(["mutate:sensory", "scrape_url", "mutate:memory", "db_insert"])
 * // => "mutate:sensory->scrape_url->mutate:memory->db_insert"
 */
export function normalizeSequence(steps: string[]): string {
  return steps
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .join("->");
}

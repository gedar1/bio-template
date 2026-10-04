import { z } from "zod";

export const RegistryEntrySchema = z.object({
  type: z.string().min(1),
  description: z.string(),
  tools: z.array(z.string()),
  parent: z.string().optional(),
});

export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;

export interface Registry {
  cells: RegistryEntry[];
}

/**
 * Combina el registry del core con el de un domain package.
 * - Entradas del domain con type duplicado reemplazan las del core.
 * - Entradas inválidas (sin type o type vacío) se descartan silenciosamente.
 * - Si domainRegistry es undefined o vacío, retorna coreRegistry sin cambios.
 */
export function mergeRegistry(
  coreRegistry: Registry,
  domainRegistry?: Registry,
): Registry {
  if (!domainRegistry || domainRegistry.cells.length === 0) {
    return coreRegistry;
  }

  const validDomainEntries = domainRegistry.cells.filter((entry) => {
    const result = RegistryEntrySchema.safeParse(entry);
    return result.success;
  });

  const merged = new Map<string, RegistryEntry>();

  for (const entry of coreRegistry.cells) {
    merged.set(entry.type, entry);
  }

  for (const entry of validDomainEntries) {
    merged.set(entry.type, entry); // Override core si existe
  }

  return { cells: Array.from(merged.values()) };
}

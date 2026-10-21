import { createRequire } from "node:module";
import { z } from "zod";
import { BioCoreError } from "../errors.js";

export const RegistryEntrySchema = z.object({
  type: z.string().min(1),
  description: z.string(),
  tools: z.array(z.string()),
  parent: z.string().optional(),
});

export const RegistrySchema = z.object({
  cells: z.array(RegistryEntrySchema),
});

export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;
export type Registry = z.infer<typeof RegistrySchema>;

export class RegistryConfigurationError extends BioCoreError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "REGISTRY_CONFIGURATION_ERROR", context);
    this.name = "RegistryConfigurationError";
  }
}

function validateRegistry(value: unknown, source: string): Registry {
  const result = RegistrySchema.safeParse(value);
  if (!result.success) {
    throw new RegistryConfigurationError(
      `Registry inválido en ${source}: ${result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(", ")}`,
      { source },
    );
  }
  return result.data;
}

function assertUniqueTypes(registry: Registry, source: string): void {
  const seen = new Set<string>();
  for (const cell of registry.cells) {
    if (seen.has(cell.type)) {
      throw new RegistryConfigurationError(
        `Tipo de célula duplicado en ${source}: ${cell.type}`,
        { source, type: cell.type },
      );
    }
    seen.add(cell.type);
  }
}

/**
 * Combina el registry core con una extensión de dominio validando ambos lados.
 * Las entradas duplicadas y los tipos inválidos fallan al arrancar para evitar
 * que una capacidad anunciada quede distinta de sus handlers MCP.
 */
export function mergeRegistry(
  coreRegistry: unknown,
  domainRegistry?: unknown,
): Registry {
  const core = validateRegistry(coreRegistry, "core registry");
  assertUniqueTypes(core, "core registry");

  if (domainRegistry === undefined) return core;

  const domain = validateRegistry(domainRegistry, "domain registry");
  assertUniqueTypes(domain, "domain registry");

  const coreTypes = new Set(core.cells.map((cell) => cell.type));
  const duplicate = domain.cells.find((cell) => coreTypes.has(cell.type));
  if (duplicate) {
    throw new RegistryConfigurationError(
      `Tipo de célula duplicado entre core y dominio: ${duplicate.type}`,
      { type: duplicate.type },
    );
  }

  return validateRegistry(
    { cells: [...core.cells, ...domain.cells] },
    "registry fusionado",
  );
}

const require = createRequire(import.meta.url);

/** Carga, valida y fusiona los registries configurados para este runtime. */
export function loadApplicationRegistry(): Registry {
  let coreRegistry: unknown;
  let domainRegistry: unknown;

  try {
    coreRegistry = require("./registry.json") as unknown;
    domainRegistry = require("./domain-registry.json") as unknown;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RegistryConfigurationError(
      `No se pudieron cargar los registries configurados: ${message}`,
    );
  }

  return mergeRegistry(coreRegistry, domainRegistry);
}

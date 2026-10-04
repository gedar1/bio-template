import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HealthServer } from "../HealthServer.js";
import type { RegistryConfig } from "../types/dashboard.js";
import { createLogger } from "../../config/logger.js";
import type { Registry } from "../../config/mergeRegistry.js";

const log = createLogger("RegistryRoutes");

/**
 * Rutas de registry: sirve la configuración completa del registry.
 * Si se proporciona un composedRegistry, lo sirve directamente.
 * Si no, lee registry.json del disco como fallback.
 */
export function setupRegistryRoutes(
  health: HealthServer,
  composedRegistry?: Registry,
): void {
  const configDir = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../config",
  );
  const registryPath = join(configDir, "registry.json");

  health.registerData("registry", async () => {
    try {
      let registry: RegistryConfig;

      if (composedRegistry) {
        registry = composedRegistry as unknown as RegistryConfig;
      } else {
        // Fallback: read from disk
        const raw = readFileSync(registryPath, "utf-8");
        registry = JSON.parse(raw) as RegistryConfig;
      }

      // Compute unique tool count
      const allTools = new Set<string>();
      for (const cell of registry.cells) {
        for (const tool of cell.tools) {
          allTools.add(tool);
        }
      }

      return {
        cells: registry.cells,
        totalCellTypes: registry.cells.length,
        uniqueToolCount: allTools.size,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ error: message }, "Error leyendo registry");
      return { error: "Internal error", cells: [] };
    }
  });
}

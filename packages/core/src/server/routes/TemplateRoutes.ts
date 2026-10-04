import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HealthServer } from "../HealthServer.js";
import type { TaskTemplate } from "../types/dashboard.js";
import { createLogger } from "../../config/logger.js";

const log = createLogger("TemplateRoutes");

/**
 * Rutas de templates: sirve el catálogo de Task Templates desde templates.json.
 */
export function setupTemplateRoutes(health: HealthServer): void {
  // Cargar templates al inicio (archivo estático)
  let templates: TaskTemplate[] = [];

  try {
    const configDir = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../config",
    );
    const templatesPath = join(configDir, "templates.json");
    const raw = readFileSync(templatesPath, "utf-8");
    templates = JSON.parse(raw) as TaskTemplate[];

    // Load domain templates from known paths
    const domainTemplatePaths = [
      join(process.cwd(), "packages/restaurant/src/config/templates.json"),
      join(configDir, "../../restaurant/src/config/templates.json"),
    ];

    for (const domainPath of domainTemplatePaths) {
      try {
        const domainRaw = readFileSync(domainPath, "utf-8");
        const domainTemplates = JSON.parse(domainRaw) as TaskTemplate[];
        templates = [...templates, ...domainTemplates];
        log.info(
          { count: domainTemplates.length, path: domainPath },
          "Domain templates cargados",
        );
        break; // Use first found
      } catch {
        // Domain template file not found at this path, try next
      }
    }

    log.info({ count: templates.length }, "Templates cargados correctamente");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ error: message }, "Error cargando templates.json");
  }

  health.registerData("templates", async (body?: Record<string, unknown>) => {
    const category = body?.category as string | undefined;
    const profile = body?.profile as string | undefined;

    let filtered = templates;

    // Filtrar por perfil: mostrar templates sin profile (universales) + los del perfil indicado
    if (profile) {
      filtered = filtered.filter((t) => !t.profile || t.profile === profile);
    }

    // Filtrar por categoría de célula
    if (category) {
      filtered = filtered.filter((t) => t.category === category);
    }

    return { templates: filtered, total: filtered.length };
  });
}

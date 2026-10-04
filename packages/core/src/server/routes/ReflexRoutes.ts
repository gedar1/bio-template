import { HealthServer } from "../HealthServer.js";
import { ReflexMolecule } from "../../molecules/ReflexMolecule.js";
import { PerfMonitor } from "../../infrastructure/PerfMonitor.js";
import { checkRole } from "../middleware/roleMiddleware.js";
import { createLogger } from "../../config/logger.js";

const log = createLogger("ReflexRoutes");

/**
 * Rutas de reflex: lista de reflexes guardados, métricas y control de invalidación.
 */
export function setupReflexRoutes(
  health: HealthServer,
  reflexMolecule: ReflexMolecule,
  perfMonitor: PerfMonitor,
): void {
  health.registerData("reflex", async () => {
    try {
      const reflexes = reflexMolecule.list();
      const metrics = perfMonitor.getReflexMetrics();

      const totalReflexes = reflexes.length;
      const totalQueries = metrics.queryCount || 1;
      const hitRate =
        totalQueries > 0
          ? (metrics.reflexHitCount + metrics.hintCount) / totalQueries
          : 0;
      const missRate = totalQueries > 0 ? metrics.missCount / totalQueries : 0;

      return {
        metrics: {
          totalReflexes,
          hitRate,
          missRate,
          estimatedTokenSavings: metrics.estimatedTokensSaved,
          currentMode:
            hitRate > 0.5 ? "REFLEX" : missRate > 0.7 ? "NORMAL" : "HINT",
        },
        reflexes: reflexes.map((r) => ({
          id: r.id,
          taskSummary: r.taskSummary,
          sequence: r.sequence,
          successCount: r.successCount,
          failureCount: r.failureCount,
          lastUsed: r.lastUsed,
          stepCount: r.steps.length,
          adaptiveThreshold: ReflexMolecule.computeAdaptiveThreshold(
            r.successCount,
            r.failureCount,
          ),
        })),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ error: message }, "Error obteniendo datos de reflex");
      return { error: "Internal error", metrics: null, reflexes: [] };
    }
  });

  health.registerData(
    "reflex/invalidate",
    async (body?: Record<string, unknown>) => {
      const roleError = checkRole("admin");
      if (roleError) return roleError;

      const id = body?.id as number | undefined;
      if (!id || typeof id !== "number") {
        return { error: "id (number) requerido" };
      }

      try {
        const removed = reflexMolecule.remove(id);
        if (!removed) {
          return { error: "Reflex not found", id };
        }
        log.info({ id }, "Reflex invalidado manualmente");
        return { invalidated: true, id };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ error: message, id }, "Error invalidando reflex");
        return { error: "Internal error" };
      }
    },
  );
}

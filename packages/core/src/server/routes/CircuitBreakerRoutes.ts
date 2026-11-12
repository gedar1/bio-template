import { HealthServer } from "../HealthServer.js";
import type { CircuitBreakerSnapshot } from "../TenantManager.js";
import type { CircuitBreakerStatus } from "../types/dashboard.js";

const STATE_PRIORITY: Record<CircuitBreakerStatus["state"], number> = {
  OPEN: 0,
  HALF_OPEN: 1,
  CLOSED: 2,
};

/**
 * Agrupa los breakers de todos los tenants por proveedor. Muestra el peor estado
 * de cada proveedor y suma sus fallos, para que el panel tenga una fila por modelo.
 */
export function toCircuitBreakerStatuses(
  snapshots: readonly CircuitBreakerSnapshot[],
  primaryProvider: string,
): CircuitBreakerStatus[] {
  const byProvider = new Map<string, CircuitBreakerStatus>();
  for (const snapshot of snapshots) {
    const current = byProvider.get(snapshot.provider);
    const lastTransition = snapshot.lastFailureTimestamp ?? 0;
    if (!current) {
      byProvider.set(snapshot.provider, {
        name: snapshot.provider,
        state: snapshot.state,
        failureCount: snapshot.failureCount,
        successCount: 0,
        lastTransition,
        isPrimary: snapshot.provider === primaryProvider,
      });
      continue;
    }
    const worse =
      STATE_PRIORITY[snapshot.state] < STATE_PRIORITY[current.state]
        ? snapshot.state
        : current.state;
    byProvider.set(snapshot.provider, {
      ...current,
      state: worse,
      failureCount: current.failureCount + snapshot.failureCount,
      lastTransition: Math.max(current.lastTransition, lastTransition),
    });
  }
  return [...byProvider.values()];
}

/**
 * Rutas de circuit breaker: estado de los modelos LLM en el tráfico de los tenants.
 * `getStatuses` se evalúa en cada petición, así que refleja el estado actual.
 */
export function setupCircuitBreakerRoutes(
  health: HealthServer,
  getStatuses: () => CircuitBreakerStatus[],
): void {
  health.registerData("circuit-breaker", async () => {
    const statuses = getStatuses();
    if (statuses.length === 0) {
      return {
        warning: "No circuit breakers configured",
        breakers: [],
      };
    }
    return { breakers: statuses };
  });
}

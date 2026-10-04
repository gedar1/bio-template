import { HealthServer } from "../HealthServer.js";
import { CircuitBreaker } from "../../infrastructure/CircuitBreaker.js";
import type { CircuitBreakerStatus } from "../types/dashboard.js";
import { createLogger } from "../../config/logger.js";

const log = createLogger("CircuitBreakerRoutes");

export interface CircuitBreakerRegistry {
  name: string;
  breaker: CircuitBreaker;
  isPrimary: boolean;
}

/**
 * Rutas de circuit breaker: estado de todos los modelos LLM configurados.
 */
export function setupCircuitBreakerRoutes(
  health: HealthServer,
  breakers: CircuitBreakerRegistry[],
): void {
  health.registerData("circuit-breaker", async () => {
    if (breakers.length === 0) {
      return {
        warning: "No circuit breakers configured",
        breakers: [],
      };
    }

    const statuses: CircuitBreakerStatus[] = breakers.map((entry) => ({
      name: entry.name,
      state: entry.breaker.getState(),
      failureCount: entry.breaker.getFailureCount(),
      successCount: 0, // CircuitBreaker resets on success, so we track state
      lastTransition: Date.now(), // Approximation — CB doesn't expose this
      isPrimary: entry.isPrimary,
    }));

    return { breakers: statuses };
  });
}

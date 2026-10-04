import { createLogger } from "../../config/logger.js";
import type { UsageMetricsCollector } from "./UsageMetricsCollector.js";

const log = createLogger("HealthStatusCalculator");

// ─── Types ────────────────────────────────────────────────────────────────────

export type HealthStatus = "healthy" | "degraded" | "inactive";

export interface HealthResult {
  status: HealthStatus;
  error_rate: number;
  last_activity: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Error rate threshold for healthy status (below 5%) */
const HEALTHY_THRESHOLD = 0.05;

/** Error rate threshold for degraded status (5% to 25%) */
const DEGRADED_THRESHOLD = 0.25;

/** Inactivity window in milliseconds (24 hours) */
const INACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Error rate evaluation window in minutes */
const ERROR_RATE_WINDOW_MINUTES = 60;

// ─── HealthStatusCalculator Service ───────────────────────────────────────────

/**
 * HealthStatusCalculator — Calcula el estado de salud de tenants.
 *
 * Lógica de evaluación:
 * 1. Si no hay actividad en las últimas 24 horas → `inactive`
 * 2. Si la tasa de error en los últimos 60 minutos es < 5% → `healthy`
 * 3. Si la tasa de error es ≥ 5% → `degraded`
 *
 * Usa `UsageMetricsCollector.getErrorRate()` para obtener la tasa de error
 * y `UsageMetricsCollector.getTenantMetrics()` para obtener la última actividad.
 */
export class HealthStatusCalculator {
  private readonly metricsCollector: UsageMetricsCollector;

  constructor(metricsCollector: UsageMetricsCollector) {
    this.metricsCollector = metricsCollector;
    log.info("HealthStatusCalculator inicializado");
  }

  /**
   * Calcula el estado de salud de un tenant.
   *
   * @param tenantId - ID del tenant a evaluar
   * @returns HealthResult con status, error_rate y last_activity
   */
  calculate(tenantId: string): HealthResult {
    // Get tenant metrics for last_activity
    const tenantMetrics = this.metricsCollector.getTenantMetrics(tenantId);
    const lastActivity = tenantMetrics.last_activity;

    // Check inactivity first: no activity in last 24 hours → inactive
    if (this.isInactive(lastActivity)) {
      log.debug(
        { tenantId, lastActivity },
        "Tenant inactive — no activity in 24h",
      );
      return {
        status: "inactive",
        error_rate: 0,
        last_activity: lastActivity,
      };
    }

    // Get error rate for last 60 minutes
    const errorRateResult = this.metricsCollector.getErrorRate(
      tenantId,
      ERROR_RATE_WINDOW_MINUTES,
    );

    const status = this.determineStatus(errorRateResult.rate);

    log.debug(
      { tenantId, status, errorRate: errorRateResult.rate, lastActivity },
      "Health status calculated",
    );

    return {
      status,
      error_rate: errorRateResult.rate,
      last_activity: lastActivity,
    };
  }

  /**
   * Calcula el estado de salud para múltiples tenants.
   *
   * @param tenantIds - Array de IDs de tenants a evaluar
   * @returns Map con tenant_id como key y HealthResult como valor
   */
  calculateAll(tenantIds: string[]): Map<string, HealthResult> {
    const results = new Map<string, HealthResult>();

    for (const tenantId of tenantIds) {
      try {
        const result = this.calculate(tenantId);
        results.set(tenantId, result);
      } catch (error) {
        log.warn(
          { tenantId, error },
          "Error calculating health for tenant, defaulting to inactive",
        );
        results.set(tenantId, {
          status: "inactive",
          error_rate: 0,
          last_activity: null,
        });
      }
    }

    return results;
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Determina si un tenant está inactivo basado en su última actividad.
   * Un tenant se considera inactivo si no tiene actividad registrada,
   * o si la última actividad fue hace más de 24 horas.
   */
  private isInactive(lastActivity: string | null): boolean {
    if (!lastActivity) {
      return true;
    }

    const lastActivityTime = new Date(lastActivity).getTime();
    const cutoff = Date.now() - INACTIVITY_WINDOW_MS;

    return lastActivityTime < cutoff;
  }

  /**
   * Determina el status basado en la tasa de error.
   * - rate < 0.05 (5%) → healthy
   * - rate >= 0.05 → degraded
   */
  private determineStatus(rate: number): HealthStatus {
    if (rate < HEALTHY_THRESHOLD) {
      return "healthy";
    }
    return "degraded";
  }
}

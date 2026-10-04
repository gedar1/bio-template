import type Database from "better-sqlite3";
import { createLogger } from "../../config/logger.js";

const log = createLogger("AlertService");

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlertSeverity = "critical" | "warning" | "info";

export type AlertType =
  | "high_error_rate"
  | "token_limit_warning"
  | "health_degraded";

export interface Alert {
  id: string;
  severity: AlertSeverity;
  type: AlertType;
  message: string;
  details: Record<string, unknown>;
  tenant_id: string | null;
  created_at: string;
  acknowledged: boolean;
  acknowledged_at: string | null;
}

export interface AlertEvaluationContext {
  errorRate: { errors: number; total: number; rate: number };
  tokenUsage: number;
  tokenLimit: number;
  healthStatus: "healthy" | "degraded" | "inactive";
}

// ─── Raw DB Row Type ──────────────────────────────────────────────────────────

interface AlertRow {
  id: string;
  severity: string;
  type: string;
  message: string;
  details: string;
  tenant_id: string | null;
  created_at: string;
  acknowledged: number;
  acknowledged_at: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Error rate threshold for critical alert (> 10%) */
const ERROR_RATE_CRITICAL_THRESHOLD = 0.1;

/** Token usage threshold for warning alert (≥ 80% of limit) */
const TOKEN_LIMIT_WARNING_THRESHOLD = 0.8;

/** Error rate evaluation window in minutes for alerts */
const ALERT_ERROR_RATE_WINDOW_MINUTES = 30;

/** Severity ordering for sorting: lower number = higher priority */
const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

// ─── AlertService ─────────────────────────────────────────────────────────────

/**
 * AlertService — Genera, consulta y gestiona alertas de la plataforma.
 *
 * Usa la tabla `platform_alerts` del schema compartido (creada por platformSchema.ts).
 * Evalúa condiciones de alerta por tenant y genera alertas cuando se exceden umbrales:
 * - Error rate > 10% en 30 min → critical
 * - Tenant ≥ 80% token limit → warning
 * - Health transition a degraded → warning
 *
 * Las alertas activas se ordenan por severidad (critical > warning > info) y luego
 * por timestamp (más recientes primero). Alertas reconocidas se excluyen de la lista activa.
 */
export class AlertService {
  private db: InstanceType<typeof Database> | null = null;

  /**
   * Inicializa el servicio con una instancia de base de datos compartida.
   * La tabla `platform_alerts` debe existir previamente (creada por platformSchema.ts).
   */
  initialize(db: InstanceType<typeof Database>): void {
    this.db = db;
    log.info("AlertService inicializado");
  }

  /**
   * Evalúa condiciones de alerta para un tenant y genera nuevas alertas si corresponde.
   *
   * Condiciones evaluadas:
   * 1. Error rate > 10% en últimos 30 min → critical alert
   * 2. Token usage ≥ 80% del token_limit → warning alert
   * 3. Health status = degraded → warning alert
   *
   * @param tenantId - ID del tenant a evaluar
   * @param context - Contexto con datos pre-calculados para la evaluación
   * @returns Array de alertas generadas (puede ser vacío si no se activan condiciones)
   */
  evaluate(tenantId: string, context: AlertEvaluationContext): Alert[] {
    if (!this.db) {
      throw new Error("AlertService not initialized — call initialize() first");
    }

    const generatedAlerts: Alert[] = [];

    // Condition 1: Error rate > 10% in 30-minute window → critical
    if (context.errorRate.rate > ERROR_RATE_CRITICAL_THRESHOLD) {
      const alert = this.createAlert({
        severity: "critical",
        type: "high_error_rate",
        message: `High error rate detected for tenant ${tenantId}: ${(context.errorRate.rate * 100).toFixed(1)}% in the last ${ALERT_ERROR_RATE_WINDOW_MINUTES} minutes`,
        details: {
          error_count: context.errorRate.errors,
          total_requests: context.errorRate.total,
          error_rate_percent: Number((context.errorRate.rate * 100).toFixed(1)),
          window_minutes: ALERT_ERROR_RATE_WINDOW_MINUTES,
        },
        tenant_id: tenantId,
      });
      generatedAlerts.push(alert);
    }

    // Condition 2: Tenant ≥ 80% of token limit → warning
    if (
      context.tokenLimit > 0 &&
      context.tokenUsage >= context.tokenLimit * TOKEN_LIMIT_WARNING_THRESHOLD
    ) {
      const usagePercent = (context.tokenUsage / context.tokenLimit) * 100;
      const alert = this.createAlert({
        severity: "warning",
        type: "token_limit_warning",
        message: `Tenant ${tenantId} has used ${usagePercent.toFixed(1)}% of token limit (${context.tokenUsage}/${context.tokenLimit})`,
        details: {
          current_usage: context.tokenUsage,
          token_limit: context.tokenLimit,
          usage_percent: Number(usagePercent.toFixed(1)),
        },
        tenant_id: tenantId,
      });
      generatedAlerts.push(alert);
    }

    // Condition 3: Health status = degraded → warning
    if (context.healthStatus === "degraded") {
      const alert = this.createAlert({
        severity: "warning",
        type: "health_degraded",
        message: `Tenant ${tenantId} health status is degraded (error rate: ${(context.errorRate.rate * 100).toFixed(1)}%)`,
        details: {
          health_status: context.healthStatus,
          error_rate_percent: Number((context.errorRate.rate * 100).toFixed(1)),
        },
        tenant_id: tenantId,
      });
      generatedAlerts.push(alert);
    }

    if (generatedAlerts.length > 0) {
      log.info(
        { tenantId, alertCount: generatedAlerts.length },
        "Alerts generated for tenant",
      );
    }

    return generatedAlerts;
  }

  /**
   * Obtiene todas las alertas activas (no reconocidas).
   * Ordenadas por severidad (critical > warning > info) y luego por timestamp (newest first).
   *
   * @returns Array de alertas activas ordenadas
   */
  getActive(): Alert[] {
    if (!this.db) {
      throw new Error("AlertService not initialized — call initialize() first");
    }

    const stmt = this.db.prepare(`
      SELECT id, severity, type, message, details, tenant_id, created_at, acknowledged, acknowledged_at
      FROM platform_alerts
      WHERE acknowledged = 0
      ORDER BY created_at DESC
    `);

    const rows = stmt.all() as AlertRow[];
    const alerts = rows.map((row) => this.rowToAlert(row));

    // Sort by severity order (critical first) then by timestamp (newest first)
    alerts.sort((a, b) => {
      const severityDiff =
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (severityDiff !== 0) return severityDiff;
      // Newest first (descending timestamp)
      return b.created_at.localeCompare(a.created_at);
    });

    return alerts;
  }

  /**
   * Reconoce una alerta por su ID, marcándola como acknowledged.
   * Las alertas reconocidas se excluyen de la lista activa.
   *
   * @param alertId - ID de la alerta a reconocer
   * @returns La alerta actualizada, o null si no se encontró
   */
  acknowledge(alertId: string): Alert | null {
    if (!this.db) {
      throw new Error("AlertService not initialized — call initialize() first");
    }

    const acknowledgedAt = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE platform_alerts
      SET acknowledged = 1, acknowledged_at = ?
      WHERE id = ? AND acknowledged = 0
    `);

    const result = stmt.run(acknowledgedAt, alertId);

    if (result.changes === 0) {
      // Either alert doesn't exist or is already acknowledged
      const checkStmt = this.db.prepare(`
        SELECT id, severity, type, message, details, tenant_id, created_at, acknowledged, acknowledged_at
        FROM platform_alerts
        WHERE id = ?
      `);

      const row = checkStmt.get(alertId) as AlertRow | undefined;
      if (!row) {
        log.debug({ alertId }, "Alert not found for acknowledgment");
        return null;
      }

      // Already acknowledged — return current state
      return this.rowToAlert(row);
    }

    // Fetch the updated alert
    const fetchStmt = this.db.prepare(`
      SELECT id, severity, type, message, details, tenant_id, created_at, acknowledged, acknowledged_at
      FROM platform_alerts
      WHERE id = ?
    `);

    const updatedRow = fetchStmt.get(alertId) as AlertRow;
    const alert = this.rowToAlert(updatedRow);

    log.info({ alertId }, "Alert acknowledged");

    return alert;
  }

  /**
   * Obtiene el historial de alertas (incluyendo reconocidas).
   * Ordenadas por created_at DESC (más recientes primero).
   *
   * @param limit - Cantidad máxima de alertas a retornar (default: 100)
   * @returns Array de alertas ordenadas por fecha de creación descendente
   */
  getHistory(limit: number = 100): Alert[] {
    if (!this.db) {
      throw new Error("AlertService not initialized — call initialize() first");
    }

    const stmt = this.db.prepare(`
      SELECT id, severity, type, message, details, tenant_id, created_at, acknowledged, acknowledged_at
      FROM platform_alerts
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as AlertRow[];

    return rows.map((row) => this.rowToAlert(row));
  }

  /**
   * Limpia recursos. Desvincula la referencia a la base de datos.
   */
  dispose(): void {
    this.db = null;
    log.info("AlertService disposed");
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Crea una alerta y la persiste en la base de datos.
   */
  private createAlert(params: {
    severity: AlertSeverity;
    type: AlertType;
    message: string;
    details: Record<string, unknown>;
    tenant_id: string | null;
  }): Alert {
    if (!this.db) {
      throw new Error("AlertService not initialized — call initialize() first");
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const detailsJson = JSON.stringify(params.details);

    const stmt = this.db.prepare(`
      INSERT INTO platform_alerts (id, severity, type, message, details, tenant_id, created_at, acknowledged, acknowledged_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)
    `);

    stmt.run(
      id,
      params.severity,
      params.type,
      params.message,
      detailsJson,
      params.tenant_id,
      createdAt,
    );

    log.debug(
      {
        id,
        severity: params.severity,
        type: params.type,
        tenant_id: params.tenant_id,
      },
      "Alert created",
    );

    return {
      id,
      severity: params.severity,
      type: params.type,
      message: params.message,
      details: params.details,
      tenant_id: params.tenant_id,
      created_at: createdAt,
      acknowledged: false,
      acknowledged_at: null,
    };
  }

  /**
   * Convierte una fila de la base de datos en un objeto Alert.
   */
  private rowToAlert(row: AlertRow): Alert {
    return {
      id: row.id,
      severity: row.severity as AlertSeverity,
      type: row.type as AlertType,
      message: row.message,
      details: JSON.parse(row.details),
      tenant_id: row.tenant_id,
      created_at: row.created_at,
      acknowledged: row.acknowledged === 1,
      acknowledged_at: row.acknowledged_at,
    };
  }
}

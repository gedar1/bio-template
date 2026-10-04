import type Database from "better-sqlite3";
import { createLogger } from "../../config/logger.js";

const log = createLogger("UsageMetricsCollector");

// ─── Types ────────────────────────────────────────────────────────────────────

export type MetricEventType =
  | "tokens"
  | "task_completed"
  | "task_error"
  | "cortex_error";

export interface MetricEvent {
  tenant_id: string;
  event_type: MetricEventType;
  value: number;
  timestamp?: string; // ISO datetime, defaults to now
}

export interface TenantMetrics {
  tenant_id: string;
  total_tokens: number;
  total_tasks: number;
  total_errors: number;
  last_activity: string | null;
}

export interface AggregatedMetrics {
  total_tokens: number;
  total_tasks: number;
  total_errors: number;
  active_tenant_count: number;
  error_rate_percent: number;
  estimated_cost: number;
}

export interface DateRange {
  from: string; // ISO datetime
  to: string; // ISO datetime
}

export interface ErrorRateResult {
  errors: number;
  total: number;
  rate: number;
}

// ─── Raw DB Row Types ─────────────────────────────────────────────────────────

interface MetricRow {
  tenant_id: string;
  event_type: string;
  value: number;
  timestamp: string;
}

interface AggregationRow {
  tenant_id: string;
  event_type: string;
  total_value: number;
}

interface LastActivityRow {
  tenant_id: string;
  last_activity: string;
}

// ─── Default Configuration ────────────────────────────────────────────────────

/** Default cost per token (roughly GPT-4 pricing: $0.000003/token) */
const DEFAULT_COST_PER_TOKEN = 0.000003;

// ─── UsageMetricsCollector Service ────────────────────────────────────────────

/**
 * UsageMetricsCollector — Recolecta y consulta métricas de uso por tenant.
 *
 * Usa la tabla `platform_metrics` del schema compartido (creada por platformSchema.ts).
 * Registra eventos de tokens consumidos, tareas completadas, errores de tareas y errores de cortex.
 * Provee agregaciones cross-tenant con estimación de costos.
 */
export class UsageMetricsCollector {
  private db: InstanceType<typeof Database> | null = null;
  private readonly costPerToken: number;

  constructor(costPerToken?: number) {
    this.costPerToken = costPerToken ?? DEFAULT_COST_PER_TOKEN;
  }

  /**
   * Inicializa el collector con una instancia de base de datos compartida.
   * La tabla `platform_metrics` debe existir previamente (creada por platformSchema.ts).
   */
  initialize(db: InstanceType<typeof Database>): void {
    this.db = db;
    log.info("UsageMetricsCollector inicializado");
  }

  /**
   * Registra un evento de métrica.
   *
   * @param tenantId - ID del tenant
   * @param eventType - Tipo de evento (tokens, task_completed, task_error, cortex_error)
   * @param value - Valor del evento (e.g. cantidad de tokens, 1 para task/error)
   */
  record(tenantId: string, eventType: MetricEventType, value: number): void {
    if (!this.db) {
      throw new Error(
        "UsageMetricsCollector not initialized — call initialize() first",
      );
    }

    const timestamp = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO platform_metrics (tenant_id, event_type, value, timestamp)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(tenantId, eventType, value, timestamp);

    log.debug({ tenantId, eventType, value }, "Metric event recorded");
  }

  /**
   * Obtiene las métricas de un tenant (todos los datos históricos).
   *
   * @param tenantId - ID del tenant
   * @returns TenantMetrics con totales de tokens, tareas, errores y última actividad
   */
  getTenantMetrics(tenantId: string): TenantMetrics {
    if (!this.db) {
      throw new Error(
        "UsageMetricsCollector not initialized — call initialize() first",
      );
    }

    const stmt = this.db.prepare(`
      SELECT event_type, SUM(value) as total_value
      FROM platform_metrics
      WHERE tenant_id = ?
      GROUP BY event_type
    `);

    const rows = stmt.all(tenantId) as Array<{
      event_type: string;
      total_value: number;
    }>;

    const lastActivityStmt = this.db.prepare(`
      SELECT MAX(timestamp) as last_activity
      FROM platform_metrics
      WHERE tenant_id = ?
    `);

    const lastRow = lastActivityStmt.get(tenantId) as
      | {
          last_activity: string | null;
        }
      | undefined;

    return this.buildTenantMetrics(
      tenantId,
      rows,
      lastRow?.last_activity ?? null,
    );
  }

  /**
   * Obtiene métricas de un tenant dentro de un rango de fechas.
   *
   * @param tenantId - ID del tenant
   * @param startDate - Fecha de inicio (ISO datetime)
   * @param endDate - Fecha de fin (ISO datetime)
   * @returns TenantMetrics filtradas al rango especificado
   */
  getTenantMetricsInRange(
    tenantId: string,
    startDate: string,
    endDate: string,
  ): TenantMetrics {
    if (!this.db) {
      throw new Error(
        "UsageMetricsCollector not initialized — call initialize() first",
      );
    }

    const stmt = this.db.prepare(`
      SELECT event_type, SUM(value) as total_value
      FROM platform_metrics
      WHERE tenant_id = ? AND timestamp >= ? AND timestamp <= ?
      GROUP BY event_type
    `);

    const rows = stmt.all(tenantId, startDate, endDate) as Array<{
      event_type: string;
      total_value: number;
    }>;

    const lastActivityStmt = this.db.prepare(`
      SELECT MAX(timestamp) as last_activity
      FROM platform_metrics
      WHERE tenant_id = ? AND timestamp >= ? AND timestamp <= ?
    `);

    const lastRow = lastActivityStmt.get(tenantId, startDate, endDate) as
      | {
          last_activity: string | null;
        }
      | undefined;

    return this.buildTenantMetrics(
      tenantId,
      rows,
      lastRow?.last_activity ?? null,
    );
  }

  /**
   * Obtiene métricas agregadas cross-tenant.
   *
   * Retorna totales de tokens, tareas, errores, cantidad de tenants activos,
   * tasa de error global y estimación de costo.
   */
  getAggregated(): AggregatedMetrics {
    if (!this.db) {
      throw new Error(
        "UsageMetricsCollector not initialized — call initialize() first",
      );
    }

    const stmt = this.db.prepare(`
      SELECT event_type, SUM(value) as total_value
      FROM platform_metrics
      GROUP BY event_type
    `);

    const rows = stmt.all() as Array<{
      event_type: string;
      total_value: number;
    }>;

    // Count distinct active tenants (tenants that have recorded metrics)
    const activeTenantStmt = this.db.prepare(`
      SELECT COUNT(DISTINCT tenant_id) as count
      FROM platform_metrics
    `);

    const activeTenantRow = activeTenantStmt.get() as { count: number };
    const activeTenantCount = activeTenantRow?.count ?? 0;

    return this.buildAggregatedMetrics(rows, activeTenantCount);
  }

  /**
   * Obtiene el breakdown per-tenant ordenado por consumo de tokens (descendente).
   *
   * @returns Array de TenantMetrics ordenado por total_tokens DESC
   */
  getBreakdown(): TenantMetrics[] {
    if (!this.db) {
      throw new Error(
        "UsageMetricsCollector not initialized — call initialize() first",
      );
    }

    // Get aggregated data per tenant per event_type
    const stmt = this.db.prepare(`
      SELECT tenant_id, event_type, SUM(value) as total_value
      FROM platform_metrics
      GROUP BY tenant_id, event_type
    `);

    const rows = stmt.all() as AggregationRow[];

    // Get last activity per tenant
    const lastActivityStmt = this.db.prepare(`
      SELECT tenant_id, MAX(timestamp) as last_activity
      FROM platform_metrics
      GROUP BY tenant_id
    `);

    const lastActivityRows = lastActivityStmt.all() as LastActivityRow[];
    const lastActivityMap = new Map<string, string>();
    for (const row of lastActivityRows) {
      lastActivityMap.set(row.tenant_id, row.last_activity);
    }

    // Group by tenant_id
    const tenantMap = new Map<
      string,
      Array<{ event_type: string; total_value: number }>
    >();

    for (const row of rows) {
      let entries = tenantMap.get(row.tenant_id);
      if (!entries) {
        entries = [];
        tenantMap.set(row.tenant_id, entries);
      }
      entries.push({
        event_type: row.event_type,
        total_value: row.total_value,
      });
    }

    // Build TenantMetrics for each tenant
    const metrics: TenantMetrics[] = [];

    for (const [tenantId, eventRows] of tenantMap) {
      const tenantMetrics = this.buildTenantMetrics(
        tenantId,
        eventRows,
        lastActivityMap.get(tenantId) ?? null,
      );
      metrics.push(tenantMetrics);
    }

    // Sort by token consumption descending
    metrics.sort((a, b) => b.total_tokens - a.total_tokens);

    return metrics;
  }

  /**
   * Calcula la tasa de error de un tenant en los últimos N minutos.
   *
   * @param tenantId - ID del tenant
   * @param windowMinutes - Ventana temporal en minutos (default: 60)
   * @returns Objeto con errores, total de tareas y tasa de error (0-1)
   */
  getErrorRate(tenantId: string, windowMinutes: number = 60): ErrorRateResult {
    if (!this.db) {
      throw new Error(
        "UsageMetricsCollector not initialized — call initialize() first",
      );
    }

    const windowStart = new Date(
      Date.now() - windowMinutes * 60 * 1000,
    ).toISOString();

    // Count errors (task_error + cortex_error)
    const errorsStmt = this.db.prepare(`
      SELECT COALESCE(SUM(value), 0) as total
      FROM platform_metrics
      WHERE tenant_id = ?
        AND event_type IN ('task_error', 'cortex_error')
        AND timestamp >= ?
    `);

    const errorsRow = errorsStmt.get(tenantId, windowStart) as {
      total: number;
    };
    const errors = errorsRow?.total ?? 0;

    // Count total tasks (task_completed + task_error)
    const totalStmt = this.db.prepare(`
      SELECT COALESCE(SUM(value), 0) as total
      FROM platform_metrics
      WHERE tenant_id = ?
        AND event_type IN ('task_completed', 'task_error')
        AND timestamp >= ?
    `);

    const totalRow = totalStmt.get(tenantId, windowStart) as { total: number };
    const total = totalRow?.total ?? 0;

    const rate = total > 0 ? errors / total : 0;

    return { errors, total, rate };
  }

  /**
   * Obtiene el total de tokens consumidos por un tenant en el mes calendario actual.
   *
   * @param tenantId - ID del tenant
   * @returns Total de tokens consumidos en el mes actual
   */
  getCurrentMonthTokens(tenantId: string): number {
    if (!this.db) {
      throw new Error(
        "UsageMetricsCollector not initialized — call initialize() first",
      );
    }

    const now = new Date();
    const firstOfMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
    ).toISOString();

    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(value), 0) as total
      FROM platform_metrics
      WHERE tenant_id = ?
        AND event_type = 'tokens'
        AND timestamp >= ?
    `);

    const row = stmt.get(tenantId, firstOfMonth) as { total: number };

    return row?.total ?? 0;
  }

  /**
   * Limpia recursos. Desvincula la referencia a la base de datos.
   */
  dispose(): void {
    this.db = null;
    log.info("UsageMetricsCollector disposed");
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Construye un TenantMetrics a partir de rows de agregación.
   */
  private buildTenantMetrics(
    tenantId: string,
    rows: Array<{ event_type: string; total_value: number }>,
    lastActivity: string | null,
  ): TenantMetrics {
    let totalTokens = 0;
    let totalTasks = 0;
    let totalErrors = 0;

    for (const row of rows) {
      switch (row.event_type) {
        case "tokens":
          totalTokens += row.total_value;
          break;
        case "task_completed":
          totalTasks += row.total_value;
          break;
        case "task_error":
          totalErrors += row.total_value;
          totalTasks += row.total_value; // errors also count as tasks attempted
          break;
        case "cortex_error":
          totalErrors += row.total_value;
          break;
      }
    }

    return {
      tenant_id: tenantId,
      total_tokens: totalTokens,
      total_tasks: totalTasks,
      total_errors: totalErrors,
      last_activity: lastActivity,
    };
  }

  /**
   * Construye AggregatedMetrics a partir de rows de agregación global.
   */
  private buildAggregatedMetrics(
    rows: Array<{ event_type: string; total_value: number }>,
    activeTenantCount: number,
  ): AggregatedMetrics {
    let totalTokens = 0;
    let totalTasks = 0;
    let totalErrors = 0;

    for (const row of rows) {
      switch (row.event_type) {
        case "tokens":
          totalTokens += row.total_value;
          break;
        case "task_completed":
          totalTasks += row.total_value;
          break;
        case "task_error":
          totalErrors += row.total_value;
          totalTasks += row.total_value;
          break;
        case "cortex_error":
          totalErrors += row.total_value;
          break;
      }
    }

    const errorRatePercent =
      totalTasks > 0 ? (totalErrors / totalTasks) * 100 : 0;
    const estimatedCost = totalTokens * this.costPerToken;

    return {
      total_tokens: totalTokens,
      total_tasks: totalTasks,
      total_errors: totalErrors,
      active_tenant_count: activeTenantCount,
      error_rate_percent: errorRatePercent,
      estimated_cost: estimatedCost,
    };
  }
}

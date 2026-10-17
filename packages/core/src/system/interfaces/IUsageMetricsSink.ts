export type MetricEventType =
  | "tokens"
  | "task_completed"
  | "task_error"
  | "cortex_error";

export interface IUsageMetricsSink {
  record(tenantId: string, event: MetricEventType, value: number): void;
  getCurrentMonthTokens(tenantId: string): number;
}

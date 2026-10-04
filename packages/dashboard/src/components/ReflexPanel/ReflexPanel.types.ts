import type { ReflexMetrics } from "../../types/dashboard";

export interface ReflexPanelProps {
  tenantId: string;
}

export interface ReflexEntry {
  id: number;
  taskSummary: string;
  sequence: string;
  successCount: number;
  failureCount: number;
  lastUsed: number;
  stepCount: number;
  adaptiveThreshold: number;
}

/** Hourly hit/miss bucket for the activity chart */
export interface ReflexActivityBucket {
  hour: string;
  hits: number;
  misses: number;
}

export interface ReflexApiResponse {
  metrics: ReflexMetrics | null;
  reflexes: ReflexEntry[];
  /** Optional time-series data for hits vs misses (last 24h) */
  activity?: ReflexActivityBucket[];
  error?: string;
}

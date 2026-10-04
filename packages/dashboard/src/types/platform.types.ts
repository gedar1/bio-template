/**
 * Consolidated platform, tenant overview and metrics props.
 */
import type { CircuitBreakerStatus, WebSocketServerInfo } from "./dashboard";

// ─── Circuit Breaker Panel ────────────────────────────────────────────────────
export interface CircuitBreakerPanelProps {
  tenantId?: string;
}
export interface CircuitBreakerApiResponse {
  breakers: CircuitBreakerStatus[];
  warning?: string;
}

// ─── WebSocket Panel ──────────────────────────────────────────────────────────
export interface WebSocketPanelProps {
  tenantId: string;
}
export interface WebSocketApiResponse {
  servers: WebSocketServerInfo[];
  error?: string;
}

// ─── Mutation Timeline ────────────────────────────────────────────────────────
export interface MutationTimelineProps {
  tenantId: string;
}
export type TimeRange = "1h" | "24h" | "7d" | "all";
export interface MutationFilterState {
  cellType: string;
  timeRange: TimeRange;
}

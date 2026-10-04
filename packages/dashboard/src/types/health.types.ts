/**
 * Consolidated health, status, activity and perf props.
 */

// ─── Health Panel ─────────────────────────────────────────────────────────────
export interface HealthData {
  status: "ok" | "degraded" | "down";
  uptime: number;
  version?: string;
  services?: Record<string, boolean>;
}
export interface HealthPanelProps {
  tenantId?: string;
}

// ─── Health Info ──────────────────────────────────────────────────────────────
export interface HealthInfoProps {}

// ─── Health Semaphore ─────────────────────────────────────────────────────────
export interface HealthSemaphoreProps {}

// ─── Status Card ──────────────────────────────────────────────────────────────
export interface StatusCardProps {
  title: string;
  value: string | number;
  unit?: string;
  trend?: "up" | "down" | "neutral";
  color?: string;
}

// ─── Status Bar ───────────────────────────────────────────────────────────────
export interface StatusBarProps {
  tenantId: string;
}

// ─── Perf Panel ───────────────────────────────────────────────────────────────
export interface PerfPanelProps {
  tenantId: string;
}
export interface PerfSummary {
  [operation: string]: {
    count: number;
    avgMs: number;
    minMs: number;
    maxMs: number;
  };
}

// ─── Tenant Selector ─────────────────────────────────────────────────────────
export interface TenantsData {
  tenants: Array<{ id: string; idleSeconds: number }>;
  total: number;
}
export interface TenantSelectorProps {
  current: string;
  onChange: (id: string) => void;
  data?: TenantsData;
}

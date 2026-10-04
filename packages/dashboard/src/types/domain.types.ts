/**
 * Consolidated domain widget, scheduler and reflex-activity props.
 * Covers types that are simple/trivial and don't warrant individual files.
 */

// ─── Scheduler Panel ─────────────────────────────────────────────────────────
export interface SchedulerPanelProps {
  tenantId: string;
}
export interface SchedulerTask {
  id: string;
  name: string;
  intervalMs: number;
  enabled: boolean;
  lastRun: number | null;
  nextRun: number;
  runCount: number;
  errors: number;
}
export interface SchedulerData {
  tasks: SchedulerTask[];
  total: number;
}

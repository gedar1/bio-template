import type { LogEntry, LogLevel } from "../../types/dashboard";

export interface LogsPanelProps {
  tenantId?: string;
}

export interface LogFilterState {
  level: LogLevel | "";
  component: string;
}

export type { LogEntry };

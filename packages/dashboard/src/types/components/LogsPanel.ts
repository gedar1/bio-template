import type { LogLevel } from "../dashboard";

export interface LogsPanelProps {
  tenantId?: string;
}

export interface LogFilterState {
  level: LogLevel | "";
  component: string;
}

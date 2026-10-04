import type { LogEntry, LogFilterCriteria } from "../types/dashboard";

/**
 * Filters log entries by severity level and/or component name.
 * Returns only entries matching ALL active filter criteria.
 * The result is always a subset of the original list.
 */
export function filterLogEntries(
  entries: LogEntry[],
  criteria: LogFilterCriteria,
): LogEntry[] {
  return entries.filter((entry) => {
    if (criteria.level && entry.level !== criteria.level) {
      return false;
    }
    if (criteria.component && entry.component !== criteria.component) {
      return false;
    }
    return true;
  });
}

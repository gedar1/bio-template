import type { MutationEvent, MutationFilterCriteria } from "../types/dashboard";

/**
 * Filters mutation events by cell type and/or time range.
 * Returns only events matching ALL active filter criteria.
 * Result is always in chronological order (non-decreasing timestamps).
 */
export function filterMutations(
  events: MutationEvent[],
  criteria: MutationFilterCriteria,
): MutationEvent[] {
  const filtered = events.filter((event) => {
    if (criteria.cellType) {
      if (
        event.fromType !== criteria.cellType &&
        event.toType !== criteria.cellType
      ) {
        return false;
      }
    }
    if (
      criteria.startTime !== undefined &&
      event.timestamp < criteria.startTime
    ) {
      return false;
    }
    if (criteria.endTime !== undefined && event.timestamp > criteria.endTime) {
      return false;
    }
    return true;
  });

  // Ensure chronological order
  return filtered.sort((a, b) => a.timestamp - b.timestamp);
}

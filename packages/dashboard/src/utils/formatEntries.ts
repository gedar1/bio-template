import type { LogEntry, MutationEvent } from "../types/dashboard";

/**
 * Formats a LogEntry to a display string containing all required fields:
 * timestamp, level, component, and message.
 */
export function formatLogEntry(entry: LogEntry): string {
  const time = new Date(entry.timestamp).toISOString();
  return `[${time}] [${entry.level.toUpperCase()}] [${entry.component}] ${entry.message}`;
}

/**
 * Formats a MutationEvent to a display string containing all required fields:
 * timestamp, fromType, toType, stimulusSource, and triggerReason.
 */
export function formatMutationEvent(event: MutationEvent): string {
  const time = new Date(event.timestamp).toISOString();
  return `[${time}] ${event.fromType} → ${event.toType} (source: ${event.stimulusSource}, reason: ${event.triggerReason})`;
}

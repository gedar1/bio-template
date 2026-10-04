import { useState, useEffect, useRef, useCallback } from "react";
import { withApiKeyParam } from "./useApi";

interface UseSSEOptions {
  /** Whether the SSE connection should be active. Set false to pause. */
  enabled?: boolean;
  /** Maximum reconnect delay in ms (default: 30000) */
  maxReconnectDelay?: number;
  /** Initial reconnect delay in ms (default: 1000) */
  initialReconnectDelay?: number;
}

interface UseSSEResult<T> {
  /** Most recent parsed event data */
  lastEvent: T | null;
  /** All accumulated events (up to maxEvents) */
  events: T[];
  /** Whether the connection is currently open */
  connected: boolean;
  /** Current error message, if any */
  error: string | null;
  /** Clear all accumulated events */
  clear: () => void;
}

/**
 * Hook for SSE (Server-Sent Events) stream connections with auto-reconnect
 * and pause/resume support.
 *
 * Requirements: 6.1, 6.7
 *
 * @param endpoint - SSE endpoint URL (e.g., "/api/logs/stream")
 * @param options - Configuration options
 * @param maxEvents - Maximum number of events to keep in memory (default: 500)
 */
export function useSSE<T>(
  endpoint: string,
  options: UseSSEOptions = {},
  maxEvents: number = 500,
): UseSSEResult<T> {
  const {
    enabled = true,
    maxReconnectDelay = 30000,
    initialReconnectDelay = 1000,
  } = options;

  const [lastEvent, setLastEvent] = useState<T | null>(null);
  const [events, setEvents] = useState<T[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectDelayRef = useRef(initialReconnectDelay);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    setEvents([]);
    setLastEvent(null);
  }, []);

  useEffect(() => {
    if (!enabled) {
      // Pause: close connection and clear timers
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      setConnected(false);
      return;
    }

    function connect() {
      const es = new EventSource(withApiKeyParam(endpoint));
      eventSourceRef.current = es;

      es.onopen = () => {
        setConnected(true);
        setError(null);
        // Reset reconnect delay on successful connection
        reconnectDelayRef.current = initialReconnectDelay;
      };

      es.onmessage = (event) => {
        try {
          const parsed: T = JSON.parse(event.data);
          setLastEvent(parsed);
          setEvents((prev) => {
            const updated = [...prev, parsed];
            if (updated.length > maxEvents) {
              return updated.slice(updated.length - maxEvents);
            }
            return updated;
          });
        } catch {
          // Ignore malformed messages
        }
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        eventSourceRef.current = null;

        // Exponential backoff reconnect
        const delay = reconnectDelayRef.current;
        setError(
          `Conexión perdida. Reconectando en ${Math.round(delay / 1000)}s...`,
        );

        reconnectTimerRef.current = setTimeout(() => {
          reconnectDelayRef.current = Math.min(
            reconnectDelayRef.current * 2,
            maxReconnectDelay,
          );
          connect();
        }, delay);
      };
    }

    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [endpoint, enabled, maxEvents, initialReconnectDelay, maxReconnectDelay]);

  return { lastEvent, events, connected, error, clear };
}

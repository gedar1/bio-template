import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Play, Pause, Trash2 } from "lucide-react";
import type { LogEntry, LogLevel } from "../../types/dashboard";
import { filterLogEntries } from "../../utils/filterLogEntries";
import { withApiKeyParam } from "../../hooks/useApi";
import type { LogsPanelProps, LogFilterState } from "./LogsPanel.types";

const MAX_ENTRIES = 500;
const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

/**
 * LogsPanel — connects to /api/logs/stream via SSE, displays entries in
 * real time, supports severity and component filtering, limits display
 * to 500 entries, provides clear control. Pauses stream when not visible.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
 */
export const LogsPanel: React.FC<LogsPanelProps> = () => {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LogFilterState>({
    level: "",
    component: "",
  });
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Connect to SSE stream
  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(withApiKeyParam("/api/logs/stream"));
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnected(true);
      setError(null);
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "initial" && Array.isArray(data.entries)) {
          // Batch of recent entries on first connect
          setEntries((prev) => {
            const updated = [...prev, ...data.entries];
            if (updated.length > MAX_ENTRIES) {
              return updated.slice(updated.length - MAX_ENTRIES);
            }
            return updated;
          });
        } else if (data.type === "entry" && data.entry) {
          // Single new entry
          setEntries((prev) => {
            const updated = [...prev, data.entry as LogEntry];
            if (updated.length > MAX_ENTRIES) {
              return updated.slice(updated.length - MAX_ENTRIES);
            }
            return updated;
          });
        }
      } catch {
        // Ignore malformed messages
      }
    };

    es.onerror = () => {
      setConnected(false);
      setError("Conexión perdida. Reconectando...");
      es.close();
      // Auto-reconnect with delay
      setTimeout(() => {
        if (!paused) {
          connect();
        }
      }, 3000);
    };
  }, [paused]);

  // Manage SSE connection lifecycle (Req 6.7 — pause when not visible)
  useEffect(() => {
    if (paused) {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      setConnected(false);
      return;
    }

    connect();

    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [paused, connect]);

  // Pause stream on visibility change (Req 6.7)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        setPaused(true);
      } else {
        setPaused(false);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScrollRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [entries]);

  // Handle scroll to detect if user scrolled up
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  // Extract unique components for filter dropdown
  const components = useMemo(() => {
    const set = new Set<string>();
    for (const entry of entries) {
      if (entry.component) set.add(entry.component);
    }
    return Array.from(set).sort();
  }, [entries]);

  // Apply filters
  const filteredEntries = useMemo(() => {
    return filterLogEntries(entries, {
      level: filter.level || undefined,
      component: filter.component || undefined,
    });
  }, [entries, filter]);

  const handleClear = () => {
    setEntries([]);
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-gray-300 text-sm font-medium">
            Logs en Tiempo Real
          </h3>
          <ConnectionIndicator connected={connected} paused={paused} />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPaused(!paused)}
            className={`px-2 py-1 rounded text-xs border inline-flex items-center gap-1 ${
              paused
                ? "bg-green-600 text-white border-green-500 hover:bg-green-700"
                : "bg-gray-700 text-gray-300 border-gray-600 hover:bg-gray-600"
            }`}
          >
            {paused ? (
              <>
                <Play size={12} /> Reanudar
              </>
            ) : (
              <>
                <Pause size={12} /> Pausar
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="px-2 py-1 rounded text-xs bg-gray-700 text-gray-300 border border-gray-600 hover:bg-gray-600 inline-flex items-center gap-1"
          >
            <Trash2 size={12} /> Limpiar
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="text-yellow-400 text-xs bg-yellow-900/30 px-3 py-1.5 rounded mb-3">
          {error}
        </div>
      )}

      {/* Filters (Req 6.2, 6.3) */}
      <div className="flex items-center gap-3 mb-3">
        <select
          value={filter.level}
          onChange={(e) =>
            setFilter((f) => ({ ...f, level: e.target.value as LogLevel | "" }))
          }
          className="bg-gray-900 text-white rounded px-2 py-1 text-xs border border-gray-600 focus:border-blue-500 focus:outline-none"
          aria-label="Filtrar por severidad"
        >
          <option value="">Todos los niveles</option>
          {LEVELS.map((level) => (
            <option key={level} value={level}>
              {level.toUpperCase()}
            </option>
          ))}
        </select>

        <select
          value={filter.component}
          onChange={(e) =>
            setFilter((f) => ({ ...f, component: e.target.value }))
          }
          className="bg-gray-900 text-white rounded px-2 py-1 text-xs border border-gray-600 focus:border-blue-500 focus:outline-none"
          aria-label="Filtrar por componente"
        >
          <option value="">Todos los componentes</option>
          {components.map((comp) => (
            <option key={comp} value={comp}>
              {comp}
            </option>
          ))}
        </select>

        <span className="text-gray-500 text-xs ml-auto">
          {filteredEntries.length} / {entries.length} entradas
        </span>
      </div>

      {/* Log entries (Req 6.4, 6.5) */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="bg-gray-900 rounded-lg border border-gray-700 p-2 font-mono text-xs max-h-96 overflow-y-auto"
      >
        {filteredEntries.length === 0 ? (
          <div className="text-gray-500 text-center py-8">
            {entries.length === 0
              ? "Esperando logs..."
              : "Sin resultados para los filtros seleccionados."}
          </div>
        ) : (
          filteredEntries.map((entry, i) => (
            <LogRow key={`${entry.timestamp}-${i}`} entry={entry} />
          ))
        )}
      </div>
    </div>
  );
};

// ─── Sub-Components ─────────────────────────────────────────────────────────

function ConnectionIndicator({
  connected,
  paused,
}: Readonly<{ connected: boolean; paused: boolean }>) {
  if (paused) {
    return (
      <span className="flex items-center gap-1 text-xs text-yellow-400">
        <span>●</span> pausado
      </span>
    );
  }
  if (connected) {
    return (
      <span className="flex items-center gap-1 text-xs text-green-400">
        <span className="animate-pulse">●</span> conectado
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-red-400">
      <span>●</span> desconectado
    </span>
  );
}

function LogRow({ entry }: Readonly<{ entry: LogEntry }>) {
  const levelColors: Record<string, string> = {
    debug: "text-gray-500",
    info: "text-blue-400",
    warn: "text-yellow-400",
    error: "text-red-400",
  };

  const time = new Date(entry.timestamp).toLocaleTimeString();
  const levelColor = levelColors[entry.level] ?? "text-gray-400";

  return (
    <div className="flex gap-2 py-0.5 hover:bg-gray-800/50 rounded px-1">
      <span className="text-gray-600 shrink-0">{time}</span>
      <span className={`shrink-0 w-12 uppercase font-medium ${levelColor}`}>
        {entry.level}
      </span>
      <span className="text-purple-400 shrink-0 max-w-32 truncate">
        {entry.component}
      </span>
      <span className="text-gray-300 break-all">{entry.message}</span>
    </div>
  );
}

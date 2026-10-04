import { useState, useEffect, useRef } from "react";
import { AlertTriangle, RefreshCw, CheckCircle } from "lucide-react";
import { useApi } from "../../hooks/useApi";
import { Tooltip } from "../Tooltip";
import type { CircuitBreakerStatus } from "../../types/dashboard";
import type {
  CircuitBreakerPanelProps,
  CircuitBreakerApiResponse,
} from "./CircuitBreakerPanel.types";

/**
 * CircuitBreakerPanel — displays state (CLOSED/OPEN/HALF_OPEN) for each
 * configured LLM model, failure/success counts, last transition,
 * primary/fallback indicators, and visual alerts on state changes.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */
export const CircuitBreakerPanel: React.FC<CircuitBreakerPanelProps> = () => {
  const { data, loading, error } = useApi<CircuitBreakerApiResponse>(
    "/api/circuit-breaker",
    5000,
  );

  const [alerts, setAlerts] = useState<
    { icon: "warning" | "refresh" | "check"; text: string }[]
  >([]);
  const prevStatesRef = useRef<Map<string, string>>(new Map());

  const breakers = data?.breakers ?? [];

  // Detect state changes and generate alerts (Req 5.3)
  useEffect(() => {
    if (breakers.length === 0) return;

    const newAlerts: { icon: "warning" | "refresh" | "check"; text: string }[] =
      [];
    const prevStates = prevStatesRef.current;

    for (const breaker of breakers) {
      const prevState = prevStates.get(breaker.name);
      if (prevState && prevState !== breaker.state) {
        if (breaker.state === "OPEN") {
          newAlerts.push({
            icon: "warning",
            text: `${breaker.name} cambió a OPEN — modelo no disponible`,
          });
        } else if (breaker.state === "HALF_OPEN") {
          newAlerts.push({
            icon: "refresh",
            text: `${breaker.name} cambió a HALF_OPEN — probando recuperación`,
          });
        } else if (breaker.state === "CLOSED") {
          newAlerts.push({
            icon: "check",
            text: `${breaker.name} recuperado — estado CLOSED`,
          });
        }
      }
      prevStates.set(breaker.name, breaker.state);
    }

    if (newAlerts.length > 0) {
      setAlerts((prev) => [...newAlerts, ...prev].slice(0, 5));
    }
  }, [breakers]);

  if (loading) {
    return <div className="text-gray-400">Cargando circuit breakers...</div>;
  }

  if (error) {
    return <div className="text-red-400">Error: {error}</div>;
  }

  if (data?.warning) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <h3 className="text-gray-300 text-sm font-medium mb-2">
          Circuit Breaker
        </h3>
        <div className="text-gray-500 text-sm text-center py-4">
          {data.warning}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <h3 className="text-gray-300 text-sm font-medium mb-3">
        Circuit Breaker — Modelos LLM
      </h3>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="mb-3 space-y-1">
          {alerts.map((alert, i) => (
            <div
              key={`${alert.text}-${i}`}
              className="text-xs bg-yellow-900/30 border border-yellow-700/50 rounded px-3 py-1.5 text-yellow-300 flex items-center gap-1.5"
            >
              {alert.icon === "warning" && (
                <AlertTriangle size={12} className="text-yellow-400 shrink-0" />
              )}
              {alert.icon === "refresh" && (
                <RefreshCw size={12} className="text-yellow-400 shrink-0" />
              )}
              {alert.icon === "check" && (
                <CheckCircle size={12} className="text-green-400 shrink-0" />
              )}
              {alert.text}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setAlerts([])}
            className="text-gray-500 text-xs hover:text-gray-300"
          >
            Limpiar alertas
          </button>
        </div>
      )}

      {/* Breaker cards */}
      <div className="space-y-3">
        {breakers.length === 0 ? (
          <div className="text-gray-500 text-sm text-center py-4">
            No hay circuit breakers configurados.
          </div>
        ) : (
          breakers.map((breaker) => (
            <BreakerCard key={breaker.name} breaker={breaker} />
          ))
        )}
      </div>
    </div>
  );
};

// ─── Sub-Components ─────────────────────────────────────────────────────────

function BreakerCard({ breaker }: Readonly<{ breaker: CircuitBreakerStatus }>) {
  const stateConfig: Record<
    string,
    { color: string; bgColor: string; label: string; description: string }
  > = {
    CLOSED: {
      color: "text-green-400",
      bgColor: "bg-green-600",
      label: "CLOSED",
      description: "Operando normalmente",
    },
    OPEN: {
      color: "text-red-400",
      bgColor: "bg-red-600",
      label: "OPEN",
      description: "Modelo no disponible, usando fallback",
    },
    HALF_OPEN: {
      color: "text-yellow-400",
      bgColor: "bg-yellow-600",
      label: "HALF_OPEN",
      description: "Probando recuperación",
    },
  };

  const config = stateConfig[breaker.state] ?? stateConfig.CLOSED;
  const lastTransitionStr = breaker.lastTransition
    ? formatTimeAgo(breaker.lastTransition)
    : "—";

  return (
    <div
      className={`bg-gray-900 rounded-lg p-3 border ${
        breaker.state === "OPEN"
          ? "border-red-700/50"
          : breaker.state === "HALF_OPEN"
            ? "border-yellow-700/50"
            : "border-gray-700"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-gray-200 text-sm font-medium">
            {breaker.name}
          </span>
          {breaker.isPrimary ? (
            <span className="px-1.5 py-0.5 rounded text-xs bg-blue-600 text-white">
              primario
            </span>
          ) : (
            <span className="px-1.5 py-0.5 rounded text-xs bg-gray-600 text-gray-300">
              fallback
            </span>
          )}
        </div>
        <Tooltip text={config.description} position="left">
          <span
            className={`px-2 py-0.5 rounded text-xs font-medium text-white ${config.bgColor}`}
          >
            {config.label}
          </span>
        </Tooltip>
      </div>

      <div className="flex items-center gap-4 text-xs">
        <div>
          <span className="text-gray-500">Fallos:</span>{" "}
          <span className="text-red-400">{breaker.failureCount}</span>
        </div>
        <div>
          <span className="text-gray-500">Éxitos:</span>{" "}
          <span className="text-green-400">{breaker.successCount}</span>
        </div>
        <div>
          <span className="text-gray-500">Última transición:</span>{" "}
          <span className="text-gray-300">{lastTransitionStr}</span>
        </div>
      </div>

      {/* HALF_OPEN indicator (Req 5.5) */}
      {breaker.state === "HALF_OPEN" && (
        <div className="mt-2 text-xs text-yellow-400 flex items-center gap-1">
          <span className="animate-pulse">●</span>
          Probando recuperación del modelo...
        </div>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;

  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}

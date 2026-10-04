import { useState, useCallback } from "react";
import { AlertTriangle, Info, CheckCircle, RefreshCw } from "lucide-react";
import { usePlatformApi, platformFetch } from "./usePlatformApi";

/**
 * Alert from GET /api/platform/alerts
 */
interface Alert {
  id: string;
  severity: "critical" | "warning" | "info";
  type: "high_error_rate" | "token_limit_warning" | "health_degraded";
  message: string;
  details: Record<string, unknown>;
  tenant_id: string | null;
  created_at: string;
  acknowledged: boolean;
  acknowledged_at: string | null;
}

/**
 * AlertsPanel — Displays active alerts sorted by severity (critical first),
 * with an acknowledge button per alert.
 *
 * Requirements: 11.4, 11.5
 */
export function AlertsPanel() {
  const {
    data: alerts,
    error,
    loading,
    refetch,
  } = usePlatformApi<Alert[]>("alerts", 30000);

  const [acknowledging, setAcknowledging] = useState<Set<string>>(new Set());

  const handleAcknowledge = useCallback(
    async (alertId: string) => {
      setAcknowledging((prev) => new Set(prev).add(alertId));

      try {
        const { error: ackError } = await platformFetch(
          `alerts/${alertId}/acknowledge`,
          { method: "POST" },
        );

        if (!ackError) {
          // Refresh list after successful acknowledge
          refetch();
        }
      } catch {
        // Silently fail, user can retry
      } finally {
        setAcknowledging((prev) => {
          const next = new Set(prev);
          next.delete(alertId);
          return next;
        });
      }
    },
    [refetch],
  );

  if (loading) {
    return <div className="text-gray-400">Cargando alertas...</div>;
  }

  if (error) {
    return <div className="text-red-400">Error: {error}</div>;
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-gray-300 text-sm font-medium">Alertas Activas</h3>
        <button
          type="button"
          onClick={refetch}
          className="text-gray-400 hover:text-gray-200 transition-colors"
          aria-label="Refresh alerts"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Empty state */}
      {!alerts || alerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-gray-500">
          <CheckCircle size={24} className="mb-2 text-green-500/50" />
          <span className="text-sm">No active alerts</span>
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              isAcknowledging={acknowledging.has(alert.id)}
              onAcknowledge={handleAcknowledge}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sub-Components ─────────────────────────────────────────────────────────

interface AlertCardProps {
  alert: Alert;
  isAcknowledging: boolean;
  onAcknowledge: (id: string) => void;
}

function AlertCard({
  alert,
  isAcknowledging,
  onAcknowledge,
}: Readonly<AlertCardProps>) {
  return (
    <div
      className={`rounded-lg p-3 border ${getSeverityBorder(alert.severity)} ${getSeverityBg(alert.severity)}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <SeverityIcon severity={alert.severity} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <SeverityBadge severity={alert.severity} />
              <span className="text-gray-300 text-xs font-medium">
                {formatAlertType(alert.type)}
              </span>
            </div>
            <p className="text-gray-200 text-sm mt-1 wrap-break-word">
              {alert.message}
            </p>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
              {alert.tenant_id && (
                <span>
                  Tenant:{" "}
                  <span className="text-gray-300">{alert.tenant_id}</span>
                </span>
              )}
              <span>{formatDateTime(alert.created_at)}</span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onAcknowledge(alert.id)}
          disabled={isAcknowledging}
          className="shrink-0 px-2.5 py-1 text-xs rounded bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label={`Acknowledge alert: ${alert.message}`}
        >
          {isAcknowledging ? "..." : "Acknowledge"}
        </button>
      </div>
    </div>
  );
}

function SeverityIcon({ severity }: Readonly<{ severity: Alert["severity"] }>) {
  switch (severity) {
    case "critical":
      return (
        <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
      );
    case "warning":
      return (
        <AlertTriangle size={16} className="text-yellow-400 shrink-0 mt-0.5" />
      );
    case "info":
      return <Info size={16} className="text-blue-400 shrink-0 mt-0.5" />;
  }
}

function SeverityBadge({
  severity,
}: Readonly<{ severity: Alert["severity"] }>) {
  const config = {
    critical: "bg-red-600 text-white",
    warning: "bg-yellow-600 text-white",
    info: "bg-blue-600 text-white",
  };

  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${config[severity]}`}
    >
      {severity}
    </span>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getSeverityBorder(severity: Alert["severity"]): string {
  switch (severity) {
    case "critical":
      return "border-red-700/50";
    case "warning":
      return "border-yellow-700/50";
    case "info":
      return "border-blue-700/50";
  }
}

function getSeverityBg(severity: Alert["severity"]): string {
  switch (severity) {
    case "critical":
      return "bg-red-900/20";
    case "warning":
      return "bg-yellow-900/20";
    case "info":
      return "bg-blue-900/20";
  }
}

function formatAlertType(type: Alert["type"]): string {
  switch (type) {
    case "high_error_rate":
      return "High Error Rate";
    case "token_limit_warning":
      return "Token Limit Warning";
    case "health_degraded":
      return "Health Degraded";
  }
}

function formatDateTime(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    return date.toLocaleString("es-CO", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoDate;
  }
}

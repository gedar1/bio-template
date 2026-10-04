import { useState, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Trash2, X } from "lucide-react";
import { useApi } from "../../hooks/useApi";
import { useRole } from "../../context/RoleContext";
import { RoleGuard } from "../RoleGuard";
import { Tooltip } from "../Tooltip";
import type {
  ReflexPanelProps,
  ReflexApiResponse,
  ReflexEntry,
  ReflexActivityBucket,
} from "./ReflexPanel.types";

/**
 * ReflexPanel — displays current Reflex_Mode, aggregate metrics,
 * list of saved reflexes with details, and invalidation control.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
 */
export const ReflexPanel: React.FC<ReflexPanelProps> = ({ tenantId }) => {
  const { data, loading, error, refetch } = useApi<ReflexApiResponse>(
    `/api/reflex?tenantId=${tenantId}`,
    5000,
  );
  const { role } = useRole();

  const [selectedReflex, setSelectedReflex] = useState<ReflexEntry | null>(
    null,
  );
  const [invalidating, setInvalidating] = useState<number | null>(null);
  const [invalidateError, setInvalidateError] = useState<string | null>(null);

  const metrics = data?.metrics ?? null;
  const reflexes = data?.reflexes ?? [];

  // Build activity chart data from backend or derive from reflex entries
  const activityData = useMemo<ReflexActivityBucket[]>(() => {
    if (data?.activity && data.activity.length > 0) {
      return data.activity;
    }
    // Derive approximate activity from reflex entries (last 24h buckets)
    return deriveActivityFromReflexes(reflexes);
  }, [data?.activity, reflexes]);

  // Sort reflexes by lastUsed descending (most recent first)
  const sortedReflexes = useMemo(
    () => [...reflexes].sort((a, b) => b.lastUsed - a.lastUsed),
    [reflexes],
  );

  const handleInvalidate = async (id: number) => {
    setInvalidating(id);
    setInvalidateError(null);

    try {
      const res = await fetch("/api/reflex/invalidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await res.json();

      if (!res.ok || json.error) {
        setInvalidateError(json.error ?? `Error ${res.status}`);
      } else {
        setSelectedReflex(null);
        refetch();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setInvalidateError(message);
    } finally {
      setInvalidating(null);
    }
  };

  if (loading) {
    return <div className="text-gray-400">Cargando memoria refleja...</div>;
  }

  if (error) {
    return <div className="text-red-400">Error: {error}</div>;
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      {/* Header with Reflex Mode */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-gray-300 text-sm font-medium">Memoria Refleja</h3>
        {metrics && <ModeBadge mode={metrics.currentMode} />}
      </div>

      {/* Aggregate Metrics */}
      {metrics && <MetricsGrid metrics={metrics} />}

      {/* Hits vs Misses Activity Chart (Req 3.5) */}
      {activityData.length > 0 && <ActivityChart data={activityData} />}

      {/* Invalidation error */}
      {invalidateError && (
        <div className="text-red-400 text-xs bg-red-900/30 px-3 py-2 rounded mb-3">
          {invalidateError}
        </div>
      )}

      {/* Selected reflex detail */}
      {selectedReflex && (
        <ReflexDetail
          reflex={selectedReflex}
          canInvalidate={role === "admin" || role === "super_admin"}
          invalidating={invalidating === selectedReflex.id}
          onInvalidate={() => handleInvalidate(selectedReflex.id)}
          onClose={() => setSelectedReflex(null)}
        />
      )}

      {/* Reflex list */}
      <div className="mt-4">
        <div className="text-gray-400 text-xs font-medium mb-2">
          Reflexes guardados ({reflexes.length})
        </div>
        <div className="space-y-1 max-h-72 overflow-y-auto">
          {sortedReflexes.length === 0 ? (
            <div className="text-gray-500 text-sm text-center py-4">
              Sin reflexes guardados. Interactúa con el Cortex para generar
              memoria procedural.
            </div>
          ) : (
            sortedReflexes.map((reflex) => (
              <ReflexRow
                key={reflex.id}
                reflex={reflex}
                isSelected={selectedReflex?.id === reflex.id}
                onSelect={() =>
                  setSelectedReflex(
                    selectedReflex?.id === reflex.id ? null : reflex,
                  )
                }
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Sub-Components ─────────────────────────────────────────────────────────

function ModeBadge({ mode }: Readonly<{ mode: string }>) {
  const modeConfig: Record<
    string,
    { color: string; label: string; description: string }
  > = {
    REFLEX: {
      color: "bg-green-600",
      label: "REFLEX",
      description: "Ejecución directa, 0 tokens",
    },
    HINT: {
      color: "bg-yellow-600",
      label: "HINT",
      description: "Contexto inyectado al LLM",
    },
    NORMAL: {
      color: "bg-blue-600",
      label: "NORMAL",
      description: "LLM completo",
    },
  };

  const config = modeConfig[mode] ?? modeConfig.NORMAL;

  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium text-white ${config.color}`}
      title={config.description}
    >
      {config.label}
    </span>
  );
}

interface MetricsGridProps {
  metrics: NonNullable<ReflexApiResponse["metrics"]>;
}

function MetricsGrid({ metrics }: Readonly<MetricsGridProps>) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <MetricCard
        label="Total Reflexes"
        value={String(metrics.totalReflexes)}
        tooltip="Número total de secuencias aprendidas en memoria procedural"
      />
      <MetricCard
        label="Hit Rate"
        value={`${(metrics.hitRate * 100).toFixed(1)}%`}
        color={metrics.hitRate > 0.5 ? "text-green-400" : "text-gray-300"}
        tooltip="Porcentaje de consultas resueltas directamente por reflex sin usar LLM"
      />
      <MetricCard
        label="Miss Rate"
        value={`${(metrics.missRate * 100).toFixed(1)}%`}
        color={metrics.missRate > 0.7 ? "text-red-400" : "text-gray-300"}
        tooltip="Porcentaje de consultas que no encontraron un reflex similar y requirieron LLM completo"
      />
      <MetricCard
        label="Tokens Ahorrados"
        value={formatTokenSavings(metrics.estimatedTokenSavings)}
        color="text-emerald-400"
        tooltip="Tokens LLM que no se consumieron gracias a ejecuciones vía reflex"
      />
    </div>
  );
}

interface MetricCardProps {
  label: string;
  value: string;
  color?: string;
  tooltip?: string;
}

function MetricCard({
  label,
  value,
  color = "text-gray-300",
  tooltip,
}: Readonly<MetricCardProps>) {
  return (
    <Tooltip text={tooltip ?? label} position="top">
      <div className="bg-gray-900 rounded-lg p-3 border border-gray-700 cursor-default">
        <div className="text-gray-500 text-xs mb-1">{label}</div>
        <div className={`text-lg font-semibold ${color}`}>{value}</div>
      </div>
    </Tooltip>
  );
}

interface ReflexRowProps {
  reflex: ReflexEntry;
  isSelected: boolean;
  onSelect: () => void;
}

function ReflexRow({ reflex, isSelected, onSelect }: Readonly<ReflexRowProps>) {
  const timeAgo = formatTimeAgo(reflex.lastUsed);
  const thresholdPercent = (reflex.adaptiveThreshold * 100).toFixed(0);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`bg-gray-900 w-full text-left flex items-center gap-2 text-sm p-2 rounded transition-colors ${
        isSelected
          ? "bg-blue-900/30 border border-blue-700"
          : "hover:bg-gray-700/50 border border-transparent"
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="text-gray-200 truncate text-xs font-medium">
          {reflex.taskSummary}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-green-400 text-xs">
            ✓ {reflex.successCount}
          </span>
          {reflex.failureCount > 0 && (
            <span className="text-red-400 text-xs">
              ✗ {reflex.failureCount}
            </span>
          )}
          <span className="text-gray-500 text-xs">
            {reflex.stepCount} pasos
          </span>
          <span className="text-gray-500 text-xs" title="Adaptive threshold">
            θ {thresholdPercent}%
          </span>
        </div>
      </div>
      <div className="text-gray-500 text-xs shrink-0">{timeAgo}</div>
    </button>
  );
}

interface ReflexDetailProps {
  reflex: ReflexEntry;
  canInvalidate: boolean;
  invalidating: boolean;
  onInvalidate: () => void;
  onClose: () => void;
}

function ReflexDetail({
  reflex,
  canInvalidate,
  invalidating,
  onInvalidate,
  onClose,
}: Readonly<ReflexDetailProps>) {
  return (
    <div className="bg-gray-900 rounded-lg p-3 border border-gray-700 mb-3">
      <div className="flex items-start justify-between mb-2">
        <div className="text-gray-200 text-sm font-medium">
          {reflex.taskSummary}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-500 hover:text-gray-300 text-xs"
        >
          <X size={14} />
        </button>
      </div>

      <div className="space-y-2 text-xs">
        <div>
          <span className="text-gray-500">Secuencia:</span>{" "}
          <span className="text-gray-300 font-mono">{reflex.sequence}</span>
        </div>
        <div className="flex gap-4">
          <div>
            <span className="text-gray-500">Éxitos:</span>{" "}
            <span className="text-green-400">{reflex.successCount}</span>
          </div>
          <div>
            <span className="text-gray-500">Fallos:</span>{" "}
            <span className="text-red-400">{reflex.failureCount}</span>
          </div>
          <div>
            <span className="text-gray-500">Pasos:</span>{" "}
            <span className="text-gray-300">{reflex.stepCount}</span>
          </div>
        </div>
        <div>
          <span className="text-gray-500">Threshold adaptivo:</span>{" "}
          <span className="text-gray-300">
            {(reflex.adaptiveThreshold * 100).toFixed(1)}%
          </span>
        </div>
        <div>
          <span className="text-gray-500">Último uso:</span>{" "}
          <span className="text-gray-300">
            {new Date(reflex.lastUsed).toLocaleString()}
          </span>
        </div>
      </div>

      {/* Invalidation control */}
      <RoleGuard action="invalidate-reflex">
        {canInvalidate && (
          <div className="mt-3 pt-2 border-t border-gray-700">
            <Tooltip
              text="Elimina este reflex de la memoria procedural"
              position="top"
            >
              <button
                type="button"
                onClick={onInvalidate}
                disabled={invalidating}
                className="bg-red-600 text-white px-3 py-1 rounded text-xs hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-1"
              >
                {invalidating ? (
                  "Invalidando..."
                ) : (
                  <>
                    <Trash2 size={12} /> Invalidar Reflex
                  </>
                )}
              </button>
            </Tooltip>
          </div>
        )}
      </RoleGuard>
    </div>
  );
}

interface ActivityChartProps {
  data: ReflexActivityBucket[];
}

function ActivityChart({ data }: Readonly<ActivityChartProps>) {
  return (
    <div className="mb-4">
      <div className="text-gray-400 text-xs font-medium mb-2">
        Hits vs Misses (últimas 24h)
      </div>
      <div className="bg-gray-900 rounded-lg p-3 border border-gray-700">
        <ResponsiveContainer width="100%" height={120}>
          <BarChart
            data={data}
            margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
          >
            <XAxis
              dataKey="hour"
              tick={{ fill: "#6b7280", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              interval={5}
            />
            <YAxis
              tick={{ fill: "#6b7280", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <RechartsTooltip
              contentStyle={{
                backgroundColor: "#1f2937",
                border: "1px solid #374151",
                borderRadius: "6px",
                fontSize: "12px",
              }}
              labelStyle={{ color: "#9ca3af" }}
            />
            <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "4px" }} />
            <Bar
              dataKey="hits"
              name="Hits"
              fill="#34d399"
              radius={[2, 2, 0, 0]}
            />
            <Bar
              dataKey="misses"
              name="Misses"
              fill="#f87171"
              radius={[2, 2, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Derives approximate hourly activity buckets from reflex entries.
 * Groups reflexes by the hour of their lastUsed timestamp (last 24h).
 * Hits = successCount for reflexes used in that hour, Misses = failureCount.
 */
function deriveActivityFromReflexes(
  reflexes: ReflexEntry[],
): ReflexActivityBucket[] {
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  // Initialize 24 hourly buckets
  const buckets: ReflexActivityBucket[] = [];
  for (let i = 23; i >= 0; i--) {
    const bucketTime = new Date(now - i * 60 * 60 * 1000);
    buckets.push({
      hour: `${bucketTime.getHours().toString().padStart(2, "0")}:00`,
      hits: 0,
      misses: 0,
    });
  }

  // Place reflexes into their respective hour bucket based on lastUsed
  for (const reflex of reflexes) {
    if (reflex.lastUsed < oneDayAgo) continue;

    const hoursAgo = Math.floor((now - reflex.lastUsed) / (60 * 60 * 1000));
    const bucketIndex = 23 - hoursAgo;
    if (bucketIndex >= 0 && bucketIndex < 24) {
      buckets[bucketIndex].hits += reflex.successCount;
      buckets[bucketIndex].misses += reflex.failureCount;
    }
  }

  return buckets;
}

function formatTokenSavings(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return String(tokens);
}

function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  return `${Math.floor(days / 7)}sem`;
}

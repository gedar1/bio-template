import { useState } from "react";
import { RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { usePlatformApi } from "./usePlatformApi";

/**
 * Aggregated metrics response from GET /api/platform/metrics
 */
interface AggregatedMetrics {
  total_tokens: number;
  total_tasks: number;
  total_errors: number;
  active_tenant_count: number;
  error_rate_percent: number;
  estimated_cost: number;
}

/**
 * Per-tenant breakdown entry
 */
interface TenantMetrics {
  tenant_id: string;
  total_tokens: number;
  total_tasks: number;
  total_errors: number;
  last_activity: string | null;
}

/**
 * MetricsPanel — Displays aggregated platform metrics:
 * total tokens, tasks, errors, active tenants, error rate, estimated cost.
 * Optionally shows per-tenant breakdown table.
 *
 * Requirements: 10.1, 10.2, 10.4
 */
export function MetricsPanel() {
  const [showBreakdown, setShowBreakdown] = useState(false);

  const {
    data: metrics,
    error,
    loading,
    refetch,
  } = usePlatformApi<AggregatedMetrics>("metrics", 30000);

  const { data: breakdown, loading: breakdownLoading } = usePlatformApi<
    TenantMetrics[]
  >("metrics?breakdown=true", showBreakdown ? 30000 : undefined);

  if (loading) {
    return <div className="text-gray-400">Cargando métricas...</div>;
  }

  if (error) {
    return <div className="text-red-400">Error: {error}</div>;
  }

  if (!metrics) return null;

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-gray-300 text-sm font-medium">
          Métricas de Plataforma
        </h3>
        <button
          type="button"
          onClick={refetch}
          className="text-gray-400 hover:text-gray-200 transition-colors"
          aria-label="Refresh metrics"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <MetricCard
          title="Total Tokens"
          value={formatNumber(metrics.total_tokens)}
        />
        <MetricCard
          title="Total Tareas"
          value={formatNumber(metrics.total_tasks)}
        />
        <MetricCard
          title="Total Errores"
          value={formatNumber(metrics.total_errors)}
          variant={metrics.total_errors > 0 ? "warning" : "default"}
        />
        <MetricCard
          title="Tenants Activos"
          value={String(metrics.active_tenant_count)}
        />
        <MetricCard
          title="Error Rate"
          value={`${metrics.error_rate_percent.toFixed(1)}%`}
          variant={getErrorRateVariant(metrics.error_rate_percent)}
        />
        <MetricCard
          title="Costo Estimado"
          value={`$${metrics.estimated_cost.toFixed(4)}`}
        />
      </div>

      {/* Breakdown Toggle */}
      <button
        type="button"
        onClick={() => setShowBreakdown(!showBreakdown)}
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 transition-colors"
      >
        {showBreakdown ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {showBreakdown ? "Ocultar desglose" : "Ver desglose por tenant"}
      </button>

      {/* Per-tenant breakdown table */}
      {showBreakdown && (
        <div className="mt-3 overflow-x-auto">
          <BreakdownContent loading={breakdownLoading} breakdown={breakdown} />
        </div>
      )}
    </div>
  );
}

// ─── Sub-Components ─────────────────────────────────────────────────────────

interface BreakdownContentProps {
  loading: boolean;
  breakdown: TenantMetrics[] | null;
}

function BreakdownContent({
  loading: isLoading,
  breakdown,
}: Readonly<BreakdownContentProps>) {
  if (isLoading) {
    return <div className="text-gray-400 text-xs">Cargando desglose...</div>;
  }

  if (!breakdown || breakdown.length === 0) {
    return (
      <div className="text-gray-500 text-xs">No hay datos de desglose.</div>
    );
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-gray-400 border-b border-gray-700">
          <th className="text-left py-2 pr-3">Tenant</th>
          <th className="text-right py-2 px-3">Tokens</th>
          <th className="text-right py-2 px-3">Tareas</th>
          <th className="text-right py-2 px-3">Errores</th>
          <th className="text-right py-2 pl-3">Última Actividad</th>
        </tr>
      </thead>
      <tbody>
        {breakdown.map((tenant) => (
          <tr
            key={tenant.tenant_id}
            className="border-b border-gray-700/50 hover:bg-gray-700/30"
          >
            <td className="py-2 pr-3 text-gray-200">{tenant.tenant_id}</td>
            <td className="text-right py-2 px-3 text-gray-300">
              {formatNumber(tenant.total_tokens)}
            </td>
            <td className="text-right py-2 px-3 text-gray-300">
              {formatNumber(tenant.total_tasks)}
            </td>
            <td className="text-right py-2 px-3 text-gray-300">
              {formatNumber(tenant.total_errors)}
            </td>
            <td className="text-right py-2 pl-3 text-gray-400">
              {tenant.last_activity ? formatTimeAgo(tenant.last_activity) : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface MetricCardProps {
  title: string;
  value: string;
  variant?: "default" | "warning" | "danger";
}

function MetricCard({
  title,
  value,
  variant = "default",
}: Readonly<MetricCardProps>) {
  const getValueColor = () => {
    if (variant === "danger") return "text-red-400";
    if (variant === "warning") return "text-yellow-400";
    return "text-white";
  };

  const valueColor = getValueColor();

  return (
    <div className="bg-gray-900 rounded-lg p-3 border border-gray-700">
      <span className="text-gray-400 text-xs">{title}</span>
      <div className={`text-lg font-semibold mt-1 ${valueColor}`}>{value}</div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getErrorRateVariant(rate: number): "default" | "warning" | "danger" {
  if (rate > 10) return "danger";
  if (rate > 5) return "warning";
  return "default";
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatTimeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;

  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}

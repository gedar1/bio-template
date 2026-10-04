import { useState } from "react";
import { usePlatformApi, platformFetch } from "./usePlatformApi";

// ─── Types ──────────────────────────────────────────────────────────────────

type TenantStatus = "active" | "inactive" | "degraded";
type TenantProfile = "dev" | "restaurant" | "clinic" | "ecommerce";
type HealthStatus = "healthy" | "degraded" | "inactive";

interface TenantRecord {
  tenant_id: string;
  display_name: string;
  profile: TenantProfile;
  status: TenantStatus;
  created_at: string;
  updated_at: string;
  token_limit: number;
  last_activity: string | null;
  health?: HealthStatus;
}

interface TenantMetrics {
  tenant_id: string;
  total_tokens: number;
  total_tasks: number;
  total_errors: number;
  last_activity: string | null;
}

interface TenantDetailProps {
  tenantId: string;
  onBack: () => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const PROFILES: TenantProfile[] = ["dev", "restaurant", "clinic", "ecommerce"];

const STATUS_COLORS: Record<TenantStatus, string> = {
  active: "bg-green-500/20 text-green-400 border-green-500/30",
  inactive: "bg-red-500/20 text-red-400 border-red-500/30",
  degraded: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
};

const HEALTH_COLORS: Record<HealthStatus, string> = {
  healthy: "bg-green-500/20 text-green-400 border-green-500/30",
  degraded: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  inactive: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

function getProgressColor(percent: number): string {
  if (percent >= 80) return "bg-red-500";
  if (percent >= 50) return "bg-yellow-500";
  return "bg-green-500";
}

// ─── Main Component ─────────────────────────────────────────────────────────

/**
 * TenantDetail — Detail view for a specific tenant showing metrics,
 * health, limits, and management actions.
 *
 * Requirements: 12.5
 */
export function TenantDetail({
  tenantId,
  onBack,
}: Readonly<TenantDetailProps>) {
  const {
    data: tenant,
    error: tenantError,
    loading: tenantLoading,
    refetch: refetchTenant,
  } = usePlatformApi<TenantRecord>(`tenants/${tenantId}`);

  const {
    data: metrics,
    error: metricsError,
    loading: metricsLoading,
  } = usePlatformApi<TenantMetrics>(`metrics/${tenantId}`, 30000);

  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Profile change state
  const [showProfileSelect, setShowProfileSelect] = useState(false);

  // Limits edit state
  const [showLimitsEdit, setShowLimitsEdit] = useState(false);
  const [newLimit, setNewLimit] = useState("");

  // ─── Action Handlers ────────────────────────────────────────────────────

  async function handleDeactivate() {
    setActionLoading(true);
    setActionError(null);
    setActionSuccess(null);

    const { error } = await platformFetch(
      `/api/platform/tenants/${tenantId}/deactivate`,
      { method: "POST" },
    );

    setActionLoading(false);
    if (error) {
      setActionError(error);
    } else {
      setActionSuccess("Tenant deactivated");
      refetchTenant();
    }
  }

  async function handleReactivate() {
    setActionLoading(true);
    setActionError(null);
    setActionSuccess(null);

    const { error } = await platformFetch(
      `/api/platform/tenants/${tenantId}/reactivate`,
      { method: "POST" },
    );

    setActionLoading(false);
    if (error) {
      setActionError(error);
    } else {
      setActionSuccess("Tenant reactivated");
      refetchTenant();
    }
  }

  async function handleProfileChange(profile: TenantProfile) {
    setActionLoading(true);
    setActionError(null);
    setActionSuccess(null);
    setShowProfileSelect(false);

    const { error } = await platformFetch(
      `/api/platform/tenants/${tenantId}/profile`,
      { method: "PUT", body: JSON.stringify({ profile }) },
    );

    setActionLoading(false);
    if (error) {
      setActionError(error);
    } else {
      setActionSuccess(`Profile changed to ${profile}`);
      refetchTenant();
    }
  }

  async function handleLimitChange() {
    const limit = Number.parseInt(newLimit, 10);
    if (Number.isNaN(limit) || limit < 0) {
      setActionError("Token limit must be a non-negative integer");
      return;
    }

    setActionLoading(true);
    setActionError(null);
    setActionSuccess(null);
    setShowLimitsEdit(false);

    const { error } = await platformFetch(
      `/api/platform/tenants/${tenantId}/limits`,
      { method: "PUT", body: JSON.stringify({ token_limit: limit }) },
    );

    setActionLoading(false);
    if (error) {
      setActionError(error);
    } else {
      setActionSuccess(
        `Token limit updated to ${limit === 0 ? "unlimited" : limit.toLocaleString()}`,
      );
      setNewLimit("");
      refetchTenant();
    }
  }

  // ─── Loading / Error States ─────────────────────────────────────────────

  if (tenantLoading) {
    return <div className="text-gray-400 p-4">Cargando detalle...</div>;
  }

  if (tenantError) {
    return (
      <div className="p-4">
        <button
          type="button"
          onClick={onBack}
          className="text-blue-400 hover:text-blue-300 text-sm mb-4"
        >
          ← Volver a la lista
        </button>
        <div className="text-red-400">Error: {tenantError}</div>
      </div>
    );
  }

  if (!tenant) return null;

  const health: HealthStatus = tenant.health ?? "inactive";
  const tokenUsage = metrics?.total_tokens ?? 0;
  const tokenLimitDisplay =
    tenant.token_limit === 0
      ? "Unlimited"
      : tenant.token_limit.toLocaleString();
  const tokenPercent =
    tenant.token_limit > 0
      ? Math.min(100, Math.round((tokenUsage / tenant.token_limit) * 100))
      : 0;

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Back button + Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="text-blue-400 hover:text-blue-300 text-sm"
        >
          ← Volver
        </button>
        <h3 className="text-gray-200 font-medium">{tenant.display_name}</h3>
        <span className="text-gray-500 text-xs font-mono">
          {tenant.tenant_id}
        </span>
      </div>

      {/* Action feedback */}
      {actionError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded px-3 py-2 text-red-400 text-sm">
          {actionError}
        </div>
      )}
      {actionSuccess && (
        <div className="bg-green-500/10 border border-green-500/30 rounded px-3 py-2 text-green-400 text-sm">
          {actionSuccess}
        </div>
      )}

      {/* Info Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Status */}
        <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
          <div className="text-gray-400 text-xs mb-1">Estado</div>
          <span
            className={`px-2 py-0.5 rounded text-xs font-medium border ${STATUS_COLORS[tenant.status]}`}
          >
            {tenant.status}
          </span>
        </div>

        {/* Health */}
        <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
          <div className="text-gray-400 text-xs mb-1">Health</div>
          <span
            className={`px-2 py-0.5 rounded text-xs font-medium border ${HEALTH_COLORS[health]}`}
          >
            {health}
          </span>
        </div>

        {/* Profile */}
        <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
          <div className="text-gray-400 text-xs mb-1">Perfil</div>
          <span className="text-gray-200 text-sm font-mono">
            {tenant.profile}
          </span>
        </div>

        {/* Token Limit */}
        <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
          <div className="text-gray-400 text-xs mb-1">Token Limit</div>
          <span className="text-gray-200 text-sm">{tokenLimitDisplay}</span>
        </div>
      </div>

      {/* Metrics Section */}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <h4 className="text-gray-300 text-sm font-medium mb-3">
          Métricas (mes actual)
        </h4>
        {metricsLoading ? (
          <div className="text-gray-500 text-sm">Cargando métricas...</div>
        ) : metricsError ? (
          <div className="text-red-400 text-sm">Error: {metricsError}</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard
              label="Tokens consumidos"
              value={tokenUsage.toLocaleString()}
            />
            <MetricCard
              label="Tareas ejecutadas"
              value={(metrics?.total_tasks ?? 0).toLocaleString()}
            />
            <MetricCard
              label="Errores"
              value={(metrics?.total_errors ?? 0).toLocaleString()}
              highlight={
                (metrics?.total_errors ?? 0) > 0 ? "warning" : undefined
              }
            />
            <MetricCard
              label="Uso de límite"
              value={tenant.token_limit === 0 ? "N/A" : `${tokenPercent}%`}
              highlight={tokenPercent >= 80 ? "warning" : undefined}
            />
          </div>
        )}

        {/* Token usage progress bar */}
        {tenant.token_limit > 0 && (
          <div className="mt-3">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>{tokenUsage.toLocaleString()} tokens</span>
              <span>{tenant.token_limit.toLocaleString()} limit</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${getProgressColor(tokenPercent)}`}
                style={{ width: `${tokenPercent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Actions Section */}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <h4 className="text-gray-300 text-sm font-medium mb-3">Acciones</h4>
        <div className="flex flex-wrap gap-2">
          {/* Deactivate / Reactivate */}
          {tenant.status === "active" ? (
            <button
              type="button"
              onClick={handleDeactivate}
              disabled={actionLoading}
              className="px-3 py-1.5 bg-red-600/20 border border-red-500/30 text-red-400 rounded text-xs font-medium hover:bg-red-600/30 disabled:opacity-50 transition-colors"
            >
              Deactivate
            </button>
          ) : (
            <button
              type="button"
              onClick={handleReactivate}
              disabled={actionLoading}
              className="px-3 py-1.5 bg-green-600/20 border border-green-500/30 text-green-400 rounded text-xs font-medium hover:bg-green-600/30 disabled:opacity-50 transition-colors"
            >
              Reactivate
            </button>
          )}

          {/* Change Profile */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowProfileSelect(!showProfileSelect)}
              disabled={actionLoading}
              className="px-3 py-1.5 bg-blue-600/20 border border-blue-500/30 text-blue-400 rounded text-xs font-medium hover:bg-blue-600/30 disabled:opacity-50 transition-colors"
            >
              Change Profile
            </button>
            {showProfileSelect && (
              <div className="absolute top-full left-0 mt-1 bg-gray-900 border border-gray-700 rounded shadow-lg z-10">
                {PROFILES.filter((p) => p !== tenant.profile).map((profile) => (
                  <button
                    key={profile}
                    type="button"
                    onClick={() => handleProfileChange(profile)}
                    className="block w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-700 font-mono"
                  >
                    {profile}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Edit Limits */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowLimitsEdit(!showLimitsEdit);
                setNewLimit(String(tenant.token_limit));
              }}
              disabled={actionLoading}
              className="px-3 py-1.5 bg-purple-600/20 border border-purple-500/30 text-purple-400 rounded text-xs font-medium hover:bg-purple-600/30 disabled:opacity-50 transition-colors"
            >
              Edit Limits
            </button>
            {showLimitsEdit && (
              <div className="absolute top-full left-0 mt-1 bg-gray-900 border border-gray-700 rounded shadow-lg z-10 p-3">
                <label
                  htmlFor={`limit-input-${tenantId}`}
                  className="text-gray-400 text-xs block mb-1"
                >
                  Token limit (0 = unlimited)
                </label>
                <div className="flex gap-2">
                  <input
                    id={`limit-input-${tenantId}`}
                    type="number"
                    min="0"
                    value={newLimit}
                    onChange={(e) => setNewLimit(e.target.value)}
                    className="w-32 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-xs text-gray-200 focus:outline-none focus:border-purple-500"
                  />
                  <button
                    type="button"
                    onClick={handleLimitChange}
                    className="px-2 py-1 bg-purple-600 text-white rounded text-xs hover:bg-purple-500"
                  >
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-Components ─────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  highlight,
}: Readonly<{
  label: string;
  value: string;
  highlight?: "warning";
}>) {
  return (
    <div className="bg-gray-900 rounded p-2 border border-gray-700">
      <div className="text-gray-500 text-xs mb-1">{label}</div>
      <div
        className={`text-sm font-medium ${
          highlight === "warning" ? "text-yellow-400" : "text-gray-200"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

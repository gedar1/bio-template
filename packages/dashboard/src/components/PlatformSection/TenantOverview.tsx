import { useState } from "react";
import { usePlatformApi } from "./usePlatformApi";
import { TenantDetail } from "./TenantDetail";

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

// ─── Badge Components ───────────────────────────────────────────────────────

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

function StatusBadge({ status }: Readonly<{ status: TenantStatus }>) {
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium border ${STATUS_COLORS[status]}`}
    >
      {status}
    </span>
  );
}

function HealthBadge({ health }: Readonly<{ health: HealthStatus }>) {
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium border ${HEALTH_COLORS[health]}`}
    >
      {health}
    </span>
  );
}

// ─── Date Formatting ────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("es", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatRelative(iso: string | null): string {
  if (!iso) return "Sin actividad";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Hace un momento";
  if (mins < 60) return `Hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Hace ${days}d`;
}

// ─── Main Component ─────────────────────────────────────────────────────────

/**
 * TenantOverview — Table displaying all tenants with status, health, and activity.
 * Clicking a row opens TenantDetail.
 *
 * Requirements: 12.4
 */
export function TenantOverview() {
  const { data, error, loading, refetch } = usePlatformApi<TenantRecord[]>(
    "tenants",
    15000,
  );

  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);

  if (loading) {
    return <div className="text-gray-400 p-4">Cargando tenants...</div>;
  }

  if (error) {
    return <div className="text-red-400 p-4">Error: {error}</div>;
  }

  const tenants = data ?? [];

  // If a tenant is selected, show detail view
  if (selectedTenantId) {
    return (
      <TenantDetail
        tenantId={selectedTenantId}
        onBack={() => {
          setSelectedTenantId(null);
          refetch();
        }}
      />
    );
  }

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <h3 className="text-gray-200 text-sm font-medium">Tenant Overview</h3>
        <span className="text-gray-500 text-xs">
          {tenants.length} tenant{tenants.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      {tenants.length === 0 ? (
        <div className="text-gray-500 text-sm text-center py-12">
          No hay tenants registrados.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-xs uppercase">
                <th className="text-left px-4 py-3 font-medium">Nombre</th>
                <th className="text-left px-4 py-3 font-medium">Perfil</th>
                <th className="text-left px-4 py-3 font-medium">Estado</th>
                <th className="text-left px-4 py-3 font-medium">Health</th>
                <th className="text-left px-4 py-3 font-medium">Creado</th>
                <th className="text-left px-4 py-3 font-medium">
                  Última Actividad
                </th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr
                  key={tenant.tenant_id}
                  onClick={() => setSelectedTenantId(tenant.tenant_id)}
                  className="border-b border-gray-700/50 hover:bg-gray-700/30 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="text-gray-200 font-medium">
                      {tenant.display_name}
                    </div>
                    <div className="text-gray-500 text-xs font-mono">
                      {tenant.tenant_id}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-gray-300 text-xs font-mono bg-gray-900 px-2 py-0.5 rounded">
                      {tenant.profile}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={tenant.status} />
                  </td>
                  <td className="px-4 py-3">
                    <HealthBadge health={tenant.health ?? "inactive"} />
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {formatDate(tenant.created_at)}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {formatRelative(tenant.last_activity)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

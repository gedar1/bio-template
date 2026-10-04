import { useState } from "react";
import { useRole } from "../../context/RoleContext";
import { hasMinimumRole } from "../../utils/roleFilter";
import { PlatformAuthGate } from "./PlatformAuthGate";
import { TenantOverview } from "./TenantOverview";
import { MetricsPanel } from "./MetricsPanel";
import { AlertsPanel } from "./AlertsPanel";
import { TenantCreateForm } from "./TenantCreateForm";

/**
 * Sub-navigation tabs for the Platform section.
 */
type PlatformTab = "tenants" | "metrics" | "alerts" | "create-tenant";

interface TabDefinition {
  id: PlatformTab;
  label: string;
}

const TABS: TabDefinition[] = [
  { id: "tenants", label: "Tenants" },
  { id: "metrics", label: "Metrics" },
  { id: "alerts", label: "Alerts" },
  { id: "create-tenant", label: "Create Tenant" },
];

/**
 * PlatformSection — Main section wrapper for Platform Super Admin features.
 * Only renders for users with the `super_admin` role.
 * Wraps content in PlatformAuthGate (handles JWT login).
 * Provides sub-navigation: Tenants, Metrics, Alerts, Create Tenant.
 *
 * Requirements: 1.2, 1.3, 12.1, 12.2, 12.3
 */
export function PlatformSection() {
  const { role } = useRole();
  const [activeTab, setActiveTab] = useState<PlatformTab>("tenants");

  // Role gate: only super_admin can access this section
  if (!hasMinimumRole(role, "super_admin")) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="text-center">
          <p className="text-gray-400 text-sm">
            Access denied. This section requires super_admin privileges.
          </p>
        </div>
      </div>
    );
  }

  return (
    <PlatformAuthGate>
      <div className="space-y-4">
        {/* Sub-navigation tabs */}
        <nav
          className="flex gap-1 border-b border-gray-700 pb-0"
          aria-label="Platform sub-navigation"
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium rounded-t transition-colors border-b-2 ${
                activeTab === tab.id
                  ? "text-emerald-400 border-emerald-400 bg-gray-800/50"
                  : "text-gray-400 border-transparent hover:text-gray-200 hover:border-gray-500"
              }`}
              aria-current={activeTab === tab.id ? "page" : undefined}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Tab content */}
        <div>{renderTab(activeTab)}</div>
      </div>
    </PlatformAuthGate>
  );
}

function renderTab(tab: PlatformTab) {
  switch (tab) {
    case "tenants":
      return <TenantOverview />;
    case "metrics":
      return <MetricsPanel />;
    case "alerts":
      return <AlertsPanel />;
    case "create-tenant":
      return <TenantCreateForm />;
  }
}

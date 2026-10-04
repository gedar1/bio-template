import { useState } from "react";
import { Settings, Brain, Wrench, RefreshCw, ShieldAlert } from "lucide-react";
import { RoleGuard } from "../RoleGuard";
import { useSettings } from "../../hooks/useSettings";
import { GeneralTab } from "./GeneralTab";
import { LLMTab } from "./LLMTab";
import { ToolsTemplatesTab } from "./ToolsTemplatesTab";
import type { SettingsTab } from "./SettingsPanel.types";

const TABS: { id: SettingsTab; label: string; icon: typeof Settings }[] = [
  { id: "general", label: "General", icon: Settings },
  { id: "llm", label: "LLM", icon: Brain },
  { id: "tools", label: "Tools/Templates", icon: Wrench },
];

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-gray-400">
      <ShieldAlert size={48} className="mb-4 text-red-400" />
      <p className="text-lg font-medium text-gray-200">Acceso denegado</p>
      <p className="text-sm mt-1">
        Se requiere rol de administrador para acceder a esta sección.
      </p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 bg-gray-700 rounded w-1/3" />
      <div className="h-4 bg-gray-700 rounded w-2/3" />
      <div className="h-4 bg-gray-700 rounded w-1/2" />
      <div className="h-32 bg-gray-700 rounded" />
      <div className="h-4 bg-gray-700 rounded w-3/4" />
      <div className="h-4 bg-gray-700 rounded w-1/4" />
    </div>
  );
}

function SettingsPanelContent() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const { settings, loading, error, refetch, updateSettings } = useSettings();

  if (loading) {
    return (
      <div className="p-6">
        <LoadingSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-64 text-gray-400">
        <p className="text-red-400 font-medium mb-2">
          Error al cargar configuración
        </p>
        <p className="text-sm mb-4">{error}</p>
        <button
          onClick={refetch}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded transition-colors"
        >
          <RefreshCw size={16} />
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Tab Navigation */}
      <div className="flex border-b border-gray-700 mb-4">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-b-2 border-emerald-500 text-emerald-400"
                  : "text-gray-400 hover:text-gray-200"
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content (placeholders for tasks 7.1, 7.2) */}
      <div className="mt-4">
        {activeTab === "general" && settings && (
          <GeneralTab settings={settings} updateSettings={updateSettings} />
        )}
        {activeTab === "llm" && settings && (
          <LLMTab settings={settings} updateSettings={updateSettings} />
        )}
        {activeTab === "tools" && settings && (
          <ToolsTemplatesTab
            settings={settings}
            updateSettings={updateSettings}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Admin-only Settings Panel with tab navigation.
 * Wraps content in RoleGuard to enforce admin access.
 *
 * Requirements: 7.1, 10.1, 10.3, 10.4
 */
export function SettingsPanel() {
  return (
    <RoleGuard minRole="admin" fallback={<AccessDenied />}>
      <SettingsPanelContent />
    </RoleGuard>
  );
}

import { useState, useEffect, useRef, useCallback } from "react";
import { Dna, LogOut } from "lucide-react";
import type {
  SectionId,
  NotificationBadge,
  CircuitBreakerStatus,
  MutationEvent,
} from "../../types/dashboard";
import { useRole } from "../../context/RoleContext";
import { useTenantAuth } from "../../context/TenantAuthContext";
import { SectionNav, getPersistedSection } from "../SectionNav";
import { StatusBar } from "../StatusBar";
import { TenantSelector } from "../TenantSelector";
import { HealthSemaphore } from "../HealthSemaphore";
import { HealthInfo } from "../HealthInfo";
import { RoleBadge } from "../RoleBadge";
import { ResizableChat } from "../ResizableChat";
import { OverviewSection } from "../sections/OverviewSection";
import { OperationsSection } from "../sections/OperationsSection";
import { SystemSection } from "../sections/SystemSection";
import { SettingsPanel } from "../SettingsPanel";
import { PlatformSection } from "../PlatformSection";
import { computeBadges, type BadgeEvent } from "../../utils/computeBadges";
import { IS_STUDIO_MODE, DEFAULT_TENANT_ID } from "../../utils/deploymentMode";
import { BRAND_NAME } from "../../utils/brand";
import { useApi } from "../../hooks/useApi";
import { subscribeLogStream } from "../../hooks/logStream";

export const DashboardLayout: React.FC = () => {
  const { role } = useRole();
  const {
    isAuthenticated: isTenantAuth,
    displayName: tenantDisplayName,
    profile: tenantProfile,
    logout: tenantLogout,
  } = useTenantAuth();
  const [tenantId, setTenantId] = useState(DEFAULT_TENANT_ID);
  const [activeSection, setActiveSection] =
    useState<SectionId>(getPersistedSection);
  const [badgeEvents, setBadgeEvents] = useState<BadgeEvent[]>([]);
  const prevCircuitBreakerRef = useRef<CircuitBreakerStatus[] | null>(null);

  const showChat =
    role === "platform_owner" || role === "tenant_owner" || role === "operator";

  const handleSectionChange = useCallback((section: SectionId) => {
    setActiveSection(section);
    setBadgeEvents((prev) => prev.filter((e) => e.sectionId !== section));
  }, []);

  // Badge de errores: se suscribe una vez a la conexión compartida de logs.
  // En la sección técnica no genera badge, porque LogsPanel ya muestra los errores.
  const activeSectionRef = useRef(activeSection);
  activeSectionRef.current = activeSection;

  useEffect(() => {
    return subscribeLogStream((data) => {
      if (activeSectionRef.current === "system") return;
      if (data.type === "entry" && data.entry?.level === "error") {
        setBadgeEvents((prev) => [
          ...prev,
          { sectionId: "system", type: "error" },
        ]);
      }
    });
  }, []);

  // Circuit breaker: se lee con la caché compartida. Un cambio de estado genera badge.
  const circuitEndpoint =
    activeSection === "system" ? null : "/api/circuit-breaker";
  const { data: circuitData } = useApi<
    CircuitBreakerStatus[] | { breakers?: CircuitBreakerStatus[] }
  >(circuitEndpoint, 10000);

  useEffect(() => {
    if (!circuitData) return;
    const breakers: CircuitBreakerStatus[] = Array.isArray(circuitData)
      ? circuitData
      : (circuitData.breakers ?? []);

    if (prevCircuitBreakerRef.current) {
      for (const breaker of breakers) {
        const prev = prevCircuitBreakerRef.current.find(
          (b) => b.name === breaker.name,
        );
        if (prev && prev.state !== breaker.state) {
          setBadgeEvents((events) => [
            ...events,
            {
              sectionId: "system",
              type: breaker.state === "OPEN" ? "error" : "warning",
            },
          ]);
        }
      }
    }
    prevCircuitBreakerRef.current = breakers;
  }, [circuitData]);

  // Mutaciones: se leen con la caché compartida. Una mutación nueva genera badge.
  const lastMutationIdRef = useRef<number>(0);
  const mutationsEndpoint =
    activeSection === "system" ? null : `/api/mutations?tenantId=${tenantId}`;
  const { data: mutationsData } = useApi<{ mutations?: MutationEvent[] }>(
    mutationsEndpoint,
    10000,
  );

  useEffect(() => {
    if (!mutationsData) return;
    const mutations: MutationEvent[] = mutationsData.mutations ?? [];
    if (mutations.length === 0) return;

    const maxId = Math.max(...mutations.map((m) => m.id));
    if (lastMutationIdRef.current > 0 && maxId > lastMutationIdRef.current) {
      const newCount = mutations.filter(
        (m) => m.id > lastMutationIdRef.current,
      ).length;
      for (let i = 0; i < newCount; i++) {
        setBadgeEvents((events) => [
          ...events,
          { sectionId: "system", type: "info" },
        ]);
      }
    }
    lastMutationIdRef.current = maxId;
  }, [mutationsData]);

  const badges: NotificationBadge[] = computeBadges(badgeEvents, activeSection);

  const renderSection = () => {
    switch (activeSection) {
      case "overview":
        return <OverviewSection />;
      case "operations":
        return <OperationsSection tenantId={tenantId} />;
      case "system":
        return <SystemSection tenantId={tenantId} />;
      case "settings":
        return <SettingsPanel />;
      case "platform":
        return <PlatformSection />;
      default:
        return <OverviewSection />;
    }
  };

  return (
    <div
      id="dashboard-root"
      className="h-screen bg-gray-900 text-white flex flex-col overflow-hidden"
    >
      {/* Header — health status always visible */}
      <header
        id="dashboard-header"
        className="border-b border-gray-800 px-4 py-1.5 shrink-0 bg-gray-950"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Dna size={20} className="text-emerald-400" />
            <h1 className="text-sm font-semibold text-gray-200">
              {BRAND_NAME}
            </h1>
            <HealthSemaphore />
            <HealthInfo />
          </div>
          <div className="flex items-center gap-3">
            <RoleBadge />
            {isTenantAuth && tenantDisplayName && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">
                  {tenantDisplayName} · {tenantProfile}
                </span>
                <button
                  onClick={tenantLogout}
                  className="p-1 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
                  title="Logout"
                  aria-label="Tenant logout"
                >
                  <LogOut size={14} />
                </button>
              </div>
            )}
            {/* En modo single hay un solo negocio: no hay selector ni llamada a /api/tenants */}
            {IS_STUDIO_MODE && (
              <TenantSelector current={tenantId} onChange={setTenantId} />
            )}
          </div>
        </div>
      </header>

      {/* Main content area — IDE layout */}
      <div id="dashboard-body" className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar: navigation only */}
        <div
          id="dashboard-sidebar"
          className="flex flex-col border-r border-gray-800 shrink-0 w-16"
        >
          <SectionNav
            activeSection={activeSection}
            onChange={handleSectionChange}
            badges={badges}
          />
        </div>

        {/* Main panel (scrollable) */}
        <main
          id="dashboard-main"
          className="flex-1 overflow-y-auto p-4 space-y-4 min-w-0"
        >
          {renderSection()}
        </main>

        {/* Resizable chat panel — operator/admin only */}
        {showChat && <ResizableChat tenantId={tenantId} />}
      </div>

      {/* Status bar (footer) */}
      <StatusBar tenantId={tenantId} />
    </div>
  );
};

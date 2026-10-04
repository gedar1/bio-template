import { useState, useEffect, useRef, useCallback } from "react";
import { Dna, LogOut } from "lucide-react";
import type {
  SectionId,
  NotificationBadge,
  LogEntry,
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

export const DashboardLayout: React.FC = () => {
  const { role } = useRole();
  const {
    isAuthenticated: isTenantAuth,
    displayName: tenantDisplayName,
    profile: tenantProfile,
    logout: tenantLogout,
  } = useTenantAuth();
  const [tenantId, setTenantId] = useState("default");
  const [activeSection, setActiveSection] =
    useState<SectionId>(getPersistedSection);
  const [badgeEvents, setBadgeEvents] = useState<BadgeEvent[]>([]);
  const prevCircuitBreakerRef = useRef<CircuitBreakerStatus[] | null>(null);

  const showChat =
    role === "super_admin" || role === "admin" || role === "operator";

  const handleSectionChange = useCallback((section: SectionId) => {
    setActiveSection(section);
    setBadgeEvents((prev) => prev.filter((e) => e.sectionId !== section));
  }, []);

  // Listen to log stream for error events → badge on "system" section
  useEffect(() => {
    if (activeSection === "system") return;

    const es = new EventSource("/api/logs/stream");
    es.onmessage = (event) => {
      try {
        const entry: LogEntry = JSON.parse(event.data);
        if (entry.level === "error") {
          setBadgeEvents((prev) => [
            ...prev,
            { sectionId: "system", type: "error" },
          ]);
        }
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [activeSection]);

  // Poll circuit breaker for state changes
  useEffect(() => {
    if (activeSection === "system") return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/circuit-breaker");
        if (!res.ok) return;
        const json = await res.json();
        const breakers: CircuitBreakerStatus[] = json.breakers ?? json ?? [];

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
      } catch {
        /* ignore */
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [activeSection]);

  // Poll mutations for new events
  const lastMutationIdRef = useRef<number>(0);
  useEffect(() => {
    if (activeSection === "system") return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/mutations?tenantId=${tenantId}`);
        if (!res.ok) return;
        const json = await res.json();
        const mutations: MutationEvent[] = json.mutations ?? [];

        if (mutations.length > 0) {
          const maxId = Math.max(...mutations.map((m) => m.id));
          if (
            lastMutationIdRef.current > 0 &&
            maxId > lastMutationIdRef.current
          ) {
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
        }
      } catch {
        /* ignore */
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [activeSection, tenantId]);

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
            <h1 className="text-sm font-semibold text-gray-200">BioCore</h1>
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
            <TenantSelector current={tenantId} onChange={setTenantId} />
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

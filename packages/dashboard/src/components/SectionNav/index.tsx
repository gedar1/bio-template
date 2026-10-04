import {
  BarChart3,
  Settings,
  Wrench,
  SlidersHorizontal,
  ShieldAlert,
} from "lucide-react";
import type {
  SectionId,
  SectionDefinition,
  NotificationBadge,
} from "../../types/dashboard";
import { useRole } from "../../context/RoleContext";
import { useTenantAuth } from "../../context/TenantAuthContext";
import {
  filterPanelsByRole,
  filterPanelsForTenant,
} from "../../utils/roleFilter";
import { Tooltip } from "../Tooltip";

const SECTION_TOOLTIPS: Record<SectionId, string> = {
  overview: "Salud del sistema y métricas de rendimiento",
  operations: "Scheduler, actividad y herramientas MCP",
  system: "Reflex, circuit breakers, logs, mutaciones y WebSocket",
  settings: "Configuración del sistema (admin only)",
  platform: "Gestión de plataforma (super_admin only)",
};

const SECTIONS: SectionDefinition[] = [
  {
    id: "overview",
    label: "Overview",
    icon: BarChart3,
    panels: ["health", "perf"],
  },
  {
    id: "operations",
    label: "Operations",
    icon: Settings,
    panels: ["scheduler", "activity", "tools"],
  },
  {
    id: "system",
    label: "System",
    icon: Wrench,
    panels: [
      "circuit-breaker",
      "logs",
      "mutations",
      "registry",
      "websocket",
      "reflex",
    ],
  },
  {
    id: "settings",
    label: "Settings",
    icon: SlidersHorizontal,
    panels: ["settings"],
  },
  {
    id: "platform",
    label: "Platform",
    icon: ShieldAlert,
    panels: ["platform"],
  },
];

const STORAGE_KEY = "dashboard-active-section";

function getPersistedSection(): SectionId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SECTIONS.some((s) => s.id === stored)) {
      return stored as SectionId;
    }
  } catch {
    // localStorage unavailable
  }
  return "overview";
}

function persistSection(sectionId: SectionId): void {
  try {
    localStorage.setItem(STORAGE_KEY, sectionId);
  } catch {
    // Silently ignore
  }
}

interface SectionNavProps {
  activeSection: SectionId;
  onChange: (section: SectionId) => void;
  badges?: NotificationBadge[];
}

export { SECTIONS, STORAGE_KEY, getPersistedSection, persistSection };

export function SectionNav({
  activeSection,
  onChange,
  badges = [],
}: Readonly<SectionNavProps>) {
  const { role } = useRole();
  const { isAuthenticated: isTenantAuth } = useTenantAuth();

  const visibleSections = SECTIONS.filter((section) => {
    // Belt + suspenders: explicitly exclude Platform for tenant-authenticated users
    if (isTenantAuth && section.id === "platform") {
      return false;
    }

    const accessiblePanels = isTenantAuth
      ? filterPanelsForTenant(role, section.panels)
      : filterPanelsByRole(role, section.panels);
    return accessiblePanels.length > 0;
  });

  const getBadge = (sectionId: SectionId): NotificationBadge | undefined => {
    return badges.find((b) => b.sectionId === sectionId);
  };

  const handleSelect = (sectionId: SectionId) => {
    onChange(sectionId);
    persistSection(sectionId);
  };

  return (
    <nav
      className="flex flex-col items-center py-3 gap-2 shrink-0"
      aria-label="Secciones"
    >
      {visibleSections.map((section) => {
        const badge = getBadge(section.id);
        const isActive = section.id === activeSection;
        const Icon = section.icon;

        return (
          <Tooltip
            key={section.id}
            text={SECTION_TOOLTIPS[section.id]}
            position="right"
          >
            <button
              onClick={() => handleSelect(section.id)}
              aria-current={isActive ? "page" : undefined}
              className={`relative flex items-center justify-center w-10 h-10 rounded-full border transition-colors ${
                isActive
                  ? "bg-gray-700 border-emerald-500 text-emerald-400"
                  : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200"
              }`}
            >
              <Icon size={18} />
              {badge && badge.count > 0 && (
                <span
                  className={`absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center text-white ${
                    badge.type === "error"
                      ? "bg-red-500"
                      : badge.type === "warning"
                        ? "bg-yellow-500"
                        : "bg-blue-500"
                  }`}
                >
                  {badge.count > 9 ? "9+" : badge.count}
                </span>
              )}
            </button>
          </Tooltip>
        );
      })}
    </nav>
  );
}

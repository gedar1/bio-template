/**
 * Consolidated dashboard layout, navigation, role and settings props.
 * Aggregates trivial .types.ts files (0-3 props each) into one cohesive module.
 */
import type { SectionId, NotificationBadge, UserRole } from "./dashboard";

// ─── Layout ──────────────────────────────────────────────────────────────────
export interface DashboardLayoutProps {}

// ─── Settings Panel ──────────────────────────────────────────────────────────
export type SettingsTab = "general" | "llm" | "tools";
export interface SettingsPanelProps {
  // No external props — uses hooks internally
}

// ─── Section Navigation ──────────────────────────────────────────────────────
export interface SectionNavProps {
  activeSection: SectionId;
  onChange: (section: SectionId) => void;
  badges?: Record<SectionId, NotificationBadge | undefined>;
}

// ─── Role Badge & Guard ───────────────────────────────────────────────────────
export interface RoleBadgeProps {}
export interface RoleGuardProps {
  /** Panel ID to check access for */
  panel?: string;
  /** Minimum role required */
  requiredRole?: UserRole;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

// ─── ResizableChat ────────────────────────────────────────────────────────────
export interface ResizableChatProps {
  tenantId: string;
}

// ─── Sections ─────────────────────────────────────────────────────────────────
export interface OverviewSectionProps {}
export interface SystemSectionProps {
  tenantId: string;
}
export interface OperationsSectionProps {
  tenantId: string;
}

// ─── Registry Viewer ─────────────────────────────────────────────────────────
export interface RegistryViewerProps {
  tenantId?: string;
}

// ─── Domain Widgets ───────────────────────────────────────────────────────────
export interface DomainWidgetsProps {
  tenantId: string;
  profile: string;
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────
export type TooltipPosition = "top" | "bottom" | "left" | "right";
export interface TooltipProps {
  position?: TooltipPosition;
  text: string;
  children: React.ReactNode;
}

// ─── Tool Icon ────────────────────────────────────────────────────────────────
export interface ToolIconProps {
  name: string;
}

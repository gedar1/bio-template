import type { ReactNode } from "react";
import type { UserRole } from "../../types/dashboard";
import { useRole } from "../../context/RoleContext";
import {
  canAccessPanel,
  canPerformAction,
  hasMinimumRole,
} from "../../utils/roleFilter";

interface RoleGuardProps {
  /** Panel ID to check access for */
  panel?: string;
  /** Action ID to check permission for */
  action?: string;
  /** Minimum role required (alternative to panel/action check) */
  minRole?: UserRole;
  /** Content to render when access is granted */
  children: ReactNode;
  /** Optional fallback when access is denied (defaults to nothing) */
  fallback?: ReactNode;
}

/**
 * Conditionally renders children based on the current user's role permissions.
 * Supports checking by panel access, action permission, or minimum role level.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.6
 */
export function RoleGuard({
  panel,
  action,
  minRole,
  children,
  fallback = null,
}: Readonly<RoleGuardProps>) {
  const { role } = useRole();

  let allowed = true;

  if (panel) {
    allowed = allowed && canAccessPanel(role, panel);
  }

  if (action) {
    allowed = allowed && canPerformAction(role, action);
  }

  if (minRole) {
    allowed = allowed && hasMinimumRole(role, minRole);
  }

  if (!allowed) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

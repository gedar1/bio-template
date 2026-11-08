import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import type { UserRole } from "../types/dashboard";
import { fetchTenantSession, TENANT_SESSION_EVENT } from "./TenantAuthContext";

interface RoleContextValue {
  role: UserRole;
  loading: boolean;
  error: string | null;
}

const RoleContext = createContext<RoleContextValue>({
  role: "viewer",
  loading: true,
  error: null,
});

interface RoleProviderProps {
  children: ReactNode;
}

export function RoleProvider({ children }: Readonly<RoleProviderProps>) {
  const [role, setRole] = useState<UserRole>("viewer");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function resolveRole() {
      // 1. Sesión de tenant: la cookie httpOnly identifica al tenant y su rol.
      const session = await fetchTenantSession();
      if (session) {
        if (!cancelled) {
          setRole(session.role);
          setError(null);
          setLoading(false);
        }
        return;
      }

      // 2. Fallback: rol del entorno desde /api/role (auth por API_SECRET o local).
      try {
        const res = await fetch("/api/role");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) {
          setRole(json.role ?? "viewer");
          setError(null);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          // Default to viewer on error (Requirement 4.7)
          setRole("viewer");
          setError(err instanceof Error ? err.message : "Failed to fetch role");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    // Se vuelve a resolver cuando el tenant inicia o cierra sesión.
    const onSessionChange = () => {
      void resolveRole();
    };

    void resolveRole();
    window.addEventListener(TENANT_SESSION_EVENT, onSessionChange);
    return () => {
      cancelled = true;
      window.removeEventListener(TENANT_SESSION_EVENT, onSessionChange);
    };
  }, []);

  const value = useMemo(
    () => ({ role, loading, error }),
    [role, loading, error],
  );

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole(): RoleContextValue {
  return useContext(RoleContext);
}

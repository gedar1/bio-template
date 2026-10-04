import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import type { UserRole } from "../types/dashboard";

const TENANT_JWT_KEY = "biocore_tenant_jwt";

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

/**
 * Decode the payload section of a JWT token (base64url encoded).
 * Returns the parsed claims object or null if decoding fails.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(atob(payload.replaceAll("-", "+").replaceAll("_", "/")));
  } catch {
    return null;
  }
}

/**
 * Attempts to extract a valid role from the tenant JWT stored in sessionStorage.
 * Returns the role if the JWT exists, is decodable, and is not expired.
 * Returns null otherwise (caller should fallback to /api/role).
 */
function getRoleFromStoredJwt(): UserRole | null {
  try {
    const token = sessionStorage.getItem(TENANT_JWT_KEY);
    if (!token) return null;

    const claims = decodeJwtPayload(token);
    if (!claims) return null;

    // Check expiration
    const exp = claims.exp;
    if (typeof exp === "number" && exp <= Date.now() / 1000) {
      return null;
    }

    // Extract role from claims
    const role = claims.role;
    if (role === "admin" || role === "operator" || role === "viewer") {
      return role;
    }

    return null;
  } catch {
    return null;
  }
}

export function RoleProvider({ children }: Readonly<RoleProviderProps>) {
  const [role, setRole] = useState<UserRole>("viewer");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function resolveRole() {
      // 1. Check if a valid tenant JWT is stored in sessionStorage
      const jwtRole = getRoleFromStoredJwt();
      if (jwtRole) {
        if (!cancelled) {
          setRole(jwtRole);
          setError(null);
          setLoading(false);
        }
        return;
      }

      // 2. Fallback: fetch role from /api/role endpoint (env-based auth)
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

    resolveRole();
    return () => {
      cancelled = true;
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

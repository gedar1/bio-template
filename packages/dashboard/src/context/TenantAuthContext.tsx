import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import type { UserRole } from "../types/dashboard";

// ─── JWT Decode Utility ─────────────────────────────────────────────────────

interface TenantJWTPayload {
  tenant_id: string;
  role: UserRole;
  profile: string;
  iat: number;
  exp: number;
}

function decodeJWT(token: string): TenantJWTPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    if (!payload.tenant_id || !payload.role || !payload.profile) return null;
    return payload as TenantJWTPayload;
  } catch {
    return null;
  }
}

function isTokenExpired(payload: TenantJWTPayload): boolean {
  return Date.now() >= payload.exp * 1000;
}

// ─── Session Storage Keys ───────────────────────────────────────────────────

const TENANT_TOKEN_KEY = "tenant_token";

function getStoredToken(): string | null {
  return sessionStorage.getItem(TENANT_TOKEN_KEY);
}

function setStoredToken(token: string): void {
  sessionStorage.setItem(TENANT_TOKEN_KEY, token);
}

function clearStoredToken(): void {
  sessionStorage.removeItem(TENANT_TOKEN_KEY);
}

// ─── Context Interface ──────────────────────────────────────────────────────

interface TenantAuthContextValue {
  isAuthenticated: boolean;
  tenantId: string | null;
  role: UserRole | null;
  profile: string | null;
  displayName: string | null;
  loading: boolean;
  error: string | null;
  login: (apiKey: string, role?: string) => Promise<void>;
  logout: () => void;
}

const TenantAuthContext = createContext<TenantAuthContextValue>({
  isAuthenticated: false,
  tenantId: null,
  role: null,
  profile: null,
  displayName: null,
  loading: true,
  error: null,
  login: async () => {},
  logout: () => {},
});

// ─── Provider ───────────────────────────────────────────────────────────────

interface TenantAuthProviderProps {
  children: ReactNode;
}

export function TenantAuthProvider({
  children,
}: Readonly<TenantAuthProviderProps>) {
  const [token, setToken] = useState<string | null>(null);
  const [claims, setClaims] = useState<TenantJWTPayload | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize from sessionStorage
  useEffect(() => {
    const stored = getStoredToken();
    if (stored) {
      const payload = decodeJWT(stored);
      if (payload && !isTokenExpired(payload)) {
        setToken(stored);
        setClaims(payload);
      } else {
        clearStoredToken();
      }
    }
    setLoading(false);
  }, []);

  // Check token expiration periodically
  useEffect(() => {
    if (!claims) return;

    const interval = setInterval(() => {
      if (isTokenExpired(claims)) {
        clearStoredToken();
        setToken(null);
        setClaims(null);
        setDisplayName(null);
        setError("Session expired. Please log in again.");
      }
    }, 30_000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, [claims]);

  const login = useCallback(async (apiKey: string, role?: string) => {
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/tenant/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey.trim(),
          role: role ?? "operator",
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        const errMsg =
          json?.error?.message ?? json?.error ?? "Authentication failed.";
        setError(errMsg);
        return;
      }

      const receivedToken: string | undefined =
        json?.data?.token ?? json?.token;
      if (!receivedToken) {
        setError("Invalid server response.");
        return;
      }

      const payload = decodeJWT(receivedToken);
      if (!payload) {
        setError("Invalid token received.");
        return;
      }

      setStoredToken(receivedToken);
      setToken(receivedToken);
      setClaims(payload);
      setDisplayName(json?.data?.display_name ?? payload.tenant_id);
      setError(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Network error. Please retry.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    clearStoredToken();
    setToken(null);
    setClaims(null);
    setDisplayName(null);
    setError(null);
  }, []);

  const value: TenantAuthContextValue = useMemo(
    () => ({
      isAuthenticated: !!token && !!claims && !isTokenExpired(claims),
      tenantId: claims?.tenant_id ?? null,
      role: claims?.role ?? null,
      profile: claims?.profile ?? null,
      displayName,
      loading,
      error,
      login,
      logout,
    }),
    [token, claims, displayName, loading, error, login, logout],
  );

  return (
    <TenantAuthContext.Provider value={value}>
      {children}
    </TenantAuthContext.Provider>
  );
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useTenantAuth(): TenantAuthContextValue {
  return useContext(TenantAuthContext);
}

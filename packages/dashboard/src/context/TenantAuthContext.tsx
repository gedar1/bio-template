import { clearApiCache } from "../hooks/useApi";
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

// ─── Session ────────────────────────────────────────────────────────────────

/**
 * Sesión del tenant tal como la devuelve /api/tenant/auth/me.
 * El JWT vive en una cookie httpOnly que el navegador envía sola, así que el
 * dashboard nunca lo lee ni lo guarda.
 */
interface TenantSession {
  tenant_id: string;
  role: UserRole;
  profile: string;
}

/** Intervalo para revalidar la sesión (detecta expiración y revocación). */
const SESSION_CHECK_MS = 60_000;

/** Evento de window que avisa cuando cambia la sesión del tenant. */
export const TENANT_SESSION_EVENT = "biocore:tenant-session";

function notifySessionChange(): void {
  window.dispatchEvent(new Event(TENANT_SESSION_EVENT));
}

/** Lee la sesión con la cookie del navegador. Devuelve null si no hay sesión válida. */
export async function fetchTenantSession(): Promise<TenantSession | null> {
  try {
    const res = await fetch("/api/tenant/auth/me");
    if (!res.ok) return null;
    const json = await res.json();
    const data = json?.data;
    if (!data?.tenant_id || !data?.role || !data?.profile) return null;
    return {
      tenant_id: data.tenant_id as string,
      role: data.role as UserRole,
      profile: data.profile as string,
    };
  } catch {
    return null;
  }
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
  const [session, setSession] = useState<TenantSession | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Restaura la sesión que quedó en la cookie al recargar la página.
  useEffect(() => {
    let cancelled = false;
    fetchTenantSession().then((restored) => {
      if (cancelled) return;
      if (restored) {
        setSession(restored);
        setDisplayName(restored.tenant_id);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Revalida la sesión periódicamente. Si el servidor ya no la reconoce, cierra localmente.
  useEffect(() => {
    if (!session) return;

    const interval = setInterval(() => {
      void fetchTenantSession().then((current) => {
        if (current) return;
        clearApiCache();
        setSession(null);
        setDisplayName(null);
        setError("Session expired. Please log in again.");
        notifySessionChange();
      });
    }, SESSION_CHECK_MS);

    return () => clearInterval(interval);
  }, [session]);

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

      // El servidor fija la cookie de sesión en esta respuesta. Leemos el rol con /me.
      const established = await fetchTenantSession();
      if (!established) {
        setError("No se pudo iniciar la sesión en el navegador.");
        return;
      }

      clearApiCache();
      setSession(established);
      setDisplayName(established.tenant_id);
      setError(null);
      notifySessionChange();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Network error. Please retry.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    clearApiCache();
    setSession(null);
    setDisplayName(null);
    setError(null);
    // La cookie se borra en el servidor. Avisamos cuando termina la petición.
    fetch("/api/tenant/auth/logout", { method: "POST" })
      .catch(() => undefined)
      .finally(notifySessionChange);
  }, []);

  const value: TenantAuthContextValue = useMemo(
    () => ({
      isAuthenticated: !!session,
      tenantId: session?.tenant_id ?? null,
      role: session?.role ?? null,
      profile: session?.profile ?? null,
      displayName,
      loading,
      error,
      login,
      logout,
    }),
    [session, displayName, loading, error, login, logout],
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

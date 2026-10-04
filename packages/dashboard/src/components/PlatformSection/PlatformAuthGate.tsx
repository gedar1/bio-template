import { useState, useCallback, useEffect, type ReactNode } from "react";
import { ShieldAlert, LogIn, AlertCircle } from "lucide-react";
import { getPlatformToken, setPlatformToken } from "./usePlatformApi";

interface PlatformAuthGateProps {
  /** Content to render when authenticated */
  children: ReactNode;
}

/**
 * Login gate for the Platform Super Admin section.
 *
 * - Shows a login form with a "Platform Secret" input field.
 * - On submit, POSTs to `/api/platform/auth/login` with `{ secret: value }`.
 * - On success, stores the JWT token in localStorage (key: 'platform_token').
 * - Shows error message if login fails.
 * - If a valid token exists, renders children; otherwise shows the login form.
 *
 * Requirements: 2.1, 2.5, 12.1
 */
export function PlatformAuthGate({
  children,
}: Readonly<PlatformAuthGateProps>) {
  const [token, setToken] = useState<string | null>(getPlatformToken());

  // Listen for token removal (e.g., on 401 from usePlatformApi clearing the token)
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "platform_token") {
        setToken(e.newValue);
      }
    };
    globalThis.addEventListener("storage", handleStorage);
    return () => globalThis.removeEventListener("storage", handleStorage);
  }, []);

  // If token exists, render children
  if (token) {
    return <>{children}</>;
  }

  return <PlatformLoginForm onSuccess={(t) => setToken(t)} />;
}

// ─── Login Form ─────────────────────────────────────────────────────────────

interface PlatformLoginFormProps {
  onSuccess: (token: string) => void;
}

function PlatformLoginForm({ onSuccess }: Readonly<PlatformLoginFormProps>) {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.SyntheticEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);

      if (!secret.trim()) {
        setError("Platform secret is required.");
        return;
      }

      setLoading(true);

      try {
        const res = await fetch("/api/platform/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secret: secret.trim() }),
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
          setError("Invalid server response: no token received.");
          return;
        }

        setPlatformToken(receivedToken);
        onSuccess(receivedToken);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Network error. Please retry.";
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [secret, onSuccess],
  );

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-6">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="flex flex-col items-center mb-6">
          <ShieldAlert size={48} className="text-emerald-400 mb-3" />
          <h2 className="text-xl font-semibold text-gray-100">
            Platform Admin
          </h2>
          <p className="text-sm text-gray-400 mt-1 text-center">
            Enter the platform secret to access super admin features.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="platform-secret"
              className="block text-sm font-medium text-gray-300 mb-1"
            >
              Platform Secret
            </label>
            <input
              id="platform-secret"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Enter your platform secret"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-colors"
              disabled={loading}
              autoComplete="off"
            />
          </div>

          {/* Error message */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-900/30 border border-red-700/50 rounded-md">
              <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          {/* Submit button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium rounded-md transition-colors"
          >
            {loading ? (
              <>
                <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />{" "}
                Authenticating...
              </>
            ) : (
              <>
                <LogIn size={16} />
                Access Platform
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

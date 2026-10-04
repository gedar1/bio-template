import { useState, useCallback } from "react";
import { KeyRound, LogIn, AlertCircle, Eye, EyeOff } from "lucide-react";
import { useTenantAuth } from "../../context/TenantAuthContext";

type TenantRole = "admin" | "operator" | "viewer";

/**
 * Login form displayed when no valid tenant session exists.
 * - API key input field (masked with show/hide toggle)
 * - Role selector (admin/operator/viewer, default: operator)
 * - Submit button with loading state
 * - Error display area
 *
 * After successful login, the TenantAuthContext updates and the parent
 * conditionally unmounts this form (showing the dashboard instead).
 *
 * Requirements: 9.1, 9.2, 9.3
 */
export function TenantLoginForm() {
  const { login, loading, error } = useTenantAuth();

  const [apiKey, setApiKey] = useState("");
  const [role, setRole] = useState<TenantRole>("operator");
  const [showKey, setShowKey] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const displayError = error ?? localError;

  const handleSubmit = useCallback(
    async (e: React.SyntheticEvent<HTMLFormElement>) => {
      e.preventDefault();
      setLocalError(null);

      if (!apiKey.trim()) {
        setLocalError("API key is required.");
        return;
      }

      await login(apiKey, role);
    },
    [apiKey, role, login],
  );

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-6">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="flex flex-col items-center mb-6">
          <KeyRound size={48} className="text-emerald-400 mb-3" />
          <h2 className="text-xl font-semibold text-gray-100">Tenant Login</h2>
          <p className="text-sm text-gray-400 mt-1 text-center">
            Enter your tenant API key to access the dashboard.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* API Key input with show/hide toggle */}
          <div>
            <label
              htmlFor="tenant-api-key"
              className="block text-sm font-medium text-gray-300 mb-1"
            >
              API Key
            </label>
            <div className="relative">
              <input
                id="tenant-api-key"
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your tenant API key"
                className="w-full px-3 py-2 pr-10 bg-gray-800 border border-gray-600 rounded-md text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-colors"
                disabled={loading}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowKey((prev) => !prev)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 transition-colors"
                aria-label={showKey ? "Hide API key" : "Show API key"}
                tabIndex={-1}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Role selector */}
          <div>
            <label
              htmlFor="tenant-role"
              className="block text-sm font-medium text-gray-300 mb-1"
            >
              Role
            </label>
            <select
              id="tenant-role"
              value={role}
              onChange={(e) => setRole(e.target.value as TenantRole)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-colors appearance-none"
              disabled={loading}
            >
              <option value="admin">Admin</option>
              <option value="operator">Operator</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>

          {/* Error message */}
          {displayError && (
            <div
              role="alert"
              className="flex items-start gap-2 p-3 bg-red-900/30 border border-red-700/50 rounded-md"
            >
              <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
              <p className="text-sm text-red-300">{displayError}</p>
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
                <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                <span>Authenticating...</span>
              </>
            ) : (
              <>
                <LogIn size={16} />
                <span>Sign In</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

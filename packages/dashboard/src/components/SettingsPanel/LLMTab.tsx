import { useState, useCallback } from "react";
import type {
  SystemSettings,
  SettingsPatch,
  UpdateResult,
  LLMProviderName,
  ApiKeyStatus,
  CircuitBreakerInfo,
} from "../../types/settings";

export interface LLMTabProps {
  settings: SystemSettings;
  updateSettings: (patch: SettingsPatch) => Promise<UpdateResult>;
}

const PROVIDER_LABELS: Record<LLMProviderName, string> = {
  gemini: "Gemini",
  claude: "Claude",
  nvidia: "NVIDIA",
};

const ALL_PROVIDERS: LLMProviderName[] = ["gemini", "claude", "nvidia"];

function ApiKeyStatusDot({ status }: Readonly<{ status: ApiKeyStatus }>) {
  const colors: Record<ApiKeyStatus, string> = {
    configured: "bg-green-400",
    missing: "bg-red-400",
    invalid_format: "bg-yellow-400",
  };

  const labels: Record<ApiKeyStatus, string> = {
    configured: "Configured",
    missing: "Missing",
    invalid_format: "Invalid format",
  };

  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-block w-2.5 h-2.5 rounded-full ${colors[status]}`}
        aria-label={`API key status: ${labels[status]}`}
      />
      <span className="text-sm text-gray-300">{labels[status]}</span>
    </div>
  );
}

function CircuitBreakerBadge({
  state,
}: Readonly<{
  state: CircuitBreakerInfo["state"];
}>) {
  const styles: Record<CircuitBreakerInfo["state"], string> = {
    CLOSED: "bg-green-600/20 text-green-400 border-green-600/40",
    OPEN: "bg-red-600/20 text-red-400 border-red-600/40",
    HALF_OPEN: "bg-yellow-600/20 text-yellow-400 border-yellow-600/40",
  };

  return (
    <span
      className={`text-xs font-medium px-2 py-0.5 rounded-full border ${styles[state]}`}
    >
      {state}
    </span>
  );
}

function formatTimestamp(ts: number | null): string {
  if (ts === null) return "N/A";
  return new Date(ts).toLocaleString();
}

function formatRecoveryTime(ms: number | null): string {
  if (ms === null) return "N/A";
  return `${Math.ceil(ms / 1000)}s`;
}

/**
 * LLM tab for the Settings Panel.
 * Displays provider selection, API key statuses, and circuit breaker health.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 6.1, 6.2, 6.3
 */
export function LLMTab({ settings, updateSettings }: Readonly<LLMTabProps>) {
  const { llm } = settings;
  const { providers, apiKeyStatuses, circuitBreakers } = llm;

  const [selectedProvider, setSelectedProvider] = useState<LLMProviderName>(
    providers.primaryProvider,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleProviderChange = useCallback(
    async (newProvider: LLMProviderName) => {
      const previousProvider = selectedProvider;
      setSelectedProvider(newProvider);
      setSaving(true);
      setError(null);

      const result: UpdateResult = await updateSettings({
        llm: { primaryProvider: newProvider },
      });

      setSaving(false);

      if (!result.success) {
        // Revert on failure
        setSelectedProvider(previousProvider);
        setError(result.error ?? "Error al cambiar proveedor");
        setTimeout(() => setError(null), 5000);
      }
    },
    [selectedProvider, updateSettings],
  );

  return (
    <div className="space-y-6">
      {/* Provider Selection */}
      <section className="bg-gray-800 border border-gray-700 rounded-lg p-5">
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-gray-200 font-medium text-base">
            LLM Provider Configuration
          </h3>
          {llm.metadata.reloadType === "hot-reload" && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-600/20 text-emerald-400 border border-emerald-600/40">
              hot-reload
            </span>
          )}
        </div>

        <div className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="primary-provider" className="text-sm text-gray-400">
              Primary Provider
            </label>
            <select
              id="primary-provider"
              value={selectedProvider}
              onChange={(e) =>
                handleProviderChange(e.target.value as LLMProviderName)
              }
              disabled={saving}
              className="bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500 transition-colors disabled:opacity-50"
            >
              {ALL_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABELS[p]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-gray-400">Fallback Chain Order</span>
            <div className="flex gap-2">
              {providers.fallbackOrder.map((p, idx) => (
                <span
                  key={p}
                  className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 border border-gray-600"
                >
                  {idx + 1}. {PROVIDER_LABELS[p]}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Error feedback */}
        {error && (
          <div className="mt-4 text-sm px-3 py-2 rounded bg-red-600/20 text-red-400 border border-red-600/40">
            {error}
          </div>
        )}
      </section>

      {/* API Key Status */}
      <section className="bg-gray-800 border border-gray-700 rounded-lg p-5">
        <h3 className="text-gray-200 font-medium text-base mb-4">
          API Key Status
        </h3>

        <div className="space-y-3">
          {ALL_PROVIDERS.map((provider) => (
            <div
              key={provider}
              className="flex items-center justify-between py-2 px-3 rounded bg-gray-900 border border-gray-700"
            >
              <span className="text-sm text-gray-200 font-medium">
                {PROVIDER_LABELS[provider]}
              </span>
              <ApiKeyStatusDot status={apiKeyStatuses[provider]} />
            </div>
          ))}
        </div>
      </section>

      {/* Circuit Breaker Status */}
      <section className="bg-gray-800 border border-gray-700 rounded-lg p-5">
        <h3 className="text-gray-200 font-medium text-base mb-4">
          Circuit Breaker Status
        </h3>

        <div className="space-y-3">
          {ALL_PROVIDERS.map((provider) => {
            const breaker = circuitBreakers.find(
              (cb) => cb.provider === provider,
            );

            if (!breaker) {
              return (
                <div
                  key={provider}
                  className="py-2 px-3 rounded bg-gray-900 border border-gray-700 text-sm text-gray-400"
                >
                  {PROVIDER_LABELS[provider]} — No data available
                </div>
              );
            }

            return (
              <div
                key={provider}
                className="py-3 px-3 rounded bg-gray-900 border border-gray-700"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-200 font-medium">
                    {PROVIDER_LABELS[provider]}
                  </span>
                  <CircuitBreakerBadge state={breaker.state} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
                  <div>
                    <span className="text-gray-500">Failures:</span>{" "}
                    <span className="text-gray-300">
                      {breaker.failureCount}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Last failure:</span>{" "}
                    <span className="text-gray-300">
                      {formatTimestamp(breaker.lastFailureTimestamp)}
                    </span>
                  </div>
                  {breaker.state === "OPEN" && (
                    <div className="col-span-2">
                      <span className="text-gray-500">Recovery in:</span>{" "}
                      <span className="text-yellow-400">
                        {formatRecoveryTime(breaker.estimatedRecoveryMs)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

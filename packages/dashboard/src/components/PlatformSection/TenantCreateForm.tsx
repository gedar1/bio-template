import { useState, useCallback } from "react";
import { platformFetch } from "./usePlatformApi";

/** Valid tenant profiles matching the backend TenantProfileSchema */
const PROFILES = ["dev", "restaurant", "clinic", "ecommerce"] as const;
type TenantProfile = (typeof PROFILES)[number];

/** Regex for valid tenant_id: lowercase letters, numbers, and hyphens */
const TENANT_ID_REGEX = /^[a-z0-9-]+$/;

interface CreateTenantRequest {
  tenant_id: string;
  display_name: string;
  profile: TenantProfile;
  token_limit?: number;
}

interface TenantRecord {
  tenant_id: string;
  display_name: string;
  profile: TenantProfile;
  status: string;
  created_at: string;
  updated_at: string;
  token_limit: number;
  last_activity: string | null;
}

interface CreateTenantResponse extends TenantRecord {
  api_key?: string;
}

interface FormErrors {
  tenant_id?: string;
  display_name?: string;
}

/**
 * Form component for creating new tenants via the Platform API.
 * Validates tenant_id against regex and requires display_name.
 *
 * Requirements: 4.1, 4.4
 */
export function TenantCreateForm() {
  const [tenantId, setTenantId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [profile, setProfile] = useState<TenantProfile>("dev");
  const [tokenLimit, setTokenLimit] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
    apiKey?: string;
  } | null>(null);

  /** Validate form fields, returns true if valid */
  const validate = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    if (!tenantId.trim()) {
      newErrors.tenant_id = "Tenant ID is required";
    } else if (!TENANT_ID_REGEX.test(tenantId)) {
      newErrors.tenant_id =
        "Only lowercase letters, numbers, and hyphens allowed";
    }

    if (!displayName.trim()) {
      newErrors.display_name = "Display name is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [tenantId, displayName]);

  /** Clear the form to initial state */
  const clearForm = useCallback(() => {
    setTenantId("");
    setDisplayName("");
    setProfile("dev");
    setTokenLimit("");
    setErrors({});
  }, []);

  /** Handle form submission */
  const handleSubmit = useCallback(
    async (e: React.SyntheticEvent<HTMLFormElement>) => {
      e.preventDefault();
      setFeedback(null);

      if (!validate()) return;

      const payload: CreateTenantRequest = {
        tenant_id: tenantId.trim(),
        display_name: displayName.trim(),
        profile,
      };

      // Only include token_limit if user entered a value
      const limitValue = tokenLimit.trim();
      if (limitValue !== "") {
        payload.token_limit = Number.parseInt(limitValue, 10);
      }

      setLoading(true);

      const result = await platformFetch<CreateTenantResponse>("tenants", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setLoading(false);

      if (result.error) {
        // Map known HTTP status codes to user-friendly messages
        let message = result.error;
        if (result.status === 409) {
          message = `Tenant "${tenantId}" already exists`;
        } else if (result.status === 422) {
          message = `Validation error: ${result.error}`;
        }
        setFeedback({ type: "error", message });
      } else {
        const apiKey = result.data?.api_key;
        setFeedback({
          type: "success",
          message: `Tenant "${tenantId}" created successfully.`,
          apiKey,
        });
        clearForm();
      }
    },
    [tenantId, displayName, profile, tokenLimit, validate, clearForm],
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <h3 className="text-gray-200 font-medium text-base">Create New Tenant</h3>

      {/* Tenant ID */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="tenant-id" className="text-sm text-gray-400">
          Tenant ID <span className="text-red-400">*</span>
        </label>
        <input
          id="tenant-id"
          type="text"
          value={tenantId}
          onChange={(e) => {
            setTenantId(e.target.value);
            if (errors.tenant_id)
              setErrors((prev) => ({ ...prev, tenant_id: undefined }));
          }}
          placeholder="my-tenant-id"
          className={`bg-gray-900 border rounded px-3 py-2 text-sm text-gray-200 focus:outline-none transition-colors ${
            errors.tenant_id
              ? "border-red-500 focus:border-red-400"
              : "border-gray-600 focus:border-emerald-500"
          }`}
        />
        {errors.tenant_id && (
          <span className="text-xs text-red-400">{errors.tenant_id}</span>
        )}
        <span className="text-xs text-gray-500">
          Lowercase letters, numbers, and hyphens only
        </span>
      </div>

      {/* Display Name */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="tenant-display-name" className="text-sm text-gray-400">
          Display Name <span className="text-red-400">*</span>
        </label>
        <input
          id="tenant-display-name"
          type="text"
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value);
            if (errors.display_name)
              setErrors((prev) => ({ ...prev, display_name: undefined }));
          }}
          placeholder="My Tenant Name"
          className={`bg-gray-900 border rounded px-3 py-2 text-sm text-gray-200 focus:outline-none transition-colors ${
            errors.display_name
              ? "border-red-500 focus:border-red-400"
              : "border-gray-600 focus:border-emerald-500"
          }`}
        />
        {errors.display_name && (
          <span className="text-xs text-red-400">{errors.display_name}</span>
        )}
      </div>

      {/* Profile Select */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="tenant-profile" className="text-sm text-gray-400">
          Profile
        </label>
        <select
          id="tenant-profile"
          value={profile}
          onChange={(e) => setProfile(e.target.value as TenantProfile)}
          className="bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500 transition-colors"
        >
          {PROFILES.map((p) => (
            <option key={p} value={p}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {/* Token Limit */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="tenant-token-limit" className="text-sm text-gray-400">
          Token Limit
        </label>
        <input
          id="tenant-token-limit"
          type="number"
          value={tokenLimit}
          onChange={(e) => setTokenLimit(e.target.value)}
          placeholder="0"
          min="0"
          className="bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500 transition-colors"
        />
        <span className="text-xs text-gray-500">
          Maximum tokens per month. Leave empty or 0 for unlimited.
        </span>
      </div>

      {/* Feedback */}
      {feedback && (
        <div
          className={`text-sm px-3 py-2 rounded ${
            feedback.type === "success"
              ? "bg-emerald-600/20 text-emerald-400 border border-emerald-600/40"
              : "bg-red-600/20 text-red-400 border border-red-600/40"
          }`}
          role="alert"
        >
          <p>{feedback.message}</p>
          {feedback.apiKey && (
            <div className="mt-2 p-2 bg-gray-900 rounded border border-gray-700">
              <p className="text-xs text-yellow-400 font-semibold mb-1">
                ⚠️ API Key (copy now — shown only once):
              </p>
              <code className="text-xs text-gray-200 break-all select-all">
                {feedback.apiKey}
              </code>
            </div>
          )}
        </div>
      )}

      {/* Submit Button */}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 text-sm font-medium rounded bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Creating..." : "Create Tenant"}
        </button>
      </div>
    </form>
  );
}

import { useState, useCallback } from "react";
import type {
  SystemSettings,
  SettingsPatch,
  UpdateResult,
} from "../../types/settings";

export interface GeneralTabProps {
  settings: SystemSettings;
  updateSettings: (patch: SettingsPatch) => Promise<UpdateResult>;
}

/**
 * General tab for the Settings Panel.
 * Displays read-only tenant profile info and editable business configuration.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 */
export function GeneralTab({
  settings,
  updateSettings,
}: Readonly<GeneralTabProps>) {
  const { tenant, business } = settings;

  const [name, setName] = useState(business.name);
  const [timezone, setTimezone] = useState(business.timezone);
  const [language, setLanguage] = useState(business.language);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const hasChanges =
    name !== business.name ||
    timezone !== business.timezone ||
    language !== business.language;

  const handleSave = useCallback(async () => {
    setSaving(true);
    setFeedback(null);

    const result = await updateSettings({
      business: { name, timezone, language },
    });

    setSaving(false);

    if (result.success) {
      setFeedback({ type: "success", message: "Configuración guardada" });
    } else {
      setFeedback({
        type: "error",
        message: result.error ?? "Error al guardar",
      });
    }

    // Auto-dismiss feedback after 4 seconds
    setTimeout(() => setFeedback(null), 4000);
  }, [name, timezone, language, updateSettings]);

  return (
    <div className="space-y-6">
      {/* Tenant Profile — Read-Only */}
      <section className="bg-gray-800 border border-gray-700 rounded-lg p-5">
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-gray-200 font-medium text-base">
            Tenant Profile
          </h3>
          {tenant.metadata.reloadType === "restart-required" && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-600/20 text-yellow-400 border border-yellow-600/40">
              requires restart
            </span>
          )}
        </div>

        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-gray-400 w-28">Profile:</span>
            <span className="text-gray-200 font-mono">{tenant.profile}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-400 w-28">Description:</span>
            <span className="text-gray-200">{tenant.description}</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-gray-400 w-28 pt-0.5">Enabled Cells:</span>
            <div className="flex flex-wrap gap-1.5">
              {tenant.allowedCells.map((cell) => (
                <span
                  key={cell}
                  className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-300 border border-gray-600"
                >
                  {cell}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Business Configuration — Editable */}
      <section className="bg-gray-800 border border-gray-700 rounded-lg p-5">
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-gray-200 font-medium text-base">
            Business Configuration
          </h3>
          {business.metadata.reloadType === "hot-reload" && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-600/20 text-emerald-400 border border-emerald-600/40">
              hot-reload
            </span>
          )}
        </div>

        <div className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="business-name" className="text-sm text-gray-400">
              Business Name
            </label>
            <input
              id="business-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="business-timezone"
              className="text-sm text-gray-400"
            >
              Timezone
            </label>
            <input
              id="business-timezone"
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="business-language"
              className="text-sm text-gray-400"
            >
              Language
            </label>
            <input
              id="business-language"
              type="text"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>
        </div>

        {/* Feedback */}
        {feedback && (
          <div
            className={`mt-4 text-sm px-3 py-2 rounded ${
              feedback.type === "success"
                ? "bg-emerald-600/20 text-emerald-400 border border-emerald-600/40"
                : "bg-red-600/20 text-red-400 border border-red-600/40"
            }`}
          >
            {feedback.message}
          </div>
        )}

        {/* Save Button */}
        <div className="mt-4 flex justify-end">
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="px-4 py-2 text-sm font-medium rounded bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </section>
    </div>
  );
}

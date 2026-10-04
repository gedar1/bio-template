import { useState, useCallback, useMemo } from "react";
import type {
  SystemSettings,
  SettingsPatch,
  UpdateResult,
  TemplateState,
} from "../../types/settings";

export interface ToolsTemplatesTabProps {
  settings: SystemSettings;
  updateSettings: (patch: SettingsPatch) => Promise<UpdateResult>;
}

/**
 * Tools/Templates tab for the Settings Panel.
 * Displays templates grouped by category with enable/disable toggles.
 * Implements optimistic updates with revert on failure.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4
 */
export function ToolsTemplatesTab({
  settings,
  updateSettings,
}: Readonly<ToolsTemplatesTabProps>) {
  const { templates } = settings;

  // Local override state for optimistic updates (templateId -> enabled)
  const [localOverrides, setLocalOverrides] = useState<Record<string, boolean>>(
    {},
  );
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Group templates by category
  const groupedTemplates = useMemo(() => {
    return templates.items.reduce(
      (groups, template) => {
        const category = template.category;
        if (!groups[category]) groups[category] = [];
        groups[category].push(template);
        return groups;
      },
      {} as Record<string, TemplateState[]>,
    );
  }, [templates.items]);

  const categories = useMemo(
    () => Object.keys(groupedTemplates).sort((a, b) => a.localeCompare(b)),
    [groupedTemplates],
  );

  const getEffectiveEnabled = useCallback(
    (template: TemplateState): boolean => {
      if (template.id in localOverrides) {
        return localOverrides[template.id];
      }
      return template.enabled;
    },
    [localOverrides],
  );

  const handleToggle = useCallback(
    async (template: TemplateState) => {
      const newState = !getEffectiveEnabled(template);

      // Optimistic update
      setLocalOverrides((prev) => ({ ...prev, [template.id]: newState }));
      setTogglingIds((prev) => new Set(prev).add(template.id));
      setError(null);

      const result: UpdateResult = await updateSettings({
        templates: { [template.id]: { enabled: newState } },
      });

      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(template.id);
        return next;
      });

      if (result.success) {
        // Clear override since server state is now the source of truth
        setLocalOverrides((prev) => {
          const next = { ...prev };
          delete next[template.id];
          return next;
        });
      } else {
        // Revert on failure
        setLocalOverrides((prev) => {
          const next = { ...prev };
          delete next[template.id];
          return next;
        });
        setError(result.error ?? "Error al cambiar estado del template");
        setTimeout(() => setError(null), 5000);
      }
    },
    [getEffectiveEnabled, updateSettings],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h3 className="text-gray-200 font-medium text-base">
          Templates Management
        </h3>
        {templates.metadata.reloadType === "hot-reload" && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-600/20 text-emerald-400 border border-emerald-600/40">
            hot-reload
          </span>
        )}
      </div>

      {/* Error notification */}
      {error && (
        <div className="text-sm px-3 py-2 rounded bg-red-600/20 text-red-400 border border-red-600/40">
          {error}
        </div>
      )}

      {/* Empty state */}
      {templates.items.length === 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-5 text-center text-gray-400 text-sm">
          No templates available for the current profile.
        </div>
      )}

      {/* Grouped templates */}
      {categories.map((category) => (
        <section
          key={category}
          className="bg-gray-800 border border-gray-700 rounded-lg p-5"
        >
          <h4 className="text-gray-300 font-medium text-sm uppercase tracking-wide mb-3">
            {category}
          </h4>

          <div className="space-y-2">
            {groupedTemplates[category].map((template) => {
              const enabled = getEffectiveEnabled(template);
              const isToggling = togglingIds.has(template.id);

              return (
                <div
                  key={template.id}
                  className="flex items-center justify-between py-2.5 px-3 rounded bg-gray-900 border border-gray-700"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-200">
                      {template.name}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-400 border border-gray-600">
                      {template.category}
                    </span>
                  </div>

                  <button
                    role="switch"
                    aria-checked={enabled}
                    aria-label={`Toggle ${template.name}`}
                    disabled={isToggling}
                    onClick={() => handleToggle(template)}
                    className={`relative w-10 h-5 rounded-full transition-colors disabled:opacity-50 ${
                      enabled ? "bg-emerald-600" : "bg-gray-600"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                        enabled ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

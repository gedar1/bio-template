import { useState } from "react";
import {
  LayoutTemplate,
  X,
  ChevronDown,
  ChevronUp,
  Package,
  Globe,
  FolderOpen,
  Mail,
  GitBranch,
  Cloud,
  Settings,
  Radio,
  ShoppingBag,
  Warehouse,
  Truck,
  Zap,
} from "lucide-react";
import { useApi, authHeaders } from "../../hooks/useApi";
import { useProfile } from "../../context/ProfileContext";
import { StepIndicator } from "../StepIndicator";
import type { TaskTemplate, TemplateParameter } from "../../types/dashboard";

interface QuickTemplatesProps {
  onTemplateResult: (result: TemplateExecutionResult) => void;
  disabled?: boolean;
  tenantId: string;
}

export interface TemplateExecutionResult {
  templateName: string;
  templateId: string;
  category: string;
  steps: string[];
  args: Record<string, unknown>;
  success: boolean;
  results: string[];
  error?: string;
}

const CATEGORY_ICONS: Record<
  string,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  memory: Package,
  sensory: Globe,
  filesystem: FolderOpen,
  communication: Mail,
  versioncontrol: GitBranch,
  http: Cloud,
  system: Settings,
  monitor: Radio,
  orders: ShoppingBag,
  inventory: Warehouse,
  delivery: Truck,
};

/**
 * Botón + panel desplegable que muestra templates del perfil activo como cards.
 * Ejecuta directamente sin LLM usando el endpoint /api/template/execute.
 */
export function QuickTemplates({
  onTemplateResult,
  disabled,
  tenantId,
}: Readonly<QuickTemplatesProps>) {
  const { profile } = useProfile();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<TaskTemplate | null>(
    null,
  );
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [executing, setExecuting] = useState(false);

  const { data } = useApi<{ templates: TaskTemplate[]; total: number }>(
    `/api/templates?profile=${profile}`,
    60000,
  );

  const templates = (data?.templates || []).filter(
    (t) => t.steps && t.steps.length > 0,
  );

  const handleSelect = (template: TaskTemplate) => {
    setSelectedTemplate(template);
    const initial: Record<string, string> = {};
    for (const param of template.parameters) {
      initial[param.key] = "";
    }
    setFormValues(initial);
  };

  const handleCancel = () => {
    setSelectedTemplate(null);
    setFormValues({});
  };

  const handleExecute = async () => {
    if (!selectedTemplate || !selectedTemplate.steps) return;
    setExecuting(true);

    try {
      // Construir args para las herramientas (no mutaciones)
      const toolArgs: Record<string, unknown> = {};
      const toolSteps = selectedTemplate.steps.filter(
        (s) => !s.startsWith("mutate:"),
      );
      for (const step of toolSteps) {
        toolArgs[step] = { ...formValues };
      }

      const res = await fetch("/api/template/execute", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          steps: selectedTemplate.steps,
          args: toolArgs,
          templateName: selectedTemplate.name,
          tenantId,
        }),
      });

      const result = await res.json();

      onTemplateResult({
        templateName: selectedTemplate.name,
        templateId: selectedTemplate.id,
        category: selectedTemplate.category,
        steps: selectedTemplate.steps,
        args: formValues,
        success: result.success ?? false,
        results: result.results ?? [],
        error: result.error,
      });

      setSelectedTemplate(null);
      setFormValues({});
      setIsOpen(false);
    } catch (err: any) {
      onTemplateResult({
        templateName: selectedTemplate.name,
        templateId: selectedTemplate.id,
        category: selectedTemplate.category,
        steps: selectedTemplate.steps,
        args: formValues,
        success: false,
        results: [],
        error: err.message,
      });
    } finally {
      setExecuting(false);
    }
  };

  if (templates.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-400 hover:text-gray-200 border border-gray-600 rounded hover:border-gray-500 disabled:opacity-50 transition-colors"
        title="Usar template (sin LLM)"
      >
        <LayoutTemplate size={14} />
        {isOpen ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-80 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 max-h-96 overflow-y-auto">
          {!selectedTemplate ? (
            <div className="p-2 space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-gray-500 uppercase tracking-wide px-2 py-1">
                <Zap size={12} className="text-green-400" />
                Templates (ejecución directa, sin LLM)
              </div>
              {templates.map((t) => {
                const Icon = CATEGORY_ICONS[t.category] || Settings;
                return (
                  <button
                    key={t.id}
                    onClick={() => handleSelect(t)}
                    className="w-full text-left px-3 py-2 rounded hover:bg-gray-800 transition-colors flex items-start gap-2"
                  >
                    <Icon size={16} className="text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <div className="text-sm text-gray-200">{t.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {t.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="p-3">
              {/* Card del template */}
              <div className="bg-gray-800 rounded-lg p-3 border border-gray-700 mb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {(() => {
                      const Icon =
                        CATEGORY_ICONS[selectedTemplate.category] || Settings;
                      return <Icon size={16} className="text-emerald-400" />;
                    })()}
                    <h4 className="text-sm font-medium text-gray-200">
                      {selectedTemplate.name}
                    </h4>
                  </div>
                  <button
                    onClick={handleCancel}
                    className="text-gray-500 hover:text-gray-300"
                  >
                    <X size={14} />
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {selectedTemplate.description}
                </p>
                {selectedTemplate.steps && (
                  <div className="mt-2">
                    <StepIndicator steps={selectedTemplate.steps} mode="hint" />
                  </div>
                )}
                <div className="flex items-center gap-1 mt-2 text-xs text-green-400">
                  <Zap size={12} />
                  <span>Ejecución directa (sin LLM)</span>
                </div>
              </div>

              {/* Formulario */}
              {selectedTemplate.parameters.length > 0 && (
                <div className="space-y-2 mb-3">
                  {selectedTemplate.parameters.map((param) => (
                    <div key={param.key}>
                      <label className="block text-xs text-gray-400 mb-0.5">
                        {param.label}
                        {param.required && (
                          <span className="text-red-400 ml-0.5">*</span>
                        )}
                      </label>
                      <input
                        type={param.type === "number" ? "number" : "text"}
                        value={formValues[param.key] || ""}
                        onChange={(e) =>
                          setFormValues((prev) => ({
                            ...prev,
                            [param.key]: e.target.value,
                          }))
                        }
                        placeholder={param.placeholder}
                        className="w-full bg-gray-800 text-white text-sm rounded px-2 py-1.5 border border-gray-600 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={handleExecute}
                disabled={
                  executing ||
                  !canSubmit(selectedTemplate.parameters, formValues)
                }
                className="w-full bg-emerald-600 text-white text-sm py-2 rounded hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {executing ? (
                  <span className="animate-pulse">Ejecutando...</span>
                ) : (
                  <>
                    <Zap size={14} />
                    Ejecutar
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function canSubmit(
  params: TemplateParameter[],
  values: Record<string, string>,
): boolean {
  return params.filter((p) => p.required).every((p) => values[p.key]?.trim());
}

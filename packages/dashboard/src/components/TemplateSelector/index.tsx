import { useState, useMemo } from "react";
import {
  Package,
  Globe,
  FolderOpen,
  Mail,
  GitBranch,
  Cloud,
  Settings,
  Radio,
  Zap,
  Brain,
  X,
  ShoppingBag,
  Warehouse,
  Truck,
} from "lucide-react";
import { useApi } from "../../hooks/useApi";
import { useProfile } from "../../context/ProfileContext";
import { Tooltip } from "../Tooltip";
import { StepIndicator } from "../StepIndicator";
import type { TaskTemplate, TemplateParameter } from "../../types/dashboard";
import { groupByCategory } from "../../utils/groupByCategory";
import {
  validateTemplateParams,
  type ValidationError,
} from "../../utils/validateTemplateParams";

const CATEGORY_TOOLTIPS: Record<string, string> = {
  memory: "Operaciones de base de datos: backups, queries, migraciones",
  sensory: "Web scraping, APIs REST, feeds RSS y extracción de datos",
  filesystem: "Lectura, escritura, copia y limpieza de archivos",
  communication: "Email (Gmail), WhatsApp y notificaciones",
  versioncontrol: "Git: commit, push, pull, sincronización de ramas",
  http: "Peticiones HTTP avanzadas: GET, POST, PUT, DELETE",
  system: "Ejecución de CLIs y comandos del sistema",
  monitor: "Monitoreo combinado: health checks, scraping y alertas",
};

/** Labels amigables para operadores — reemplaza nombres técnicos internos */
const CATEGORY_LABELS: Record<
  string,
  {
    icon: React.ComponentType<{ size?: number; className?: string }>;
    label: string;
  }
> = {
  memory: { icon: Package, label: "Base de Datos" },
  sensory: { icon: Globe, label: "Web Scraping" },
  filesystem: { icon: FolderOpen, label: "Archivos" },
  communication: { icon: Mail, label: "Comunicación" },
  versioncontrol: { icon: GitBranch, label: "Control de Versiones" },
  http: { icon: Cloud, label: "HTTP / APIs" },
  system: { icon: Settings, label: "Sistema" },
  monitor: { icon: Radio, label: "Monitoreo" },
  orders: { icon: ShoppingBag, label: "Pedidos" },
  inventory: { icon: Warehouse, label: "Inventario" },
  delivery: { icon: Truck, label: "Entregas" },
};

interface TemplateSelectorProps {
  readonly tenantId: string;
  readonly onSelect: (
    template: TaskTemplate,
    values: Record<string, string | number>,
  ) => void;
}

/**
 * Fetches templates from /api/templates, displays catalog grouped by category,
 * and renders a parameter form on selection with inline validation.
 *
 * Requirements: 1.1, 1.2, 1.5
 */
export function TemplateSelector({
  tenantId: _tenantId,
  onSelect,
}: TemplateSelectorProps) {
  const { profile, loading: profileLoading } = useProfile();
  const endpoint = profileLoading
    ? "/api/templates"
    : `/api/templates?profile=${profile}`;
  const { data, loading, error } = useApi<{
    templates: TaskTemplate[];
    total: number;
  }>(endpoint, 30000);
  const [selectedTemplate, setSelectedTemplate] = useState<TaskTemplate | null>(
    null,
  );
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>(
    [],
  );
  const [submitted, setSubmitted] = useState(false);

  const grouped = useMemo(() => {
    if (!data?.templates) return [];
    return groupByCategory(data.templates);
  }, [data]);

  const handleTemplateSelect = (template: TaskTemplate) => {
    setSelectedTemplate(template);
    setSubmitted(false);
    setValidationErrors([]);
    // Pre-fill with empty values
    const initial: Record<string, string> = {};
    for (const param of template.parameters) {
      initial[param.key] = "";
    }
    setFormValues(initial);
  };

  const handleFieldChange = (key: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
    // Clear error for this field on change
    if (submitted) {
      setValidationErrors((prev) => prev.filter((e) => e.key !== key));
    }
  };

  const handleSubmit = () => {
    if (!selectedTemplate) return;
    setSubmitted(true);

    // Convert numeric fields before validation
    const typedValues: Record<string, unknown> = {};
    for (const param of selectedTemplate.parameters) {
      const raw = formValues[param.key] ?? "";
      if (param.type === "number" && raw !== "") {
        typedValues[param.key] = Number(raw);
      } else {
        typedValues[param.key] = raw;
      }
    }

    const errors = validateTemplateParams(
      selectedTemplate.parameters,
      typedValues,
    );
    setValidationErrors(errors);

    if (errors.length === 0) {
      const finalValues: Record<string, string | number> = {};
      for (const param of selectedTemplate.parameters) {
        const raw = formValues[param.key] ?? "";
        if (param.type === "number" && raw !== "") {
          finalValues[param.key] = Number(raw);
        } else {
          finalValues[param.key] = raw;
        }
      }
      onSelect(selectedTemplate, finalValues);
      setSelectedTemplate(null);
      setFormValues({});
      setSubmitted(false);
    }
  };

  const handleCancel = () => {
    setSelectedTemplate(null);
    setFormValues({});
    setValidationErrors([]);
    setSubmitted(false);
  };

  const getFieldError = (key: string): string | undefined => {
    return validationErrors.find((e) => e.key === key)?.message;
  };

  if (loading) {
    return <div className="text-gray-400 text-sm">Cargando templates...</div>;
  }

  if (error) {
    return (
      <div className="text-red-400 text-sm">
        Error al cargar templates: {error}
      </div>
    );
  }

  // Show parameter form when a template is selected
  if (selectedTemplate) {
    return (
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-600">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h4 className="text-white text-sm font-medium">
              {selectedTemplate.name}
            </h4>
            <p className="text-gray-400 text-xs mt-0.5">
              {selectedTemplate.description}
            </p>
          </div>
          <button
            onClick={handleCancel}
            className="text-gray-400 hover:text-white text-xs px-2 py-1 rounded border border-gray-600 hover:border-gray-400 flex items-center gap-1"
          >
            <X size={12} /> Cancelar
          </button>
        </div>

        {selectedTemplate.expectedOutcome && (
          <div className="text-gray-400 text-xs italic mb-3 border-l-2 border-gray-600 pl-2">
            Resultado esperado: {selectedTemplate.expectedOutcome}
          </div>
        )}

        <div className="space-y-3">
          {selectedTemplate.parameters.map((param) => (
            <ParameterField
              key={param.key}
              param={param}
              value={formValues[param.key] ?? ""}
              error={getFieldError(param.key)}
              onChange={(val) => handleFieldChange(param.key, val)}
            />
          ))}
        </div>

        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span
              className={
                selectedTemplate.usesLLM ? "text-blue-400" : "text-green-400"
              }
            >
              {selectedTemplate.usesLLM ? (
                <>
                  <Brain size={14} className="inline" /> Usa LLM
                </>
              ) : (
                <>
                  <Zap size={14} className="inline" /> Sin LLM
                </>
              )}
            </span>
            <span>·</span>
            <span>
              Intervalo: {formatInterval(selectedTemplate.defaultIntervalMs)}
            </span>
          </div>
          <button
            onClick={handleSubmit}
            className="bg-green-600 text-white px-4 py-1.5 rounded text-xs font-medium hover:bg-green-700"
          >
            Crear Tarea
          </button>
        </div>
      </div>
    );
  }

  // Show template catalog grouped by category
  return (
    <div className="space-y-3">
      <h4 className="text-gray-300 text-xs font-medium uppercase tracking-wide">
        Templates Disponibles
      </h4>
      {grouped.map((group) => (
        <div key={group.category}>
          <Tooltip
            text={CATEGORY_TOOLTIPS[group.category] ?? group.category}
            position="right"
          >
            <div className="text-gray-300 text-sm font-medium mb-2 cursor-default flex items-center gap-1.5">
              {CATEGORY_LABELS[group.category] ? (
                <>
                  {(() => {
                    const IconComp = CATEGORY_LABELS[group.category].icon;
                    return <IconComp size={14} />;
                  })()}
                  {CATEGORY_LABELS[group.category].label}
                </>
              ) : (
                group.category
              )}
            </div>
          </Tooltip>
          <div className="grid grid-cols-1  gap-2">
            {group.items.map((template) => (
              <button
                key={template.id}
                onClick={() => handleTemplateSelect(template)}
                className="text-left p-3 bg-gray-900 rounded border border-gray-700 hover:border-blue-500 transition-colors"
              >
                <div className="flex gap-8 card_content-template">
                  <div className="flex-col">
                    <div className="text-white text-sm font-medium">
                      {template.name}
                    </div>
                    <div className="text-gray-400 text-xs mt-1">
                      {template.description}
                    </div>
                    {template.expectedOutcome && (
                      <div className="text-green-400/70 text-xs mt-1.5 flex items-start gap-1">
                        <span className="shrink-0">→</span>
                        <span>{template.expectedOutcome}</span>
                      </div>
                    )}
                  </div>
                  {template.steps && template.steps.length > 0 && (
                    <div className="mt-2">
                      <StepIndicator steps={template.steps} mode="hint" />
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
      {grouped.length === 0 && (
        <div className="text-gray-500 text-sm text-center py-4">
          No hay templates disponibles.
        </div>
      )}
    </div>
  );
}

// ─── Parameter Field Sub-Component ──────────────────────────────────────────

interface ParameterFieldProps {
  readonly param: TemplateParameter;
  readonly value: string;
  readonly error?: string;
  readonly onChange: (value: string) => void;
}

function ParameterField({
  param,
  value,
  error,
  onChange,
}: ParameterFieldProps) {
  const inputType = param.type === "number" ? "number" : "text";

  return (
    <div>
      <label className="block text-gray-300 text-xs mb-1">
        {param.label}
        {param.required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      <input
        type={inputType}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={param.placeholder}
        min={param.validation?.min}
        max={param.validation?.max}
        className={`w-full bg-gray-800 text-white rounded px-3 py-1.5 text-sm border ${
          error ? "border-red-500" : "border-gray-600"
        } focus:border-blue-500 focus:outline-none`}
      />
      {error && <p className="text-red-400 text-xs mt-0.5">{error}</p>}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatInterval(ms: number): string {
  const min = ms / 60000;
  if (min < 60) return `${min}m`;
  const hours = min / 60;
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

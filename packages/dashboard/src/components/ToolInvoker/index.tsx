import { useState } from "react";
import type { ToolInputSchema, FormField } from "../../types/dashboard";
import { schemaToFormFields } from "../../utils/schemaToFormFields";

interface ToolInvokerProps {
  readonly tenantId: string;
  readonly toolName: string;
  readonly schema?: ToolInputSchema;
  readonly onClose: () => void;
}

/**
 * Renders a tool input schema as form fields using schemaToFormFields,
 * submits invocation to /api/tools/invoke, and displays result or error inline.
 *
 * Requirements: 2.2, 2.3, 2.6
 */
export function ToolInvoker({
  tenantId,
  toolName,
  schema,
  onClose,
}: ToolInvokerProps) {
  const fields: FormField[] = schema ? schemaToFormFields(schema) : [];
  const [formValues, setFormValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of fields) {
      initial[field.key] = "";
    }
    return initial;
  });
  const [result, setResult] = useState<string | object | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFieldChange = (key: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    // Build typed arguments from form values
    const args: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = formValues[field.key] ?? "";
      if (raw === "" && field.required === false) continue;
      switch (field.type) {
        case "number":
          args[field.key] = raw === "" ? undefined : Number(raw);
          break;
        case "boolean":
          args[field.key] = raw === "true";
          break;
        default:
          args[field.key] = raw;
      }
    }

    try {
      const res = await fetch("/api/tools/invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolName, args, tenantId }),
      });

      const json = await res.json();

      if (res.ok) {
        setResult(json);
      } else {
        setError(
          json.error ??
            `Error ${res.status}: Failed to invoke ${toolName} with params ${JSON.stringify(args)}`,
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(`Failed to invoke ${toolName}: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-900 rounded-lg p-4 border border-blue-700">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-blue-400 text-sm font-mono">{toolName}</h4>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white text-xs px-2 py-1 rounded border border-gray-600 hover:border-gray-400"
        >
          ✕
        </button>
      </div>

      {fields.length === 0 ? (
        <p className="text-gray-500 text-xs mb-4">
          Esta herramienta no requiere parámetros.
        </p>
      ) : (
        <div className="space-y-3 mb-4">
          {fields.map((field) => (
            <InvokerField
              key={field.key}
              field={field}
              value={formValues[field.key] ?? ""}
              onChange={(val) => handleFieldChange(field.key, val)}
            />
          ))}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={loading}
        className="bg-blue-600 text-white px-4 py-1.5 rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "Ejecutando..." : "Invocar"}
      </button>

      {error && (
        <div className="mt-3 p-2 bg-red-900/30 border border-red-700 rounded text-red-400 text-xs">
          <span className="font-medium">Error:</span> {error}
        </div>
      )}

      {result && (
        <div className="mt-3 p-2 bg-gray-800 border border-gray-600 rounded">
          <div className="text-gray-400 text-xs mb-1 font-medium">
            Resultado:
          </div>
          <pre className="text-green-400 text-xs overflow-x-auto whitespace-pre-wrap">
            {typeof result === "string"
              ? result
              : JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Field Sub-Component ────────────────────────────────────────────────────

interface InvokerFieldProps {
  readonly field: FormField;
  readonly value: string;
  readonly onChange: (value: string) => void;
}

function InvokerField({ field, value, onChange }: InvokerFieldProps) {
  if (field.type === "boolean") {
    return (
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={value === "true"}
          onChange={(e) => onChange(e.target.checked ? "true" : "false")}
          className="rounded border-gray-600"
          id={`field-${field.key}`}
        />
        <label htmlFor={`field-${field.key}`} className="text-gray-300 text-xs">
          {field.label}
          {field.required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
      </div>
    );
  }

  return (
    <div>
      <label className="block text-gray-300 text-xs mb-1">
        {field.label}
        {field.required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      <input
        type={field.type === "number" ? "number" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.description ?? field.key}
        className="w-full bg-gray-800 text-white rounded px-3 py-1.5 text-sm border border-gray-600 focus:border-blue-500 focus:outline-none"
      />
      {field.description && (
        <p className="text-gray-500 text-xs mt-0.5">{field.description}</p>
      )}
    </div>
  );
}

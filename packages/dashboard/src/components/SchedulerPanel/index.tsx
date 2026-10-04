import { useState } from "react";
import {
  ClipboardList,
  Play,
  Pause,
  X,
  Lightbulb,
  CalendarDays,
} from "lucide-react";
import { useApi } from "../../hooks/useApi";
import { TemplateSelector } from "../TemplateSelector";
import { Tooltip } from "../Tooltip";
import type { TaskTemplate } from "../../types/dashboard";

interface Task {
  id: string;
  name: string;
  intervalMs: number;
  enabled: boolean;
  lastRun: number | null;
  runCount: number;
  errors: number;
}

interface SchedulerData {
  tasks: Task[];
  total: number;
}

async function schedulerAction(endpoint: string, body: any) {
  const res = await fetch(`/api/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export function SchedulerPanel({ tenantId }: { readonly tenantId: string }) {
  const { data, refetch } = useApi<SchedulerData>("/api/scheduler", 5000);
  const [showForm, setShowForm] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [formMode, setFormMode] = useState<"chat" | "monitor">("monitor");
  const [form, setForm] = useState({
    taskId: "",
    name: "",
    message: "",
    urls: "",
    intervalMin: 5,
  });
  const [formError, setFormError] = useState<string | null>(null);

  const addTask = async () => {
    if (!form.taskId) return;
    setFormError(null);

    try {
      if (formMode === "monitor") {
        const urls = form.urls
          .split("\n")
          .map((u) => u.trim())
          .filter(Boolean);
        if (urls.length === 0) return;
        const targets = urls.map((url) => {
          const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
          try {
            const parsed = new URL(normalizedUrl);
            if (!parsed.hostname) throw new Error("No hostname");
            return { url: normalizedUrl, name: parsed.hostname };
          } catch {
            throw new Error(
              `URL inválida: "${url}". Usa el formato https://example.com`,
            );
          }
        });
        await schedulerAction("monitor/add", {
          taskId: form.taskId,
          name: form.name || form.taskId,
          targets,
          intervalMs: form.intervalMin * 60000,
          tenantId,
          startImmediately: true,
        });
      } else {
        if (!form.message) return;
        await schedulerAction("scheduler/add", {
          taskId: form.taskId,
          name: form.name || form.taskId,
          message: form.message,
          intervalMs: form.intervalMin * 60000,
          tenantId,
          startImmediately: true,
        });
      }

      setForm({ taskId: "", name: "", message: "", urls: "", intervalMin: 5 });
      setShowForm(false);
      refetch();
    } catch (err: any) {
      setFormError(err.message || "Error al crear la tarea");
    }
  };

  const handleTemplateSubmit = async (
    template: TaskTemplate,
    values: Record<string, string | number>,
  ) => {
    try {
      const taskId = `${template.id}-${Date.now()}`;
      if (template.usesLLM) {
        // LLM-based templates go through the chat scheduler
        const message = buildTemplateMessage(template, values);
        await schedulerAction("scheduler/add", {
          taskId,
          name: template.name,
          message,
          intervalMs: template.defaultIntervalMs,
          tenantId,
          startImmediately: true,
        });
      } else {
        // Direct tool execution templates go through monitor
        await schedulerAction("scheduler/add", {
          taskId,
          name: template.name,
          message: JSON.stringify({ template: template.id, params: values }),
          intervalMs: template.defaultIntervalMs,
          tenantId,
          startImmediately: true,
        });
      }
      setShowTemplates(false);
      refetch();
    } catch (err: any) {
      setFormError(err.message || "Error al crear tarea desde template");
    }
  };

  const formatTime = (ms: number | null) => {
    if (!ms) return "—";
    const diff = Math.round((Date.now() - ms) / 1000);
    if (diff < 60) return `hace ${diff}s`;
    return `hace ${Math.round(diff / 60)}m`;
  };

  const formatInterval = (ms: number) => {
    const min = ms / 60000;
    if (min < 60) return `${min}m`;
    return `${Math.round(min / 60)}h`;
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-gray-300 text-sm font-medium">
          Tareas Programadas ({data?.total || 0})
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setShowForm(!showForm);
              if (!showForm) setShowTemplates(false);
            }}
            className="bg-blue-600 text-white px-3 py-1 rounded text-xs hover:bg-blue-700"
          >
            {showForm ? "Cancelar" : "+ Nueva"}
          </button>
        </div>
      </div>

      {showTemplates && (
        <div className="mb-4 p-3 bg-gray-900 rounded-lg border border-gray-700">
          <div className="flex justify-end mb-2">
            <button
              onClick={() => setShowTemplates(false)}
              className="text-gray-400 hover:text-white text-xs px-2 py-0.5 rounded border border-gray-600 hover:border-gray-400"
            >
              ✕ Cerrar
            </button>
          </div>
          <TemplateSelector
            tenantId={tenantId}
            onSelect={handleTemplateSubmit}
          />
          <div className="mt-3 pt-3 border-t border-gray-700 text-center">
            <p className="text-gray-500 text-xs">
              <Lightbulb size={14} className="inline text-gray-500" /> ¿No
              encuentras lo que necesitas? Descríbela en el Chat →
            </p>
          </div>
        </div>
      )}

      {showForm && (
        <div className="mb-4 p-3 bg-gray-900 rounded-lg space-y-2">
          {formError && (
            <div className="text-red-400 text-xs bg-red-900/30 px-2 py-1 rounded">
              {formError}
            </div>
          )}
          <div className="flex gap-2 mb-2">
            <button
              onClick={() => setFormMode("monitor")}
              className={`px-3 py-1 rounded text-xs ${formMode === "monitor" ? "bg-green-600 text-white" : "bg-gray-700 text-gray-300"}`}
            >
              Monitor (sin LLM)
            </button>
            <button
              onClick={() => setFormMode("chat")}
              className={`px-3 py-1 rounded text-xs ${formMode === "chat" ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300"}`}
            >
              Chat (con LLM)
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="ID (ej: monitor-site)"
              value={form.taskId}
              onChange={(e) => setForm({ ...form, taskId: e.target.value })}
              className="bg-gray-800 text-white rounded px-2 py-1 text-sm border border-gray-600 focus:border-blue-500 focus:outline-none"
            />
            <input
              type="text"
              placeholder="Nombre (opcional)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="bg-gray-800 text-white rounded px-2 py-1 text-sm border border-gray-600 focus:border-blue-500 focus:outline-none"
            />
          </div>
          {formMode === "monitor" ? (
            <textarea
              placeholder={
                "URLs a monitorear (una por línea):\nhttps://example.com\nhttps://api.example.com/health"
              }
              value={form.urls}
              onChange={(e) => setForm({ ...form, urls: e.target.value })}
              rows={3}
              className="w-full bg-gray-800 text-white rounded px-2 py-1 text-sm border border-gray-600 focus:border-blue-500 focus:outline-none resize-none"
            />
          ) : (
            <input
              type="text"
              placeholder="Mensaje para el Cortex (ej: Verifica si example.com está activo)"
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              className="w-full bg-gray-800 text-white rounded px-2 py-1 text-sm border border-gray-600 focus:border-blue-500 focus:outline-none"
            />
          )}
          <div className="flex items-center gap-2">
            <label
              htmlFor="scheduler-interval"
              className="text-gray-400 text-xs"
            >
              Cada
            </label>
            <input
              id="scheduler-interval"
              type="number"
              min={1}
              value={form.intervalMin}
              onChange={(e) =>
                setForm({ ...form, intervalMin: Number(e.target.value) })
              }
              className="w-16 bg-gray-800 text-white rounded px-2 py-1 text-sm border border-gray-600 focus:border-blue-500 focus:outline-none"
            />
            <span className="text-gray-400 text-xs">minutos</span>
            {formMode === "monitor" && (
              <span className="text-green-400 text-xs ml-2 flex items-center gap-1">
                <Lightbulb size={14} /> Sin consumo de tokens (solo LLM si hay
                errores)
              </span>
            )}
            <button
              onClick={addTask}
              disabled={
                !form.taskId ||
                (formMode === "monitor" ? !form.urls.trim() : !form.message)
              }
              className="ml-auto bg-green-600 text-white px-3 py-1 rounded text-xs hover:bg-green-700 disabled:opacity-50"
            >
              Crear
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2 max-h-60">
        {data?.tasks.map((task: Task) => (
          <div
            key={task.id}
            className="flex items-center justify-between p-2 bg-gray-900 rounded text-sm"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${task.enabled ? "bg-green-500" : "bg-yellow-500"}`}
                />
                <span className="text-white font-mono truncate">{task.id}</span>
                <span className="text-gray-500 text-xs">
                  cada {formatInterval(task.intervalMs)}
                </span>
              </div>
              <div className="text-gray-500 text-xs mt-0.5">
                {task.runCount} ejecuciones · {task.errors} errores · última:{" "}
                {formatTime(task.lastRun)}
              </div>
            </div>
            <div className="flex gap-1 shrink-0 ml-2">
              <Tooltip text="Ejecutar tarea inmediatamente" position="top">
                <button
                  onClick={async () => {
                    await schedulerAction("scheduler/trigger", {
                      taskId: task.id,
                    });
                    refetch();
                  }}
                  className="text-blue-400 hover:text-blue-300 px-1.5 py-0.5 text-xs rounded border border-gray-600 hover:border-blue-500"
                  title="Ejecutar ahora"
                >
                  <Play size={12} />
                </button>
              </Tooltip>
              <Tooltip
                text={task.enabled ? "Pausar tarea" : "Reanudar tarea"}
                position="top"
              >
                <button
                  onClick={async () => {
                    await schedulerAction(
                      task.enabled ? "scheduler/pause" : "scheduler/resume",
                      { taskId: task.id },
                    );
                    refetch();
                  }}
                  className="text-yellow-400 hover:text-yellow-300 px-1.5 py-0.5 text-xs rounded border border-gray-600 hover:border-yellow-500"
                  title={task.enabled ? "Pausar" : "Reanudar"}
                >
                  {task.enabled ? <Pause size={12} /> : <Play size={12} />}
                </button>
              </Tooltip>
              <Tooltip text="Eliminar tarea del scheduler" position="top">
                <button
                  onClick={async () => {
                    await schedulerAction("scheduler/remove", {
                      taskId: task.id,
                    });
                    refetch();
                  }}
                  className="text-red-400 hover:text-red-300 px-1.5 py-0.5 text-xs rounded border border-gray-600 hover:border-red-500"
                  title="Eliminar"
                >
                  <X size={12} />
                </button>
              </Tooltip>
            </div>
          </div>
        ))}
        {(!data?.tasks || data.tasks.length === 0) && (
          <div className="text-center py-8">
            <div className="text-gray-500 text-3xl mb-3">
              <CalendarDays size={32} className="mx-auto text-gray-500" />
            </div>
            <div className="text-gray-400 text-sm mb-2">
              No hay tareas programadas.
            </div>
            <button
              onClick={() => {
                setShowTemplates(true);
                setShowForm(false);
              }}
              className="bg-purple-600 text-white px-4 py-2 rounded text-xs hover:bg-purple-700 inline-flex items-center gap-1"
            >
              <ClipboardList size={14} /> Crear desde template
            </button>
            <p className="text-gray-500 text-xs mt-3">
              <Lightbulb size={14} className="inline text-gray-500" /> O
              descríbela en el Chat →
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildTemplateMessage(
  template: TaskTemplate,
  values: Record<string, string | number>,
): string {
  const params = Object.entries(values)
    .filter(([, v]) => v !== "" && v !== undefined)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  return `Execute ${template.name} with parameters: ${params}`;
}

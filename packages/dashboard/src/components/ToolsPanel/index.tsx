import { useState, useMemo } from "react";
import { useApi } from "../../hooks/useApi";
import { useRole } from "../../context/RoleContext";
import { RoleGuard } from "../RoleGuard";
import { ToolInvoker } from "../ToolInvoker";
import { Tooltip } from "../Tooltip";
import { groupByCategory } from "../../utils/groupByCategory";
import type { ToolInputSchema } from "../../types/dashboard";

interface Tool {
  name: string;
  description?: string;
  category?: string;
  inputSchema?: ToolInputSchema;
}

interface ToolsData {
  tools: Tool[];
  cellType: string;
  mutationState: string;
}

interface RegistryCellOption {
  readonly type: string;
  readonly description: string;
}

/**
 * Interactive Tools Panel — displays current Cell_Type and mutation state,
 * groups tools by category, provides "Force Mutation" control,
 * and integrates ToolInvoker for selected tool.
 *
 * Requirements: 2.1, 2.4, 2.5, 2.7
 */
export function ToolsPanel({ tenantId }: Readonly<{ tenantId: string }>) {
  const { role } = useRole();
  const { data, loading, refetch } = useApi<ToolsData | Tool[]>(
    `/api/tools?tenantId=${tenantId}`,
    10000,
  );
  const { data: registryData } = useApi<{ cells: RegistryCellOption[] }>(
    "/api/registry",
    60000,
  );

  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [showMutationControl, setShowMutationControl] = useState(false);
  const [mutationTarget, setMutationTarget] = useState<string>("");
  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  // Handle both legacy (Tool[]) and new (ToolsData) response formats
  const tools: Tool[] = useMemo(() => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return data.tools ?? [];
  }, [data]);

  const cellType: string = useMemo(() => {
    if (!data || Array.isArray(data)) return "undifferentiated";
    return data.cellType ?? "undifferentiated";
  }, [data]);

  const mutationState: string = useMemo(() => {
    if (!data || Array.isArray(data)) return "idle";
    return data.mutationState ?? "idle";
  }, [data]);

  // Group tools by category
  const grouped = useMemo(() => {
    const withCategory = tools.map((t) => ({
      ...t,
      category: t.category ?? "general",
    }));
    return groupByCategory(withCategory);
  }, [tools]);

  const handleForceMutation = async () => {
    if (!mutationTarget) return;
    setMutating(true);
    setMutationError(null);

    try {
      const res = await fetch("/api/mutations/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: mutationTarget, tenantId }),
      });
      const json = await res.json();
      if (res.ok) {
        setShowMutationControl(false);
        setMutationTarget("");
        // Refetch tools after mutation (within 2s as per requirement)
        setTimeout(refetch, 1000);
      } else {
        setMutationError(json.error ?? `Error ${res.status}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setMutationError(message);
    } finally {
      setMutating(false);
    }
  };

  if (loading) {
    return <div className="text-gray-400">Cargando herramientas...</div>;
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      {/* Header with Cell_Type and mutation state */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-gray-300 text-sm font-medium">
            Herramientas MCP Activas ({tools.length})
          </h3>
          <div className="flex items-center gap-3 mt-1">
            <CellTypeBadge cellType={cellType} />
            <MutationStateBadge state={mutationState} />
          </div>
        </div>
        <RoleGuard action="force-mutation">
          <Tooltip
            text="Fuerza un cambio de tipo de célula para cargar herramientas diferentes"
            position="left"
          >
            <button
              onClick={() => setShowMutationControl(!showMutationControl)}
              className="bg-orange-600 text-white px-3 py-1 rounded text-xs hover:bg-orange-700"
            >
              {showMutationControl ? "Cancelar" : "⚡ Mutar"}
            </button>
          </Tooltip>
        </RoleGuard>
      </div>

      {/* Force Mutation Control */}
      {showMutationControl && (
        <div className="mb-4 p-3 bg-gray-900 rounded-lg border border-orange-700/50">
          <div className="text-gray-300 text-xs mb-2 font-medium">
            Forzar Mutación a:
          </div>
          {mutationError && (
            <div className="text-red-400 text-xs bg-red-900/30 px-2 py-1 rounded mb-2">
              {mutationError}
            </div>
          )}
          <div className="flex gap-2">
            <select
              value={mutationTarget}
              onChange={(e) => setMutationTarget(e.target.value)}
              className="flex-1 bg-gray-800 text-white rounded px-2 py-1 text-sm border border-gray-600 focus:border-orange-500 focus:outline-none"
            >
              <option value="">Seleccionar tipo de célula...</option>
              {registryData?.cells?.map((cell) => (
                <option key={cell.type} value={cell.type}>
                  {cell.type} — {cell.description}
                </option>
              ))}
            </select>
            <button
              onClick={handleForceMutation}
              disabled={!mutationTarget || mutating}
              className="bg-orange-600 text-white px-3 py-1 rounded text-xs hover:bg-orange-700 disabled:opacity-50"
            >
              {mutating ? "Mutando..." : "Ejecutar"}
            </button>
          </div>
        </div>
      )}

      {/* Tool Invoker (when a tool is selected) */}
      {selectedTool && (
        <div className="mb-4">
          <ToolInvoker
            tenantId={tenantId}
            toolName={selectedTool.name}
            schema={selectedTool.inputSchema}
            onClose={() => setSelectedTool(null)}
          />
        </div>
      )}

      {/* Tools list grouped by category */}
      <div className="space-y-3 max-h-80 overflow-y-auto">
        {tools.length === 0 ? (
          <div className="text-gray-500 text-sm text-center py-4">
            Célula sin diferenciar. Envía un mensaje para activar herramientas.
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.category}>
              <div className="text-gray-500 text-xs font-medium mb-1 capitalize sticky top-0 bg-gray-800 py-0.5">
                {group.category} ({group.items.length})
              </div>
              <div className="space-y-1">
                {group.items.map((tool) => (
                  <ToolRow
                    key={tool.name}
                    tool={tool}
                    isSelected={selectedTool?.name === tool.name}
                    canInvoke={role === "admin" || role === "super_admin"}
                    onSelect={() => {
                      if (selectedTool?.name === tool.name) {
                        setSelectedTool(null);
                      } else {
                        setSelectedTool(tool);
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Sub-Components ─────────────────────────────────────────────────────────

function CellTypeBadge({ cellType }: Readonly<{ cellType: string }>) {
  const colors: Record<string, string> = {
    sensory: "bg-purple-600",
    memory: "bg-blue-600",
    filesystem: "bg-green-600",
    communication: "bg-yellow-600",
    versioncontrol: "bg-orange-600",
    http: "bg-cyan-600",
    system: "bg-red-600",
    realtime: "bg-pink-600",
    monitor: "bg-teal-600",
    undifferentiated: "bg-gray-600",
  };

  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-mono text-white ${colors[cellType] ?? "bg-gray-600"}`}
    >
      {cellType}
    </span>
  );
}

function MutationStateBadge({ state }: Readonly<{ state: string }>) {
  const stateConfig: Record<string, { color: string; label: string }> = {
    idle: { color: "text-gray-500", label: "idle" },
    mutating: { color: "text-orange-400", label: "mutando..." },
    active: { color: "text-green-400", label: "activo" },
  };

  const config = stateConfig[state] ?? stateConfig.idle;

  return <span className={`text-xs ${config.color}`}>● {config.label}</span>;
}

interface ToolRowProps {
  readonly tool: Tool & { category: string };
  readonly isSelected: boolean;
  readonly canInvoke: boolean;
  readonly onSelect: () => void;
}

function ToolRow({ tool, isSelected, canInvoke, onSelect }: ToolRowProps) {
  return (
    <div
      className={`flex items-start gap-2 text-sm p-1.5 rounded transition-colors ${
        isSelected
          ? "bg-blue-900/30 border border-blue-700"
          : "hover:bg-gray-700/50"
      }`}
    >
      <span className="text-blue-400 font-mono shrink-0 text-xs">
        {tool.name}
      </span>
      <span className="text-gray-500 truncate text-xs flex-1">
        {tool.description}
      </span>
      {canInvoke && (
        <button
          onClick={onSelect}
          className={`shrink-0 px-2 py-0.5 rounded text-xs border ${
            isSelected
              ? "bg-blue-600 text-white border-blue-500"
              : "text-blue-400 border-gray-600 hover:border-blue-500"
          }`}
          title="Invocar herramienta"
        >
          {isSelected ? "Cerrar" : "▶"}
        </button>
      )}
    </div>
  );
}

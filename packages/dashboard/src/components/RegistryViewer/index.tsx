import { useMemo, useState } from "react";
import { useApi } from "../../hooks/useApi";
import { buildHierarchy, countUniqueTools } from "../../utils/registryHelpers";
import type { RegistryCellType, HierarchyNode } from "../../types/dashboard";
import type { RegistryViewerProps } from "./RegistryViewer.types";

interface RegistryApiResponse {
  cells: RegistryCellType[];
  error?: string;
}

/**
 * RegistryViewer — displays all Cell_Types with descriptions and tools,
 * shows parent-child hierarchy, displays unique tool count.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4
 */
export const RegistryViewer: React.FC<RegistryViewerProps> = () => {
  const { data, loading, error } = useApi<RegistryApiResponse>(
    "/api/registry",
    30000,
  );

  const cells = data?.cells ?? [];

  // Build hierarchy tree (Req 8.2)
  const hierarchy = useMemo(() => buildHierarchy(cells), [cells]);

  // Count unique tools (Req 8.3)
  const uniqueToolCount = useMemo(() => countUniqueTools(cells), [cells]);

  if (loading) {
    return <div className="text-gray-400">Cargando registry...</div>;
  }

  if (error) {
    return <div className="text-red-400">Error: {error}</div>;
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      {/* Header with stats */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-gray-300 text-sm font-medium">
          Registry de Células
        </h3>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-gray-500">
            Tipos:{" "}
            <span className="text-gray-300 font-medium">{cells.length}</span>
          </span>
          <span className="text-gray-500">
            Herramientas únicas:{" "}
            <span className="text-emerald-400 font-medium">
              {uniqueToolCount}
            </span>
          </span>
        </div>
      </div>

      {/* Hierarchy tree (Req 8.1, 8.2) */}
      <div className="space-y-1 max-h-[500px] overflow-y-auto">
        {hierarchy.length === 0 ? (
          <div className="text-gray-500 text-sm text-center py-8">
            Registry vacío. No hay tipos de célula configurados.
          </div>
        ) : (
          hierarchy.map((node) => (
            <HierarchyNodeRow key={node.type} node={node} depth={0} />
          ))
        )}
      </div>
    </div>
  );
};

// ─── Sub-Components ─────────────────────────────────────────────────────────

function HierarchyNodeRow({
  node,
  depth,
}: Readonly<{ node: HierarchyNode; depth: number }>) {
  const [expanded, setExpanded] = useState(depth === 0);
  const hasChildren = node.children.length > 0;

  const colors: Record<string, string> = {
    sensory: "border-purple-600",
    sensory_advanced: "border-purple-700",
    memory: "border-blue-600",
    filesystem: "border-green-600",
    communication: "border-yellow-600",
    versioncontrol: "border-orange-600",
    http: "border-cyan-600",
    system: "border-red-600",
    realtime: "border-pink-600",
    monitor: "border-teal-600",
  };

  const borderColor = colors[node.type] ?? "border-gray-600";

  return (
    <div style={{ marginLeft: `${depth * 16}px` }}>
      <div
        className={`bg-gray-900 rounded-lg p-3 border-l-2 ${borderColor} border border-gray-700 mb-1`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {hasChildren && (
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="text-gray-500 hover:text-gray-300 text-xs w-4"
              >
                {expanded ? "▼" : "▶"}
              </button>
            )}
            {!hasChildren && <span className="w-4" />}
            <span className="text-gray-200 text-sm font-mono font-medium">
              {node.type}
            </span>
          </div>
          <span className="text-gray-500 text-xs">
            {node.tools.length} herramientas
          </span>
        </div>

        <div className="text-gray-400 text-xs mt-1 ml-6">
          {node.description}
        </div>

        {/* Tool list */}
        {expanded && node.tools.length > 0 && (
          <div className="mt-2 ml-6 flex flex-wrap gap-1">
            {node.tools.map((tool) => (
              <span
                key={tool}
                className="px-1.5 py-0.5 bg-gray-800 rounded text-xs text-blue-400 font-mono border border-gray-700"
              >
                {tool}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Children (Req 8.2) */}
      {expanded &&
        hasChildren &&
        node.children.map((child) => (
          <HierarchyNodeRow key={child.type} node={child} depth={depth + 1} />
        ))}
    </div>
  );
}

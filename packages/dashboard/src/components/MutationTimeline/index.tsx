import { useState, useMemo } from "react";
import { Dna } from "lucide-react";
import { useApi } from "../../hooks/useApi";
import { filterMutations } from "../../utils/filterMutations";
import type { MutationEvent } from "../../types/dashboard";
import type {
  MutationTimelineProps,
  MutationFilterState,
  TimeRange,
} from "./MutationTimeline.types";

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: "1h", label: "Última hora" },
  { value: "24h", label: "Últimas 24h" },
  { value: "7d", label: "Últimos 7 días" },
  { value: "all", label: "Todo" },
];

/**
 * MutationTimeline — displays chronological mutation list from /api/mutations,
 * shows current Cell_Type indicator, supports filtering by type and time range.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 */
export const MutationTimeline: React.FC<MutationTimelineProps> = ({
  tenantId,
}) => {
  const { data, loading, error } = useApi<{ mutations: MutationEvent[] }>(
    `/api/mutations?tenantId=${tenantId}`,
    5000,
  );

  const [filter, setFilter] = useState<MutationFilterState>({
    cellType: "",
    timeRange: "24h",
  });

  const mutations = data?.mutations ?? [];

  // Determine current Cell_Type (latest mutation's toType) (Req 7.4)
  const currentCellType = useMemo(() => {
    if (mutations.length === 0) return "undifferentiated";
    const sorted = [...mutations].sort((a, b) => b.timestamp - a.timestamp);
    return sorted[0].toType;
  }, [mutations]);

  // Extract unique cell types for filter dropdown
  const cellTypes = useMemo(() => {
    const set = new Set<string>();
    for (const m of mutations) {
      set.add(m.fromType);
      set.add(m.toType);
    }
    return Array.from(set).sort();
  }, [mutations]);

  // Compute time range boundaries
  const timeRangeBounds = useMemo(() => {
    const now = Date.now();
    switch (filter.timeRange) {
      case "1h":
        return { startTime: now - 60 * 60 * 1000, endTime: undefined };
      case "24h":
        return { startTime: now - 24 * 60 * 60 * 1000, endTime: undefined };
      case "7d":
        return {
          startTime: now - 7 * 24 * 60 * 60 * 1000,
          endTime: undefined,
        };
      case "all":
      default:
        return { startTime: undefined, endTime: undefined };
    }
  }, [filter.timeRange]);

  // Apply filters (Req 7.5)
  const filteredMutations = useMemo(() => {
    return filterMutations(mutations, {
      cellType: filter.cellType || undefined,
      ...timeRangeBounds,
    });
  }, [mutations, filter.cellType, timeRangeBounds]);

  // Display in reverse chronological order (newest first)
  const displayMutations = useMemo(
    () => [...filteredMutations].reverse(),
    [filteredMutations],
  );

  if (loading) {
    return (
      <div className="text-gray-400">Cargando historial de mutaciones...</div>
    );
  }

  if (error) {
    return <div className="text-red-400">Error: {error}</div>;
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      {/* Header with current Cell_Type indicator (Req 7.4) */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-gray-300 text-sm font-medium">
          Timeline de Mutaciones
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-xs">Tipo actual:</span>
          <CellTypeBadge cellType={currentCellType} />
        </div>
      </div>

      {/* Filters (Req 7.5) */}
      <div className="flex items-center gap-3 mb-3">
        <select
          value={filter.cellType}
          onChange={(e) =>
            setFilter((f) => ({ ...f, cellType: e.target.value }))
          }
          className="bg-gray-900 text-white rounded px-2 py-1 text-xs border border-gray-600 focus:border-blue-500 focus:outline-none"
          aria-label="Filtrar por tipo de célula"
        >
          <option value="">Todos los tipos</option>
          {cellTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>

        <div className="flex gap-1">
          {TIME_RANGES.map((range) => (
            <button
              key={range.value}
              type="button"
              onClick={() =>
                setFilter((f) => ({ ...f, timeRange: range.value }))
              }
              className={`px-2 py-1 rounded text-xs border ${
                filter.timeRange === range.value
                  ? "bg-blue-600 text-white border-blue-500"
                  : "bg-gray-900 text-gray-400 border-gray-600 hover:border-gray-500"
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>

        <span className="text-gray-500 text-xs ml-auto">
          {filteredMutations.length} mutaciones
        </span>
      </div>

      {/* Timeline */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {displayMutations.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-gray-500 text-3xl mb-3">
              <Dna size={32} className="mx-auto text-gray-500" />
            </div>
            <div className="text-gray-400 text-sm">
              Sin mutaciones registradas.
            </div>
            <div className="text-gray-500 text-xs mt-1">
              Usa el chat o fuerza una mutación desde Tools.
            </div>
          </div>
        ) : (
          displayMutations.map((mutation) => (
            <MutationRow key={mutation.id} mutation={mutation} />
          ))
        )}
      </div>
    </div>
  );
};

// ─── Sub-Components ─────────────────────────────────────────────────────────

function CellTypeBadge({ cellType }: Readonly<{ cellType: string }>) {
  const colors: Record<string, string> = {
    sensory: "bg-purple-600",
    sensory_advanced: "bg-purple-700",
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

function MutationRow({ mutation }: Readonly<{ mutation: MutationEvent }>) {
  const time = new Date(mutation.timestamp).toLocaleString();

  return (
    <div className="bg-gray-900 rounded-lg p-3 border border-gray-700">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-gray-500 text-xs">{time}</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <CellTypeBadge cellType={mutation.fromType} />
        <span className="text-gray-500">→</span>
        <CellTypeBadge cellType={mutation.toType} />
      </div>
      <div className="flex items-center gap-4 mt-2 text-xs">
        <div>
          <span className="text-gray-500">Fuente:</span>{" "}
          <span className="text-gray-300">{mutation.stimulusSource}</span>
        </div>
        <div>
          <span className="text-gray-500">Razón:</span>{" "}
          <span className="text-gray-300">{mutation.triggerReason}</span>
        </div>
      </div>
    </div>
  );
}

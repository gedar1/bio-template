import { Dna, Wrench, Clock } from "lucide-react";
import { useApi } from "../../hooks/useApi";
import { Tooltip } from "../Tooltip";
import type { StatusBarProps } from "./StatusBar.types";

interface ToolsData {
  tools?: Array<{ name: string }>;
  cellType?: string;
}

interface HealthData {
  status: string;
  uptime: number;
}

/**
 * IDE-style status bar at the bottom showing:
 * - System health (semaphore)
 * - Current cell type
 * - Active MCP tools count
 * - Uptime
 */
export const StatusBar: React.FC<StatusBarProps> = ({ tenantId }) => {
  const { data: toolsData } = useApi<ToolsData | Array<{ name: string }>>(
    `/api/tools?tenantId=${tenantId}`,
    5000,
  );
  const { data: healthData } = useApi<HealthData>("/health", 10000);

  // Handle both formats: array directly or { tools: [...] }
  const tools = Array.isArray(toolsData) ? toolsData : (toolsData?.tools ?? []);
  const cellType = Array.isArray(toolsData)
    ? "active"
    : (toolsData?.cellType ?? "undifferentiated");
  const toolCount = tools.length;
  const status = healthData?.status ?? "unknown";
  const uptime = healthData?.uptime ?? 0;

  const statusColors: Record<string, string> = {
    ok: "bg-green-500",
    degraded: "bg-yellow-500",
    down: "bg-red-500",
    unknown: "bg-gray-500",
  };

  const formatUptime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  return (
    <footer
      id="dashboard-footer"
      className="border-t border-gray-800 bg-gray-900 px-4 py-1.5 flex items-center gap-4 text-xs text-gray-400 shrink-0"
    >
      <Tooltip text={`Estado: ${status}`} position="top">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${statusColors[status]}`} />
          <span className="uppercase">{status}</span>
        </div>
      </Tooltip>

      <span className="text-gray-700">│</span>

      <Tooltip text="Tipo de célula activa" position="top">
        <div className="flex items-center gap-1">
          <Dna size={12} className="text-emerald-400" />
          <span className="text-gray-300 font-mono">{cellType}</span>
        </div>
      </Tooltip>

      <span className="text-gray-700">│</span>

      <Tooltip text="Herramientas MCP disponibles" position="top">
        <div className="flex items-center gap-1">
          <Wrench size={12} />
          <span>{toolCount} tools</span>
        </div>
      </Tooltip>

      <span className="text-gray-700">│</span>

      <Tooltip text="Tiempo activo del servidor" position="top">
        <div className="flex items-center gap-1">
          <Clock size={12} />
          <span>{formatUptime(uptime)}</span>
        </div>
      </Tooltip>

      <div className="ml-auto text-gray-600">BioCore v1.0.0</div>
    </footer>
  );
};

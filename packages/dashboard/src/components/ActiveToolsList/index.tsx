import type { ActiveToolsListProps } from "./ActiveToolsList.types";
import { useApi } from "../../hooks/useApi";
import { Tooltip } from "../Tooltip";
import { ToolIcon } from "../ToolIcon";

export const ActiveToolsList: React.FC<ActiveToolsListProps> = ({
  tenantId,
}) => {
  const { data } = useApi<
    | Array<{ name: string; description?: string }>
    | { tools?: Array<{ name: string; description?: string }> }
  >(`/api/tools?tenantId=${tenantId}`, 5000);

  // Handle both formats
  const tools: Array<{ name: string; description?: string }> = Array.isArray(
    data,
  )
    ? data
    : (data?.tools ?? []);

  return (
    <div className="border-t border-gray-800 py-2 mt-auto">
      <div className="text-[9px] text-gray-500 uppercase tracking-wide mb-1.5 text-center">
        Tools ({tools.length})
      </div>
      {tools.length === 0 ? (
        <div className="text-gray-600 text-[10px] text-center">—</div>
      ) : (
        <div className="flex flex-col items-center gap-1">
          {tools.map((tool) => {
            const tooltipText = tool.description
              ? `${tool.name} — ${tool.description}`
              : tool.name;

            return (
              <Tooltip key={tool.name} text={tooltipText} position="right">
                <div className="w-10 h-10 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-400 hover:border-gray-500 hover:text-gray-200 transition-colors cursor-default">
                  <ToolIcon name={tool.name} />
                </div>
              </Tooltip>
            );
          })}
        </div>
      )}
    </div>
  );
};

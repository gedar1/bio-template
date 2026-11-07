import type { ToolInputSchema } from "../../types/dashboard";

export interface ToolsPanelProps {
  tenantId: string;
}

export interface Tool {
  name: string;
  description?: string;
  category?: string;
  inputSchema?: ToolInputSchema;
}

export interface ToolsData {
  tools: Tool[];
  cellType: string;
  mutationState: string;
}

export interface RegistryCellOption {
  readonly type: string;
  readonly description: string;
}

import type { ToolInputSchema, FormField } from "../../types/dashboard";

export interface ToolInvokerProps {
  readonly tenantId: string;
  readonly toolName: string;
  readonly schema?: ToolInputSchema;
  readonly onClose: () => void;
}

export interface InvokerFieldProps {
  readonly field: FormField;
  readonly value: string;
  readonly onChange: (value: string) => void;
}

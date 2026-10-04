import type { TaskTemplate, TemplateParameter } from "../../types/dashboard";

export interface TemplateSelectorProps {
  readonly tenantId: string;
  readonly onSelect: (
    template: TaskTemplate,
    values: Record<string, string | number>,
  ) => void;
}

export interface ParameterFieldProps {
  readonly param: TemplateParameter;
  readonly value: string;
  readonly error?: string;
  readonly onChange: (value: string) => void;
}

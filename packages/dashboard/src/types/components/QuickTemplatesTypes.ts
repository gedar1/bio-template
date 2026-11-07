export interface TemplateExecutionResult {
  templateName: string;
  templateId: string;
  category: string;
  steps: string[];
  args: Record<string, unknown>;
  success: boolean;
  results: string[];
  error?: string;
}

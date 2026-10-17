import { ValidationError } from "../errors.js";
import type {
  JSONSchemaObject,
  JSONSchemaType,
  LLMTool,
} from "../system/providers/providerTypes.js";

export interface AnthropicToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly input_schema: JSONSchemaObject & { readonly type: "object" };
}
export interface OpenAIToolDefinition {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: JSONSchemaObject;
  };
}
export interface GeminiToolDefinition {
  readonly functionDeclarations: readonly {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  }[];
}

function objectSchema(
  tool: LLMTool,
): JSONSchemaObject & { readonly type: "object" } {
  const schema = tool.inputSchema;
  if (schema.type !== undefined && schema.type !== "object")
    throw new ValidationError(`La tool ${tool.name} requiere un schema object`);
  return { ...schema, type: "object" };
}
function geminiType(type: JSONSchemaType | undefined): string {
  return (type ?? "string").toUpperCase();
}
function toGeminiSchema(schema: JSONSchemaObject): Record<string, unknown> {
  const result: Record<string, unknown> = { type: geminiType(schema.type) };
  if (schema.description) result.description = schema.description;
  if (schema.required) result.required = [...schema.required];
  if (schema.enum) result.enum = [...schema.enum];
  if (schema.properties) {
    const properties: Record<string, unknown> = {};
    for (const [name, child] of Object.entries(schema.properties))
      properties[name] = toGeminiSchema(child);
    result.properties = properties;
  }
  if (schema.items) result.items = toGeminiSchema(schema.items);
  if (schema.additionalProperties !== undefined)
    result.additionalProperties = schema.additionalProperties;
  return result;
}

export function formatToolsForAnthropic(
  tools: readonly LLMTool[],
): AnthropicToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    input_schema: objectSchema(tool),
  }));
}
export function formatToolsForOpenAI(
  tools: readonly LLMTool[],
): OpenAIToolDefinition[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: objectSchema(tool),
    },
  }));
}
export function formatToolsForGemini(
  tools: readonly LLMTool[],
): GeminiToolDefinition[] {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
        parameters: toGeminiSchema(objectSchema(tool)),
      })),
    },
  ];
}

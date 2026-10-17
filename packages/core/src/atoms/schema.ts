import { ValidationError } from "../errors.js";
import type {
  JSONSchemaObject,
  LLMTool,
} from "../system/providers/providerTypes.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJsonSchema(value: unknown, path: string): JSONSchemaObject {
  if (!isRecord(value))
    throw new ValidationError(`Schema no representable en ${path}`);
  const allowed = new Set([
    "type",
    "properties",
    "required",
    "items",
    "enum",
    "description",
    "additionalProperties",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      throw new ValidationError(
        `Keyword de schema no admitida en ${path}: ${key}`,
      );
  }
  const type = value.type;
  if (
    type !== undefined &&
    ![
      "object",
      "array",
      "string",
      "number",
      "integer",
      "boolean",
      "null",
    ].includes(String(type))
  ) {
    throw new ValidationError(`Tipo de schema no admitido en ${path}`);
  }
  const propertiesValue = value.properties;
  let properties: Readonly<Record<string, JSONSchemaObject>> | undefined;
  if (propertiesValue !== undefined) {
    if (!isRecord(propertiesValue))
      throw new ValidationError(`properties inválido en ${path}`);
    const next: Record<string, JSONSchemaObject> = {};
    for (const [name, child] of Object.entries(propertiesValue))
      next[name] = cloneJsonSchema(child, `${path}.properties.${name}`);
    properties = next;
  }
  const requiredValue = value.required;
  let required: readonly string[] | undefined;
  if (requiredValue !== undefined) {
    if (
      !Array.isArray(requiredValue) ||
      !requiredValue.every((item) => typeof item === "string")
    )
      throw new ValidationError(`required inválido en ${path}`);
    required = requiredValue;
    for (const name of required)
      if (!properties || !(name in properties))
        throw new ValidationError(`required no definido en ${path}: ${name}`);
  }
  const enumValue = value.enum;
  if (
    enumValue !== undefined &&
    (!Array.isArray(enumValue) || !enumValue.every(isJsonValue))
  )
    throw new ValidationError(`enum inválido en ${path}`);
  const items =
    value.items === undefined
      ? undefined
      : cloneJsonSchema(value.items, `${path}.items`);
  return {
    ...(type !== undefined ? { type: type as JSONSchemaObject["type"] } : {}),
    ...(typeof value.description === "string"
      ? { description: value.description }
      : {}),
    ...(properties ? { properties } : {}),
    ...(required ? { required } : {}),
    ...(items ? { items } : {}),
    ...(enumValue !== undefined
      ? { enum: enumValue as JSONSchemaObject["enum"] }
      : {}),
    ...(typeof value.additionalProperties === "boolean"
      ? { additionalProperties: value.additionalProperties }
      : {}),
  };
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

export function cleanSchemaForLLM(schema: unknown): JSONSchemaObject {
  return cloneJsonSchema(schema, "inputSchema");
}

export function deduplicateTools(tools: readonly LLMTool[]): LLMTool[] {
  const unique = new Map<string, LLMTool>();
  for (const tool of tools) {
    if (!unique.has(tool.name))
      unique.set(tool.name, {
        ...tool,
        inputSchema: cleanSchemaForLLM(tool.inputSchema),
      });
  }
  return [...unique.values()];
}

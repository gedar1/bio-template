import type {
  ToolInputSchema,
  FormField,
  SchemaPropertyType,
} from "../types/dashboard";

/**
 * Converts a tool input schema to an array of form field descriptors.
 * Each schema property becomes one form field with correct type and required flag.
 */
export function schemaToFormFields(schema: ToolInputSchema): FormField[] {
  const requiredSet = new Set(schema.required ?? []);
  const fields: FormField[] = [];

  for (const [key, prop] of Object.entries(schema.properties)) {
    const type: SchemaPropertyType = isValidType(prop.type)
      ? prop.type
      : "string";

    fields.push({
      key,
      type,
      label: prop.description ?? key,
      required: requiredSet.has(key) || prop.required === true,
      description: prop.description,
    });
  }

  return fields;
}

function isValidType(type: string): type is SchemaPropertyType {
  return type === "string" || type === "number" || type === "boolean";
}

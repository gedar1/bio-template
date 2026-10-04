/**
 * Funciones puras para transformación de schemas JSON.
 * Sin estado, sin efectos secundarios.
 */

/**
 * Limpia un schema JSON para compatibilidad universal con LLMs (Gemini/Claude).
 * Remueve campos no estándar que pueden causar errores en algunos providers.
 */
export function cleanSchemaForLLM(schema: any): any {
  if (!schema || typeof schema !== "object" || Array.isArray(schema))
    return schema;

  const cleaned: any = {};
  const allowedFields = [
    "type", "properties", "required", "items", "enum", "description", "format",
  ];

  for (const field of allowedFields) {
    if (schema[field] !== undefined) cleaned[field] = schema[field];
  }

  if (cleaned.properties && typeof cleaned.properties === "object") {
    const newProps: any = {};
    for (const [key, value] of Object.entries(cleaned.properties)) {
      newProps[key] = cleanSchemaForLLM(value);
    }
    cleaned.properties = newProps;
  }

  return cleaned;
}

/**
 * Deduplica un array de herramientas MCP por nombre.
 * La primera ocurrencia gana. Limpia schemas automáticamente.
 */
export function deduplicateTools(tools: any[]): any[] {
  const uniqueMap = new Map();
  tools.forEach((t) => {
    if (!uniqueMap.has(t.name)) {
      uniqueMap.set(t.name, {
        ...t,
        inputSchema: cleanSchemaForLLM(t.inputSchema),
      });
    }
  });
  return Array.from(uniqueMap.values());
}

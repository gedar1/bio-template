/**
 * Funciones puras para formatear herramientas MCP al formato de cada LLM provider.
 * Sin estado, sin efectos secundarios.
 */

/**
 * Convierte herramientas MCP unificadas al formato que espera Anthropic Claude.
 */
export function formatToolsForAnthropic(tools: any[]): any[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description || "",
    input_schema: {
      type: "object",
      properties: t.inputSchema.properties,
      required: t.inputSchema.required,
    },
  }));
}

/**
 * Convierte herramientas MCP unificadas al formato OpenAI-compatible (NVIDIA, OpenAI, etc.).
 */
export function formatToolsForOpenAI(tools: any[]): any[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description || "",
      parameters: {
        type: "object",
        properties: t.inputSchema.properties,
        required: t.inputSchema.required || [],
      },
    },
  }));
}

/**
 * Convierte herramientas MCP unificadas al formato que espera Google Gemini.
 */
export function formatToolsForGemini(tools: any[]): any[] {
  const functionDeclarations = tools.map((t) => {
    const properties: any = {};
    for (const [key, val] of Object.entries(t.inputSchema.properties)) {
      properties[key] = {
        type: (val as any).type?.toUpperCase() || "STRING",
        description: (val as any).description || "",
      };
    }
    return {
      name: t.name,
      description: t.description || "",
      parameters: {
        type: "OBJECT",
        properties,
        required: t.inputSchema.required || [],
      },
    };
  });
  return [{ functionDeclarations }];
}

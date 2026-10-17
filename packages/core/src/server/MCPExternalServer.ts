/**
 * MCPExternalServer — Expone BioCore como servidor MCP externo.
 *
 * Permite que IDEs (VS Code + Copilot, Kiro, Claude Code, Cursor)
 * consuman BioCore como proveedor de herramientas via MCP protocol.
 *
 * Uso en mcp.json del IDE:
 * {
 *   "mcpServers": {
 *     "biocore": {
 *       "command": "node",
 *       "args": ["dist/biocore/server/MCPExternalServer.js"]
 *     }
 *   }
 * }
 *
 * El servidor expone herramientas de alto nivel que internamente
 * orquestan la mutación + ejecución de BioCore completo.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { BaseOrganisms } from "../organisms/BaseOrganisms.js";
import { createLogger } from "../config/logger.js";
import { TenantManager, type TenantManagerDeps } from "./TenantManager.js";

dotenv.config();

const log = createLogger("MCPExternalServer");

class MCPOrganism extends BaseOrganisms {
  constructor() {
    super("MCP-External");
  }
  async process(intention: unknown): Promise<unknown> {
    return intention;
  }
}

/**
 * Servidor MCP que expone BioCore como herramienta para IDEs externos.
 * Cada tool call del IDE pasa por el orquestador completo de BioCore.
 */
export class MCPExternalServer {
  private readonly server: McpServer;
  private readonly tenantManager: TenantManager;

  constructor(deps: TenantManagerDeps = {}) {
    this.server = new McpServer({
      name: "biocore",
      version: "1.0.0",
    });
    // MCP standalone has no platform registry or metrics unless explicitly injected.
    this.tenantManager = new TenantManager(deps);
    this.registerTools();
  }

  private registerTools(): void {
    // ─── Herramienta principal: ejecutar tarea completa ───────────────────────
    this.server.registerTool(
      "biocore_execute",
      {
        description: [
          "Ejecuta una tarea de automatización usando BioCore.",
          "BioCore puede: scrapear webs, guardar en base de datos, leer/escribir archivos,",
          "enviar emails, ejecutar comandos CLI, hacer peticiones HTTP, operar con Git.",
          "Describe la tarea en lenguaje natural y BioCore la resuelve automáticamente.",
          "Ejemplos: 'Scrapea https://example.com y guarda el contenido en la BD',",
          "'Lee el archivo config.json y extrae las URLs', 'Envía un email con el reporte'.",
        ].join(" "),
        inputSchema: {
          task: z
            .string()
            .describe("Descripción de la tarea a ejecutar en lenguaje natural"),
          tenantId: z
            .string()
            .optional()
            .describe("ID del tenant (default: 'mcp-external')"),
        },
      },
      async ({ task, tenantId }) => {
        const tid = tenantId || "mcp-external";
        try {
          const response = await this.tenantManager.chat(tid, task);
          return {
            content: [
              { type: "text" as const, text: response || "Tarea completada." },
            ],
          };
        } catch (error: any) {
          log.error({ error: error.message, task }, "Error ejecutando tarea");
          return {
            content: [
              { type: "text" as const, text: `Error: ${error.message}` },
            ],
            isError: true,
          };
        }
      },
    );

    // ─── Scraping directo ────────────────────────────────────────────────────
    this.server.registerTool(
      "biocore_scrape",
      {
        description:
          "Scrapea una URL y devuelve su contenido. Opcionalmente guarda en la base de datos.",
        inputSchema: {
          url: z.string().url().describe("URL a scrapear"),
          saveToDb: z
            .boolean()
            .optional()
            .describe("Si true, guarda el contenido en la BD"),
          table: z
            .string()
            .optional()
            .describe(
              "Nombre de la tabla donde guardar (default: 'scraped_data')",
            ),
        },
      },
      async ({ url, saveToDb, table }) => {
        const tid = "mcp-external";
        const saveInstruction = saveToDb
          ? ` y guarda el resultado en la tabla ${table || "scraped_data"} de la BD`
          : "";
        const task = `Scrapea ${url}${saveInstruction}`;

        try {
          const response = await this.tenantManager.chat(tid, task);
          return {
            content: [
              {
                type: "text" as const,
                text: response || "Scraping completado.",
              },
            ],
          };
        } catch (error: any) {
          return {
            content: [
              { type: "text" as const, text: `Error: ${error.message}` },
            ],
            isError: true,
          };
        }
      },
    );

    // ─── Consulta a base de datos ────────────────────────────────────────────
    this.server.registerTool(
      "biocore_db_query",
      {
        description: "Ejecuta una consulta SQL en la base de datos de BioCore.",
        inputSchema: {
          query: z.string().describe("Consulta SQL a ejecutar"),
        },
      },
      async ({ query }) => {
        const tid = "mcp-external";
        const task = `Ejecuta esta consulta en la base de datos: ${query}`;

        try {
          const response = await this.tenantManager.chat(tid, task);
          return {
            content: [
              {
                type: "text" as const,
                text: response || "Consulta ejecutada.",
              },
            ],
          };
        } catch (error: any) {
          return {
            content: [
              { type: "text" as const, text: `Error: ${error.message}` },
            ],
            isError: true,
          };
        }
      },
    );

    // ─── Operaciones HTTP ────────────────────────────────────────────────────
    this.server.registerTool(
      "biocore_http",
      {
        description:
          "Realiza una petición HTTP (GET, POST, PUT, DELETE) a una URL.",
        inputSchema: {
          method: z
            .enum(["GET", "POST", "PUT", "DELETE"])
            .describe("Método HTTP"),
          url: z.string().url().describe("URL destino"),
          body: z
            .string()
            .optional()
            .describe("Body de la petición (JSON string)"),
          headers: z
            .string()
            .optional()
            .describe("Headers adicionales (JSON string)"),
        },
      },
      async ({ method, url, body, headers }) => {
        const tid = "mcp-external";
        let task = `Haz una petición HTTP ${method} a ${url}`;
        if (body) task += ` con body: ${body}`;
        if (headers) task += ` con headers: ${headers}`;

        try {
          const response = await this.tenantManager.chat(tid, task);
          return {
            content: [
              {
                type: "text" as const,
                text: response || "Petición completada.",
              },
            ],
          };
        } catch (error: any) {
          return {
            content: [
              { type: "text" as const, text: `Error: ${error.message}` },
            ],
            isError: true,
          };
        }
      },
    );

    // ─── Operaciones Git ─────────────────────────────────────────────────────
    this.server.registerTool(
      "biocore_git",
      {
        description:
          "Ejecuta operaciones Git: status, commit, push, pull, branches.",
        inputSchema: {
          operation: z
            .string()
            .describe(
              "Operación a realizar (ej: 'commit con mensaje fix: typo', 'push', 'status', 'crear branch feature/x')",
            ),
        },
      },
      async ({ operation }) => {
        const tid = "mcp-external";
        const task = `Ejecuta la operación Git: ${operation}`;

        try {
          const response = await this.tenantManager.chat(tid, task);
          return {
            content: [
              {
                type: "text" as const,
                text: response || "Operación Git completada.",
              },
            ],
          };
        } catch (error: any) {
          return {
            content: [
              { type: "text" as const, text: `Error: ${error.message}` },
            ],
            isError: true,
          };
        }
      },
    );

    // ─── Envío de email ──────────────────────────────────────────────────────
    this.server.registerTool(
      "biocore_email",
      {
        description: "Envía un email usando Gmail.",
        inputSchema: {
          to: z.string().describe("Dirección de email del destinatario"),
          subject: z.string().describe("Asunto del email"),
          body: z.string().describe("Contenido del email"),
        },
      },
      async ({ to, subject, body }) => {
        const tid = "mcp-external";
        const task = `Envía un email a ${to} con asunto "${subject}" y contenido: ${body}`;

        try {
          const response = await this.tenantManager.chat(tid, task);
          return {
            content: [
              { type: "text" as const, text: response || "Email enviado." },
            ],
          };
        } catch (error: any) {
          return {
            content: [
              { type: "text" as const, text: `Error: ${error.message}` },
            ],
            isError: true,
          };
        }
      },
    );

    // ─── Ejecución de comandos CLI ───────────────────────────────────────────
    this.server.registerTool(
      "biocore_cli",
      {
        description:
          "Ejecuta un comando CLI en el sistema (ffmpeg, imagemagick, curl, etc.).",
        inputSchema: {
          command: z.string().describe("Comando a ejecutar"),
        },
      },
      async ({ command }) => {
        const tid = "mcp-external";
        const task = `Ejecuta el comando CLI: ${command}`;

        try {
          const response = await this.tenantManager.chat(tid, task);
          return {
            content: [
              { type: "text" as const, text: response || "Comando ejecutado." },
            ],
          };
        } catch (error: any) {
          return {
            content: [
              { type: "text" as const, text: `Error: ${error.message}` },
            ],
            isError: true,
          };
        }
      },
    );

    // ─── Estado del sistema ──────────────────────────────────────────────────
    this.server.registerTool(
      "biocore_status",
      {
        description:
          "Muestra el estado actual de BioCore: tenant activo, tipo de célula, herramientas disponibles y métricas.",
        inputSchema: {},
      },
      async () => {
        const tid = "mcp-external";
        try {
          const tenant = await this.tenantManager.getTenant(tid);
          const tools = await tenant.cortex.getUnifiedTools();
          const perf = tenant.cortex.getPerfSummary();

          const status = [
            `🧬 BioCore Status`,
            `├─ Tenant: ${tid}`,
            `├─ Herramientas activas: ${tools.map((t) => t.name).join(", ")}`,
            `├─ Historial: ${tenant.cortex.getHistory().length} mensajes`,
            `└─ Métricas: ${JSON.stringify(perf)}`,
          ].join("\n");

          return {
            content: [{ type: "text" as const, text: status }],
          };
        } catch (error: any) {
          return {
            content: [
              { type: "text" as const, text: `Error: ${error.message}` },
            ],
            isError: true,
          };
        }
      },
    );
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    log.info("MCPExternalServer iniciando via stdio");
    await this.server.connect(transport);
    log.info(
      "BioCore MCP Server conectado — listo para recibir tool calls de IDEs",
    );
  }
}

// ─── Punto de entrada ────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = new MCPExternalServer();
  try {
    await server.run();
  } catch (error) {
    console.error("Error iniciando MCPExternalServer:", error);
    process.exit(1);
  }
}

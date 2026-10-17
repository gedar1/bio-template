/**
 * MCPHttpServer — Expone BioCore como servidor MCP via HTTP (Streamable HTTP Transport).
 *
 * Permite que IDEs remotos se conecten a BioCore sin necesidad de clonar el proyecto.
 * Cada desarrollador del equipo solo necesita agregar esto a su mcp.json:
 *
 * {
 *   "mcpServers": {
 *     "biocore": {
 *       "type": "streamable-http",
 *       "url": "http://servidor:3100/mcp"
 *     }
 *   }
 * }
 *
 * Soporta múltiples conexiones simultáneas (un transport por sesión).
 */

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import * as dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { createLogger } from "../config/logger.js";
import { TenantManager, type TenantManagerDeps } from "./TenantManager.js";

dotenv.config();

const log = createLogger("MCPHttpServer");

/**
 * Crea un McpServer con todas las herramientas de BioCore registradas.
 */
function createBiocoreMcpServer(tenantManager: TenantManager): McpServer {
  const server = new McpServer({
    name: "biocore",
    version: "1.0.0",
  });

  // ─── Herramienta principal: ejecutar tarea completa ─────────────────────
  server.registerTool(
    "biocore_execute",
    {
      description: [
        "Ejecuta una tarea de automatización usando BioCore.",
        "BioCore puede: scrapear webs, guardar en base de datos, leer/escribir archivos,",
        "enviar emails, ejecutar comandos CLI, hacer peticiones HTTP, operar con Git.",
        "Describe la tarea en lenguaje natural y BioCore la resuelve automáticamente.",
      ].join(" "),
      inputSchema: {
        task: z
          .string()
          .describe("Descripción de la tarea en lenguaje natural"),
        tenantId: z
          .string()
          .optional()
          .describe("ID del tenant (default: 'mcp-remote')"),
      },
    },
    async ({ task, tenantId }) => {
      const tid = tenantId || "mcp-remote";
      try {
        const response = await tenantManager.chat(tid, task);
        return {
          content: [
            { type: "text" as const, text: response || "Tarea completada." },
          ],
        };
      } catch (error: any) {
        log.error({ error: error.message, task }, "Error ejecutando tarea");
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );

  // ─── Scraping ──────────────────────────────────────────────────────────
  server.registerTool(
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
          .describe("Tabla donde guardar (default: 'scraped_data')"),
      },
    },
    async ({ url, saveToDb, table }) => {
      const tid = "mcp-remote";
      const saveInstruction = saveToDb
        ? ` y guarda el resultado en la tabla ${table || "scraped_data"} de la BD`
        : "";
      try {
        const response = await tenantManager.chat(
          tid,
          `Scrapea ${url}${saveInstruction}`,
        );
        return {
          content: [
            { type: "text" as const, text: response || "Scraping completado." },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );

  // ─── Base de datos ─────────────────────────────────────────────────────
  server.registerTool(
    "biocore_db_query",
    {
      description: "Ejecuta una consulta SQL en la base de datos de BioCore.",
      inputSchema: { query: z.string().describe("Consulta SQL a ejecutar") },
    },
    async ({ query }) => {
      try {
        const response = await tenantManager.chat(
          "mcp-remote",
          `Ejecuta esta consulta en la base de datos: ${query}`,
        );
        return {
          content: [
            { type: "text" as const, text: response || "Consulta ejecutada." },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );

  // ─── HTTP ──────────────────────────────────────────────────────────────
  server.registerTool(
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
      },
    },
    async ({ method, url, body }) => {
      let task = `Haz una petición HTTP ${method} a ${url}`;
      if (body) task += ` con body: ${body}`;
      try {
        const response = await tenantManager.chat("mcp-remote", task);
        return {
          content: [
            { type: "text" as const, text: response || "Petición completada." },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );

  // ─── Git ───────────────────────────────────────────────────────────────
  server.registerTool(
    "biocore_git",
    {
      description:
        "Ejecuta operaciones Git: status, commit, push, pull, branches.",
      inputSchema: {
        operation: z
          .string()
          .describe(
            "Operación Git (ej: 'commit con mensaje fix: typo', 'push', 'status')",
          ),
      },
    },
    async ({ operation }) => {
      try {
        const response = await tenantManager.chat(
          "mcp-remote",
          `Ejecuta la operación Git: ${operation}`,
        );
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
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );

  // ─── Email ─────────────────────────────────────────────────────────────
  server.registerTool(
    "biocore_email",
    {
      description: "Envía un email usando Gmail.",
      inputSchema: {
        to: z.string().describe("Email del destinatario"),
        subject: z.string().describe("Asunto"),
        body: z.string().describe("Contenido del email"),
      },
    },
    async ({ to, subject, body }) => {
      try {
        const response = await tenantManager.chat(
          "mcp-remote",
          `Envía un email a ${to} con asunto "${subject}" y contenido: ${body}`,
        );
        return {
          content: [
            { type: "text" as const, text: response || "Email enviado." },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );

  // ─── CLI ───────────────────────────────────────────────────────────────
  server.registerTool(
    "biocore_cli",
    {
      description:
        "Ejecuta un comando CLI en el sistema (ffmpeg, imagemagick, curl, etc.).",
      inputSchema: { command: z.string().describe("Comando a ejecutar") },
    },
    async ({ command }) => {
      try {
        const response = await tenantManager.chat(
          "mcp-remote",
          `Ejecuta el comando CLI: ${command}`,
        );
        return {
          content: [
            { type: "text" as const, text: response || "Comando ejecutado." },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );

  // ─── Status ────────────────────────────────────────────────────────────
  server.registerTool(
    "biocore_status",
    {
      description:
        "Muestra el estado actual de BioCore: herramientas activas, métricas y reflexes.",
      inputSchema: {},
    },
    async () => {
      try {
        const tenant = await tenantManager.getTenant("mcp-remote");
        const tools = await tenant.cortex.getUnifiedTools();
        const perf = tenant.cortex.getPerfSummary();
        const status = [
          "🧬 BioCore Status",
          `├─ Herramientas activas: ${tools.map((t) => t.name).join(", ")}`,
          `├─ Historial: ${tenant.cortex.getHistory().length} mensajes`,
          `└─ Métricas: ${JSON.stringify(perf)}`,
        ].join("\n");
        return { content: [{ type: "text" as const, text: status }] };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );

  return server;
}

// ─── HTTP Server con Streamable HTTP Transport ────────────────────────────────

export async function startMCPHttpServer(
  port: number = 3100,
  deps: TenantManagerDeps = {},
): Promise<void> {
  // MCP standalone has no platform registry or metrics unless explicitly injected.
  const tenantManager = new TenantManager(deps);
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      // CORS
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, DELETE, OPTIONS",
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, mcp-session-id",
      );
      res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = req.url || "/";

      // Health check
      if (url === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            transport: "streamable-http",
            sessions: transports.size,
          }),
        );
        return;
      }

      // MCP endpoint
      if (url === "/mcp") {
        // Obtener o crear session
        const sessionId = req.headers["mcp-session-id"] as string | undefined;

        if (sessionId && transports.has(sessionId)) {
          // Sesión existente — delegar al transport
          const transport = transports.get(sessionId)!;
          await transport.handleRequest(req, res);
          return;
        }

        if (req.method === "POST" && !sessionId) {
          // Nueva sesión — crear transport y MCP server
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
          });

          const mcpServer = createBiocoreMcpServer(tenantManager);
          await mcpServer.connect(transport);

          // Guardar transport por session ID después de conectar
          const newSessionId = transport.sessionId;
          if (newSessionId) {
            transports.set(newSessionId, transport);
            log.info({ sessionId: newSessionId }, "Nueva sesión MCP creada");

            transport.onclose = () => {
              transports.delete(newSessionId);
              log.info({ sessionId: newSessionId }, "Sesión MCP cerrada");
            };
          }

          await transport.handleRequest(req, res);
          return;
        }

        // Session ID inválido
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: "Sesión no encontrada o request inválido" }),
        );
        return;
      }

      // 404
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Not found. Use /mcp para MCP protocol o /health para status.",
        }),
      );
    },
  );

  httpServer.listen(port, () => {
    log.info(
      { port, url: `http://localhost:${port}/mcp` },
      "BioCore MCP HTTP Server listo",
    );
    console.log(
      `\n🧬 BioCore MCP Server corriendo en http://localhost:${port}/mcp`,
    );
    console.log(`\nPara conectar desde un IDE, agrega a tu mcp.json:`);
    console.log(
      JSON.stringify(
        {
          mcpServers: {
            biocore: {
              type: "streamable-http",
              url: `http://localhost:${port}/mcp`,
            },
          },
        },
        null,
        2,
      ),
    );
  });

  // Graceful shutdown
  process.on("SIGINT", () => {
    log.info("Cerrando MCP HTTP Server...");
    for (const transport of transports.values()) {
      transport.close();
    }
    httpServer.close(() => {
      log.info("Servidor cerrado correctamente");
      process.exit(0);
    });
  });
}

// ─── Punto de entrada ────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.MCP_HTTP_PORT) || 3100;
  startMCPHttpServer(port);
}

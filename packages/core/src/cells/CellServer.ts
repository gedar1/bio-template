import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { getModuleDir } from "../atoms/paths.js";

// Importar todas las moléculas
import { DatabaseMolecule } from "../molecules/DatabaseMolecule.js";
import { HTTPMolecule } from "../molecules/HTTPMolecule.js";
import { FileSystemMolecule } from "../molecules/FileSystemMolecule.js";
import { GmailMolecule } from "../molecules/GmailMolecule.js";
import { GitMolecule } from "../molecules/GitMolecule.js";
import { ScraperMolecule } from "../molecules/ScraperMolecule.js";
import { SystemMolecule } from "../molecules/SystemMolecule.js";
import { WhatsAppMolecule } from "../molecules/WhatsAppMolecule.js";
import { WebSocketMolecule } from "../molecules/WebSocketMolecule.js";

import { CommandSchema, FilePathSchema } from "../config/validators.js";
import { createLogger } from "../config/logger.js";
import { RateLimiter } from "../infrastructure/RateLimiter.js";
import { MutationError, MoleculeError } from "../errors.js";

const log = createLogger("CellServer");
import type { IDatabase } from "../molecules/interfaces/IDatabase.js";
import type { CellTypeDefinition } from "../atoms/index.js";
import { resolveTools } from "../atoms/index.js";

const require = createRequire(import.meta.url);
const __dirname = getModuleDir(import.meta.url);

// ─── Carga el Registry externo ────────────────────────────────────────────────
const registry = require(join(__dirname, "../config/registry.json")) as {
  cells: CellTypeDefinition[];
};

const validTypes = registry.cells.map((c) => c.type) as [string, ...string[]];
const typeDescriptions = registry.cells
  .map((c) => `'${c.type}': ${c.description}`)
  .join(" | ");

/**
 * Servidor MCP BioCore con moléculas completas.
 * Esta célula muta dinámicamente para exponer diferentes capacidades.
 */
export class CellServer {
  readonly server: McpServer;
  public currentType: string = "undifferentiated";

  // Moléculas (instanciadas bajo demanda)
  private database: IDatabase | null = null;
  private http: HTTPMolecule | null = null;
  private filesystem: FileSystemMolecule | null = null;
  private gmail: GmailMolecule | null = null;
  private git: GitMolecule | null = null;
  private scraper: ScraperMolecule | null = null;
  private system: SystemMolecule | null = null;
  private whatsapp: WhatsAppMolecule | null = null;
  private websocket: WebSocketMolecule | null = null;

  // Rate limiters para herramientas sensibles
  readonly cliLimiter = new RateLimiter({
    name: "execute_cli",
    maxCalls: 10,
    windowMs: 60000,
  });
  readonly emailLimiter = new RateLimiter({
    name: "send_email",
    maxCalls: 5,
    windowMs: 60000,
  });

  /** Tipos de célula permitidos para este servidor (filtrado por perfil) */
  private readonly allowedCells: string[];

  /** ID del tenant que opera este CellServer */
  private readonly tenantId: string;

  /** Ruta de la BD específica del tenant */
  private readonly tenantDbPath: string;

  constructor(allowedCells?: string[], tenantId?: string) {
    // Si se pasan allowedCells, filtrar; si no, usar todos los del registry
    this.allowedCells = allowedCells
      ? allowedCells.filter((c) => validTypes.includes(c))
      : [...validTypes];

    // TenantId para aislar datos de negocio
    this.tenantId = tenantId || process.env.BIOCORE_TENANT_ID || "default";

    // Ruta de BD del tenant (data/tenants/{tenantId}.db)
    const dataDir = process.env.DATABASE_DIR || "./data";
    const safeName = this.tenantId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const tenantsDir = `${dataDir}/tenants`;
    if (!existsSync(tenantsDir)) {
      mkdirSync(tenantsDir, { recursive: true });
    }
    this.tenantDbPath = join(tenantsDir, `${safeName}.db`);

    this.server = new McpServer({
      name: "biocore-cell",
      version: "1.0.0",
    });

    this.setupBaseTools();
  }

  /**
   * Registra la herramienta base que toda Célula tiene al iniciar.
   */
  private setupBaseTools() {
    // Filtrar tipos y descripciones según allowedCells
    const filteredCells = registry.cells.filter(
      (c) =>
        this.allowedCells.includes(c.type) && c.type !== "undifferentiated",
    );
    const filteredTypes = filteredCells.map((c) => c.type) as [
      string,
      ...string[],
    ];
    const filteredDescriptions = filteredCells
      .map((c) => `'${c.type}': ${c.description}`)
      .join(" | ");

    this.server.registerTool(
      "stimulate_differentiation",
      {
        description: `Muta la célula a un perfil especializado con nuevas herramientas. Tipos disponibles: ${filteredDescriptions}`,
        inputSchema: {
          type: z
            .enum(
              filteredTypes.length > 0
                ? filteredTypes
                : (["undifferentiated"] as [string, ...string[]]),
            )
            .describe(filteredDescriptions || "Sin tipos disponibles"),
        },
      },
      async ({ type }) => {
        await this.disposeMolecules();
        this.currentType = type;

        // Resolver herramientas incluyendo las heredadas del parent
        const resolvedToolNames = resolveTools(type, registry.cells);
        log.info(
          { type, tools: resolvedToolNames },
          "Herramientas resueltas (con herencia)",
        );

        await this.initializeMolecules(type);
        this.registerToolsForType(type);

        // Si tiene parent, también inicializar y registrar herramientas del parent
        const cellDef = registry.cells.find((c) => c.type === type);
        if (cellDef?.parent) {
          await this.initializeMolecules(cellDef.parent);
          this.registerToolsForType(cellDef.parent);
        }

        log.info({ type: this.currentType }, "Mutación exitosa");
        return {
          content: [
            {
              type: "text" as const,
              text: `Célula diferenciada exitosamente como '${type}'.`,
            },
          ],
        };
      },
    );
  }

  /**
   * Limpia las moléculas del perfil anterior antes de mutar.
   * Cierra conexiones abiertas y libera referencias.
   */
  private async disposeMolecules(): Promise<void> {
    try {
      if (this.database) {
        await this.database.close();
        this.database = null;
      }
      if (this.gmail) {
        this.gmail = null;
      }
      this.http = null;
      this.filesystem = null;
      this.git = null;
      this.scraper = null;
      this.system = null;
      this.whatsapp = null;
      this.websocket?.dispose().catch(() => {});
      this.websocket = null;

      log.debug(
        { previousType: this.currentType },
        "Moléculas anteriores liberadas",
      );
    } catch (error: any) {
      log.warn({ error: error.message }, "Error durante dispose de moléculas");
    }
  }

  /**
   * Inicializa las moléculas según el tipo de célula
   */
  private async initializeMolecules(type: string): Promise<void> {
    try {
      switch (type) {
        case "memory":
          this.database = DatabaseMolecule.create();
          await this.database.connect();
          break;

        case "http":
          this.http = new HTTPMolecule();
          break;

        case "filesystem":
          this.filesystem = new FileSystemMolecule();
          break;

        case "communication":
          this.gmail = new GmailMolecule();
          await this.gmail.connect();
          try {
            this.whatsapp = new WhatsAppMolecule();
          } catch {
            // WhatsApp es opcional — si no hay config de Twilio, se ignora
          }
          break;

        case "versioncontrol":
          this.git = new GitMolecule();
          break;

        case "sensory":
          this.scraper = new ScraperMolecule();
          this.http = new HTTPMolecule();
          break;

        case "system":
          this.system = new SystemMolecule();
          break;

        case "realtime":
          this.websocket = new WebSocketMolecule();
          await this.websocket.initialize();
          this.http = new HTTPMolecule();
          break;
      }
    } catch (error: any) {
      log.error(
        { error: error.message, type },
        "Error inicializando moléculas",
      );
      throw new MoleculeError(
        type,
        `Error inicializando moléculas para '${type}': ${error.message}`,
      );
    }
  }

  /**
   * Registra las herramientas correspondientes al tipo de célula
   */
  private registerToolsForType(type: string): void {
    switch (type) {
      case "memory":
        this.registerDatabaseTools();
        break;
      case "http":
        this.registerHTTPTools();
        break;
      case "filesystem":
        this.registerFileSystemTools();
        break;
      case "communication":
        this.registerGmailTools();
        this.registerWhatsAppTools();
        break;
      case "versioncontrol":
        this.registerGitTools();
        break;
      case "sensory":
        this.registerScraperTools();
        break;
      case "system":
        this.registerSystemTools();
        break;
      case "realtime":
        this.registerWebSocketTools();
        break;
    }
  }

  // ========== DATABASE TOOLS ==========
  private registerDatabaseTools(): void {
    if (!this.database) return;

    this.server.registerTool(
      "db_query",
      {
        description: "Ejecuta una query SQL personalizada",
        inputSchema: { sql: z.string(), params: z.array(z.any()).optional() },
      },
      async ({ sql, params }) => {
        const result = await this.database!.query(sql, params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      },
    );

    this.server.registerTool(
      "db_insert",
      {
        description: "Inserta un registro en una tabla",
        inputSchema: { table: z.string(), data: z.record(z.any()) },
      },
      async ({ table, data }) => {
        const id = await this.database!.insert(table, data);
        return {
          content: [{ type: "text", text: `Registro insertado con ID: ${id}` }],
        };
      },
    );

    this.server.registerTool(
      "db_find",
      {
        description: "Busca registros en una tabla",
        inputSchema: {
          table: z.string(),
          filter: z.record(z.any()).optional(),
        },
      },
      async ({ table, filter }) => {
        const results = await this.database!.find(table, filter);
        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
      },
    );
  }

  // ========== HTTP TOOLS ==========
  private registerHTTPTools(): void {
    if (!this.http) return;

    this.server.registerTool(
      "http_get",
      {
        description: "Realiza una petición HTTP GET",
        inputSchema: { url: z.string() },
      },
      async ({ url }) => {
        const data = await this.http!.get(url);
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      },
    );

    this.server.registerTool(
      "http_post",
      {
        description: "Realiza una petición HTTP POST",
        inputSchema: { url: z.string(), data: z.any() },
      },
      async ({ url, data }) => {
        const result = await this.http!.post(url, data);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      },
    );
  }

  // ========== FILESYSTEM TOOLS ==========
  private registerFileSystemTools(): void {
    if (!this.filesystem) return;

    this.server.registerTool(
      "read_file",
      {
        description: "Lee el contenido de un archivo",
        inputSchema: { path: z.string() },
      },
      async ({ path }) => {
        FilePathSchema.parse(path);
        const content = await this.filesystem!.read(path);
        return { content: [{ type: "text", text: content }] };
      },
    );

    this.server.registerTool(
      "write_file",
      {
        description: "Escribe contenido en un archivo",
        inputSchema: { path: z.string(), content: z.string() },
      },
      async ({ path, content }) => {
        FilePathSchema.parse(path);
        await this.filesystem!.write(path, content);
        return {
          content: [{ type: "text", text: `Archivo escrito: ${path}` }],
        };
      },
    );

    this.server.registerTool(
      "list_files",
      {
        description: "Lista archivos en un directorio",
        inputSchema: { path: z.string(), recursive: z.boolean().optional() },
      },
      async ({ path, recursive }) => {
        const files = await this.filesystem!.listFiles(path, recursive);
        return {
          content: [{ type: "text", text: JSON.stringify(files, null, 2) }],
        };
      },
    );
  }

  // ========== GMAIL TOOLS ==========
  private registerGmailTools(): void {
    if (!this.gmail) return;

    this.server.registerTool(
      "send_email",
      {
        description: "Envía un email via Gmail",
        inputSchema: {
          to: z.string(),
          subject: z.string(),
          body: z.string(),
          isHTML: z.boolean().optional(),
        },
      },
      async ({ to, subject, body, isHTML }) => {
        this.emailLimiter.check();
        await this.gmail!.sendEmail({ to, subject, body, isHTML });
        return { content: [{ type: "text", text: `Email enviado a: ${to}` }] };
      },
    );
  }

  // ========== WHATSAPP TOOLS ==========
  private registerWhatsAppTools(): void {
    if (!this.whatsapp) return;

    this.server.registerTool(
      "send_whatsapp",
      {
        description: "Envía un mensaje de WhatsApp a un número de teléfono",
        inputSchema: {
          to: z
            .string()
            .describe("Número con código de país, ej: +573001234567"),
          body: z.string(),
        },
      },
      async ({ to, body }) => {
        const result = await this.whatsapp!.sendMessage({ to, body });
        return {
          content: [
            {
              type: "text",
              text: `WhatsApp enviado a ${to} (SID: ${result.sid})`,
            },
          ],
        };
      },
    );
  }

  // ========== GIT TOOLS ==========
  private registerGitTools(): void {
    if (!this.git) return;

    this.server.registerTool(
      "git_status",
      {
        description: "Obtiene el status del repositorio Git",
        inputSchema: {},
      },
      async () => {
        const status = await this.git!.status();
        return {
          content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
        };
      },
    );

    this.server.registerTool(
      "git_commit",
      {
        description: "Hace commit de los cambios",
        inputSchema: { message: z.string() },
      },
      async ({ message }) => {
        await this.git!.add(".");
        const hash = await this.git!.commit(message);
        return { content: [{ type: "text", text: `Commit: ${hash}` }] };
      },
    );
  }

  // ========== SCRAPER TOOLS ==========
  private registerScraperTools(): void {
    if (!this.scraper) return;

    this.server.registerTool(
      "scrape_url",
      {
        description:
          "Extrae datos de una URL. Si no se indica schema, extrae título y texto completo de la página",
        inputSchema: {
          url: z.string(),
          schema: z.record(z.any()).optional(),
        },
      },
      async ({ url, schema }) => {
        const data = await this.scraper!.scrape(url, schema ?? {});
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      },
    );

    this.server.registerTool(
      "extract_links",
      {
        description: "Extrae todos los links de una página",
        inputSchema: { url: z.string() },
      },
      async ({ url }) => {
        const links = await this.scraper!.extractLinks(url);
        return {
          content: [{ type: "text", text: JSON.stringify(links, null, 2) }],
        };
      },
    );

    this.server.registerTool(
      "scrape_metadata",
      {
        description:
          "Extrae metadata (Open Graph, Twitter Cards) de una página",
        inputSchema: { url: z.string() },
      },
      async ({ url }) => {
        const metadata = await this.scraper!.extractMetadata(url);
        return {
          content: [{ type: "text", text: JSON.stringify(metadata, null, 2) }],
        };
      },
    );
  }

  // ========== SYSTEM TOOLS ==========
  private registerSystemTools(): void {
    if (!this.system) return;

    this.server.registerTool(
      "execute_cli",
      {
        description:
          "Ejecuta un comando CLI del sistema (usar solo si no hay alternativa NPM)",
        inputSchema: { command: z.string() },
      },
      async ({ command }) => {
        CommandSchema.parse(command);
        this.cliLimiter.check();
        const result = await this.system!.runSafe(command);
        return { content: [{ type: "text", text: result.stdout }] };
      },
    );

    this.server.registerTool(
      "check_command",
      {
        description: "Verifica si un comando CLI está instalado",
        inputSchema: { command: z.string() },
      },
      async ({ command }) => {
        const exists = await this.system!.hasCommand(command);
        return {
          content: [
            {
              type: "text",
              text: `${command}: ${exists ? "instalado" : "no instalado"}`,
            },
          ],
        };
      },
    );

    this.server.registerTool(
      "system_info",
      {
        description: "Obtiene información del sistema",
        inputSchema: {},
      },
      async () => {
        const info = this.system!.getSystemInfo();
        return {
          content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
        };
      },
    );
  }

  // ========== WEBSOCKET TOOLS ==========
  private registerWebSocketTools(): void {
    if (!this.websocket) return;

    this.server.registerTool(
      "ws_start_server",
      {
        description:
          "Inicia un servidor WebSocket en el puerto especificado para comunicación bidireccional en tiempo real",
        inputSchema: {
          port: z
            .number()
            .min(1024)
            .max(65535)
            .describe("Puerto del servidor WebSocket (1024-65535)"),
        },
      },
      async ({ port }) => {
        await this.websocket!.startServer(port);
        return {
          content: [
            {
              type: "text" as const,
              text: `Servidor WebSocket iniciado en ws://localhost:${port}`,
            },
          ],
        };
      },
    );

    this.server.registerTool(
      "ws_stop_server",
      {
        description:
          "Detiene el servidor WebSocket y desconecta todos los clientes",
        inputSchema: {},
      },
      async () => {
        await this.websocket!.stopServer();
        return {
          content: [
            { type: "text" as const, text: "Servidor WebSocket detenido" },
          ],
        };
      },
    );

    this.server.registerTool(
      "ws_send",
      {
        description:
          "Envía un mensaje a un cliente WebSocket específico por su ID",
        inputSchema: {
          clientId: z.string().min(1).describe("ID del cliente destino"),
          message: z.string().min(1).describe("Mensaje a enviar"),
        },
      },
      async ({ clientId, message }) => {
        const result = await this.websocket!.send(clientId, message);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      },
    );

    this.server.registerTool(
      "ws_broadcast",
      {
        description:
          "Envía un mensaje a todos los clientes WebSocket conectados",
        inputSchema: {
          message: z.string().min(1).describe("Mensaje a enviar a todos"),
        },
      },
      async ({ message }) => {
        const result = await this.websocket!.broadcast(message);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      },
    );

    this.server.registerTool(
      "ws_list_clients",
      {
        description:
          "Lista todos los clientes WebSocket conectados con su ID, dirección IP y tiempo de conexión",
        inputSchema: {},
      },
      async () => {
        const clients = this.websocket!.getClients();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  count: clients.length,
                  clients: clients.map((c) => ({
                    id: c.id,
                    connectedAt: new Date(c.connectedAt).toISOString(),
                    remoteAddress: c.remoteAddress,
                    metadata: c.metadata,
                  })),
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    this.server.registerTool(
      "ws_disconnect_client",
      {
        description: "Desconecta un cliente WebSocket específico por su ID",
        inputSchema: {
          clientId: z.string().min(1).describe("ID del cliente a desconectar"),
        },
      },
      async ({ clientId }) => {
        this.websocket!.disconnectClient(clientId);
        return {
          content: [
            {
              type: "text" as const,
              text: `Cliente ${clientId} desconectado`,
            },
          ],
        };
      },
    );
  }

  /**
   * Arranca la célula usando el transporte indicado.
   */
  async run(transport?: unknown) {
    const activeTransport = transport ?? new StdioServerTransport();
    const transportName = transport ? "transporte personalizado" : "Stdio";
    log.info(
      { transport: transportName },
      "Célula activa, esperando estímulos",
    );
    await this.server.connect(
      activeTransport as import("@modelcontextprotocol/sdk/shared/transport.js").Transport,
    );
  }
}

// Inicialización de la Célula si es invocada directamente.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Leer allowedCells desde variable de entorno (pasada por el organismo)
  const allowedCellsEnv = process.env.BIOCORE_ALLOWED_CELLS;
  const allowedCells = allowedCellsEnv
    ? allowedCellsEnv.split(",").map((c) => c.trim())
    : undefined;

  // Leer tenantId desde variable de entorno (pasada por el organismo)
  const tenantId = process.env.BIOCORE_TENANT_ID || "default";

  const server = new CellServer(allowedCells, tenantId);
  try {
    await server.run();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

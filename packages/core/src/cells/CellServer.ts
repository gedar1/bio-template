import {
  McpServer,
  type RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
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
import type { IDatabase } from "../molecules/interfaces/IDatabase.js";
import type { IMolecule } from "../molecules/interfaces/IMolecule.js";
import type { ICell } from "./interfaces/ICell.js";
import type {
  CellComposition,
  CellRegistration,
  CellRuntimeContext,
  CellResource,
} from "./CellComposition.js";
import type { Registry } from "../config/mergeRegistry.js";

const log = createLogger("CellServer");

const require = createRequire(import.meta.url);
const __dirname = getModuleDir(import.meta.url);

// ─── Registry genérico por defecto ───────────────────────────────────────────
const registry = require(
  join(__dirname, "../config/registry.json"),
) as Registry;

export interface CellServerOptions {
  readonly allowedCells?: readonly string[];
  readonly tenantId?: string;
  readonly composition?: CellComposition;
  readonly context?: Readonly<Record<string, unknown>>;
}

/**
 * Servidor MCP BioCore con moléculas completas.
 * Esta célula muta dinámicamente para exponer diferentes capacidades.
 */
export class CellServer implements ICell {
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

  /** Registry compuesto activo para este proceso de cell. */
  private readonly composition: CellComposition;

  /** Registrars built-in, reemplazables por una aplicación vertical. */
  private readonly registrations: ReadonlyMap<string, CellRegistration>;

  /** Tipos de célula permitidos para este servidor (filtrado por perfil) */
  private readonly allowedCells: string[];

  /** ID del tenant que opera este CellServer */
  private readonly tenantId: string;

  /** Ruta de la BD específica del tenant */
  private readonly tenantDbPath: string;

  /** Recursos vivos de la mutación actual. */
  private readonly resources = new Map<string, IMolecule>();

  /** Recursos cuyo cleanup falló y deben reintentarse sin perder la referencia. */
  private readonly pendingCleanup = new Map<IMolecule, () => Promise<void>>();

  /** Handles MCP de las tools activas, indexados por nombre. */
  private readonly activeTools = new Map<string, RegisteredTool>();

  /** Contexto adicional proporcionado por la aplicación. */
  private readonly applicationContext: Readonly<Record<string, unknown>>;

  constructor(options?: CellServerOptions);
  constructor(allowedCells?: string[], tenantId?: string);
  constructor(
    optionsOrAllowedCells: CellServerOptions | string[] = {},
    legacyTenantId?: string,
  ) {
    const options: CellServerOptions = Array.isArray(optionsOrAllowedCells)
      ? { allowedCells: optionsOrAllowedCells, tenantId: legacyTenantId }
      : optionsOrAllowedCells;

    this.composition = options.composition ?? { registry };
    this.registrations = this.createRegistrations(options.composition);
    const validTypes = this.composition.registry.cells.map((cell) => cell.type);
    this.allowedCells = options.allowedCells
      ? options.allowedCells.filter((cell) => validTypes.includes(cell))
      : options.composition?.allowedCells
        ? options.composition.allowedCells.filter((cell) =>
            validTypes.includes(cell),
          )
        : [...validTypes];

    this.tenantId =
      options.tenantId || process.env.BIOCORE_TENANT_ID || "default";
    this.applicationContext = options.context ?? {};

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
    // registry.tools es metadato; solo los tipos con registrar real se anuncian.
    const filteredCells = this.composition.registry.cells.filter(
      (c) =>
        this.allowedCells.includes(c.type) &&
        c.type !== "undifferentiated" &&
        this.registrations.has(c.type),
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

        try {
          await this.activateTypes(type);
          this.currentType = type;
        } catch (error: unknown) {
          this.currentType = "undifferentiated";
          throw error;
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
   * Retira las tools de la mutación anterior antes de liberar sus recursos.
   * La API MCP no expone unregister en McpServer, pero cada RegisteredTool
   * ofrece remove(); el mapa evita dejar handlers obsoletos o duplicados.
   */
  private disposeTools(): void {
    for (const [name, tool] of this.activeTools) {
      try {
        tool.remove();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log.warn({ error: message, name }, "Error retirando tool MCP");
      }
    }
    this.activeTools.clear();
    if (this.server.isConnected()) {
      this.server.sendToolListChanged();
    }
  }

  private createCleanupAction(molecule: IMolecule): () => Promise<void> {
    if (molecule === this.database && this.database) {
      const database = this.database;
      return async () => {
        await database.close();
      };
    }
    return async () => {
      await molecule.dispose?.();
    };
  }

  private clearMoleculeReferences(molecule: IMolecule): void {
    if (this.database === molecule) this.database = null;
    if (this.gmail === molecule) this.gmail = null;
    if (this.http === molecule) this.http = null;
    if (this.filesystem === molecule) this.filesystem = null;
    if (this.git === molecule) this.git = null;
    if (this.scraper === molecule) this.scraper = null;
    if (this.system === molecule) this.system = null;
    if (this.whatsapp === molecule) this.whatsapp = null;
    if (this.websocket === molecule) this.websocket = null;
  }

  /**
   * Limpia las moléculas del perfil anterior o de una factory abortada.
   * Un fallo conserva la referencia en pendingCleanup para que una llamada
   * posterior reintente el mismo cleanup y nunca declare cerrado un recurso abierto.
   */
  private async disposeMolecules(
    additionalResources: readonly CellResource[] = [],
  ): Promise<void> {
    this.disposeTools();

    const cleanupActions = new Map<IMolecule, () => Promise<void>>(
      this.pendingCleanup,
    );
    const addResource = (key: string, molecule: IMolecule): void => {
      if (!cleanupActions.has(molecule)) {
        cleanupActions.set(molecule, this.createCleanupAction(molecule));
      }
      if (!this.resources.has(key)) {
        this.resources.set(key, molecule);
      }
    };

    for (const [key, molecule] of this.resources) {
      addResource(key, molecule);
    }
    for (const resource of additionalResources) {
      addResource(resource.key, resource.molecule);
    }
    if (this.database) {
      addResource("database", this.database);
    }

    const failures: string[] = [];
    for (const [molecule, cleanup] of cleanupActions) {
      try {
        await cleanup();
        this.pendingCleanup.delete(molecule);
        for (const [key, current] of this.resources) {
          if (current === molecule) this.resources.delete(key);
        }
        this.clearMoleculeReferences(molecule);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.pendingCleanup.set(molecule, cleanup);
        failures.push(`${molecule.name}: ${message}`);
        log.warn(
          { error: message, molecule: molecule.name },
          "Error durante dispose de molécula; queda pendiente de retry",
        );
      }
    }

    if (failures.length > 0) {
      throw new MoleculeError(
        "cell",
        "No se pudieron liberar todos los recursos de la célula.",
        { pendingCleanup: failures },
      );
    }

    log.debug(
      { previousType: this.currentType },
      "Moléculas anteriores liberadas",
    );
  }

  private createRegistrations(
    composition?: CellComposition,
  ): ReadonlyMap<string, CellRegistration> {
    const builtIns: CellRegistration[] = [
      {
        type: "memory",
        factory: async (context) => {
          const database = DatabaseMolecule.create();
          this.database = database;
          const resource = { key: "database", molecule: database };
          context.trackResource(resource);
          await database.connect();
          return [resource];
        },
        registerTools: () => this.registerDatabaseTools(),
      },
      {
        type: "http",
        factory: (context) => {
          const http = new HTTPMolecule();
          this.http = http;
          const resource = { key: "http", molecule: http };
          context.trackResource(resource);
          return [resource];
        },
        registerTools: () => this.registerHTTPTools(),
      },
      {
        type: "filesystem",
        factory: (context) => {
          const filesystem = new FileSystemMolecule();
          this.filesystem = filesystem;
          const resource = { key: "filesystem", molecule: filesystem };
          context.trackResource(resource);
          return [resource];
        },
        registerTools: () => this.registerFileSystemTools(),
      },
      {
        type: "communication",
        factory: async (context) => {
          const gmail = new GmailMolecule();
          this.gmail = gmail;
          const gmailResource = { key: "gmail", molecule: gmail };
          context.trackResource(gmailResource);
          await gmail.connect();
          const resources: CellResource[] = [gmailResource];
          try {
            const whatsapp = new WhatsAppMolecule();
            this.whatsapp = whatsapp;
            const whatsappResource = { key: "whatsapp", molecule: whatsapp };
            context.trackResource(whatsappResource);
            resources.push(whatsappResource);
          } catch {
            // WhatsApp es opcional — si no hay configuración de Twilio, se omite.
          }
          return resources;
        },
        registerTools: async () => {
          this.registerGmailTools();
          this.registerWhatsAppTools();
        },
      },
      {
        type: "versioncontrol",
        factory: (context) => {
          const git = new GitMolecule();
          this.git = git;
          const resource = { key: "git", molecule: git };
          context.trackResource(resource);
          return [resource];
        },
        registerTools: () => this.registerGitTools(),
      },
      {
        type: "sensory",
        factory: (context) => {
          const scraper = new ScraperMolecule();
          const http = new HTTPMolecule();
          this.scraper = scraper;
          this.http = http;
          const resources: CellResource[] = [
            { key: "scraper", molecule: scraper },
            { key: "http", molecule: http },
          ];
          for (const resource of resources) context.trackResource(resource);
          return resources;
        },
        registerTools: () => this.registerScraperTools(),
      },
      {
        type: "system",
        factory: (context) => {
          const system = new SystemMolecule();
          this.system = system;
          const resource = { key: "system", molecule: system };
          context.trackResource(resource);
          return [resource];
        },
        registerTools: () => this.registerSystemTools(),
      },
      {
        type: "realtime",
        factory: async (context) => {
          const websocket = new WebSocketMolecule();
          this.websocket = websocket;
          const websocketResource = { key: "websocket", molecule: websocket };
          context.trackResource(websocketResource);
          await websocket.initialize();
          const http = new HTTPMolecule();
          this.http = http;
          const httpResource = { key: "http", molecule: http };
          context.trackResource(httpResource);
          return [websocketResource, httpResource];
        },
        registerTools: () => this.registerWebSocketTools(),
      },
    ];

    const registrations = new Map(
      builtIns.map((registration) => [registration.type, registration]),
    );
    for (const registration of composition?.registrations ?? []) {
      registrations.set(registration.type, registration);
    }
    return registrations;
  }

  private getRuntimeContext(
    trackResource?: (resource: CellResource) => void,
  ): CellRuntimeContext {
    return {
      tenantId: this.tenantId,
      tenantDbPath: this.tenantDbPath,
      values: this.applicationContext,
      resources: this.resources,
      getResource: <T extends IMolecule>(key: string): T | undefined =>
        this.resources.get(key) as T | undefined,
      trackResource: trackResource ?? (() => undefined),
    };
  }

  private getToolRegistrationServer(): McpServer {
    const server = this.server;
    type ToolSchema =
      | import("@modelcontextprotocol/sdk/server/zod-compat.js").ZodRawShapeCompat
      | import("@modelcontextprotocol/sdk/server/zod-compat.js").AnySchema;
    type ToolRegistrationArgs<
      OutputArgs extends ToolSchema,
      InputArgs extends undefined | ToolSchema = undefined,
    > = [
      name: string,
      config: {
        title?: string;
        description?: string;
        inputSchema?: InputArgs;
        outputSchema?: OutputArgs;
        annotations?: import("@modelcontextprotocol/sdk/types.js").ToolAnnotations;
        _meta?: Record<string, unknown>;
      },
      callback: import("@modelcontextprotocol/sdk/server/mcp.js").ToolCallback<InputArgs>,
    ];
    const registerTool = <
      OutputArgs extends ToolSchema,
      InputArgs extends undefined | ToolSchema = undefined,
    >(
      ...args: ToolRegistrationArgs<OutputArgs, InputArgs>
    ): RegisteredTool => server.registerTool(...args);

    return new Proxy(server, {
      get: (target, property, receiver) => {
        if (property !== "registerTool") {
          return Reflect.get(target, property, receiver);
        }

        return <
          OutputArgs extends ToolSchema,
          InputArgs extends undefined | ToolSchema = undefined,
        >(
          ...args: ToolRegistrationArgs<OutputArgs, InputArgs>
        ): RegisteredTool => {
          const [name] = args;
          if (this.activeTools.has(name)) {
            throw new MutationError(
              `La tool '${name}' fue registrada más de una vez en la mutación.`,
            );
          }
          const registered = registerTool(...args);
          this.activeTools.set(name, registered);
          return registered;
        };
      },
    });
  }

  private async activateTypes(type: string): Promise<void> {
    const createdResources: CellResource[] = [];
    const trackFactoryResource = (resource: CellResource): void => {
      if (
        !createdResources.some(
          (created) =>
            created.key === resource.key &&
            created.molecule === resource.molecule,
        )
      ) {
        createdResources.push(resource);
      }
    };

    try {
      for (const activeType of this.getTypeChain(type)) {
        const registration = this.registrations.get(activeType);
        if (!registration) continue;

        const created = await registration.factory(
          this.getRuntimeContext(trackFactoryResource),
        );
        for (const resource of created) trackFactoryResource(resource);

        const keys = new Set<string>();
        for (const resource of created) {
          if (keys.has(resource.key) || this.resources.has(resource.key)) {
            throw new MutationError(
              `El recurso '${resource.key}' fue registrado más de una vez.`,
              { type: activeType },
            );
          }
          keys.add(resource.key);
        }

        for (const resource of created) {
          this.resources.set(resource.key, resource.molecule);
          await resource.molecule.initialize?.();
        }
        await registration.registerTools(
          this.getToolRegistrationServer(),
          this.getRuntimeContext(),
        );
      }
      if (this.server.isConnected()) {
        this.server.sendToolListChanged();
      }
    } catch (error: unknown) {
      try {
        await this.disposeMolecules(createdResources);
      } catch (cleanupError: unknown) {
        const message =
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError);
        log.error(
          { error: message, type },
          "Cleanup pendiente tras fallo de activación",
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      log.error({ error: message, type }, "Error activando cell");
      if (error instanceof MutationError) throw error;
      throw new MoleculeError(
        type,
        `Error activando moléculas para '${type}': ${message}`,
      );
    }
  }

  private getTypeChain(type: string): string[] {
    const chain: string[] = [];
    const visited = new Set<string>();
    let currentType: string | undefined = type;

    while (currentType) {
      if (visited.has(currentType)) {
        throw new MutationError(
          `Ciclo de herencia detectado en '${currentType}'.`,
        );
      }
      visited.add(currentType);
      chain.unshift(currentType);
      currentType = this.composition.registry.cells.find(
        (cell) => cell.type === currentType,
      )?.parent;
    }
    return chain;
  }

  // ========== DATABASE TOOLS ==========
  private registerDatabaseTools(): void {
    if (!this.database) return;

    this.getToolRegistrationServer().registerTool(
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

    this.getToolRegistrationServer().registerTool(
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

    this.getToolRegistrationServer().registerTool(
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

    this.getToolRegistrationServer().registerTool(
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

    this.getToolRegistrationServer().registerTool(
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

    this.getToolRegistrationServer().registerTool(
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

    this.getToolRegistrationServer().registerTool(
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

    this.getToolRegistrationServer().registerTool(
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

    this.getToolRegistrationServer().registerTool(
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

    this.getToolRegistrationServer().registerTool(
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

    this.getToolRegistrationServer().registerTool(
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

    this.getToolRegistrationServer().registerTool(
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

    this.getToolRegistrationServer().registerTool(
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

    this.getToolRegistrationServer().registerTool(
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

    this.getToolRegistrationServer().registerTool(
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

    this.getToolRegistrationServer().registerTool(
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

    this.getToolRegistrationServer().registerTool(
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

    this.getToolRegistrationServer().registerTool(
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

    this.getToolRegistrationServer().registerTool(
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

    this.getToolRegistrationServer().registerTool(
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

    this.getToolRegistrationServer().registerTool(
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

    this.getToolRegistrationServer().registerTool(
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

    this.getToolRegistrationServer().registerTool(
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

    this.getToolRegistrationServer().registerTool(
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

  /** Libera los recursos de la mutación actual. */
  async dispose(): Promise<void> {
    await this.disposeMolecules();
  }

  /**
   * Arranca la célula usando el transporte indicado.
   */
  async run(transport?: Transport): Promise<void> {
    const activeTransport = transport ?? new StdioServerTransport();
    const transportName = transport ? "transporte personalizado" : "Stdio";
    log.info(
      { transport: transportName },
      "Célula activa, esperando estímulos",
    );
    await this.server.connect(activeTransport);
  }
}

/**
 * Punto de entrada para un proceso MCP de una aplicación.
 * La composición se importa dentro del proceso y nunca se serializa por MCP.
 */
export async function runCellServer(
  composition?: CellComposition,
): Promise<void> {
  const allowedCellsEnv = process.env.BIOCORE_ALLOWED_CELLS;
  const allowedCells = allowedCellsEnv
    ? allowedCellsEnv.split(",").map((cell) => cell.trim())
    : undefined;
  const tenantId = process.env.BIOCORE_TENANT_ID || "default";
  const server = new CellServer({ allowedCells, tenantId, composition });
  await server.run();
}

// Inicialización de la Célula si es invocada directamente.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runCellServer();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as path from "node:path";
import { getModuleDir } from "../atoms/paths.js";
import { createLogger } from "../config/logger.js";
import { MutationError } from "../errors.js";
import type { IOrganism } from "./interfaces/IOrganism.js";

const __dirname = getModuleDir(import.meta.url);

/**
 * Clase Base Estructurada para todos los Organismos (Sub-Agentes Expertos).
 * Un Organismo se define por la Célula MCP que controla y el estímulo (tipo) que usa para configurarla.
 */
export abstract class BaseOrganisms implements IOrganism {
  protected cell: Client | null = null;
  protected log;
  public organismName: string;
  /** Tipos de célula permitidos para este organismo (filtrado por perfil) */
  protected allowedCells?: string[];

  /** Retorna los tipos de célula permitidos para este organismo */
  public getAllowedCells(): string[] | undefined {
    return this.allowedCells;
  }

  /**
   * @param organismName Nombre del organismo (ej. 'Investigador', 'Escritor')
   * @param allowedCells Tipos de célula permitidos (si no se pasa, usa todos)
   */
  constructor(organismName: string, allowedCells?: string[]) {
    this.organismName = organismName;
    this.allowedCells = allowedCells;
    this.log = createLogger(`Organism:${organismName}`);
  }

  /**
   * Instancia un CellServer (Servidor MCP Node) como hijo independiente y lo muta a su especialidad.
   */
  public async initializeContext(): Promise<void> {
    const serverPath =
      process.env.BIOCORE_CELL_SERVER_PATH ??
      path.join(__dirname, "..", "cells", "CellServer.js");

    const transport = new StdioClientTransport({
      command: "node",
      args: [serverPath],
      env: {
        ...process.env,
        ...(this.allowedCells
          ? { BIOCORE_ALLOWED_CELLS: this.allowedCells.join(",") }
          : {}),
        BIOCORE_TENANT_ID: this.organismName.replace("Tenant-", ""),
      },
    });

    this.cell = new Client(
      {
        name: `biocore-organismo-${this.organismName.toLowerCase()}`,
        version: "1.0.0",
      },
      { capabilities: {} },
    );

    await this.cell.connect(transport);

    this.log.info("Conexión celular lista, esperando estímulo");
  }

  /**
   * Permite que el Sistema Orquestador ordena dinámicamente mutar a este organismo.
   * @param customType Tipo de estímulo MCP ('sensory', 'memory', etc.)
   */
  public async stimulate(customType: string): Promise<void> {
    if (!this.cell)
      throw new MutationError(
        "La célula no está inicializada. Ejecuta initializeContext() primero.",
        { organism: this.organismName },
      );

    this.log.info({ stimulus: customType }, "Estímulo recibido, mutando");
    await this.cell.callTool({
      name: "stimulate_differentiation",
      arguments: { type: customType },
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    this.log.info({ stimulus: customType }, "Genoma MCP modificado");
  }

  /**
   * Le pregunta a la Célula qué herramientas ofrece en este momento.
   */
  public async inspectTools(): Promise<any> {
    if (!this.cell) return null;
    const toolList = await this.cell.listTools();
    return toolList.tools;
  }

  /**
   * Ejecuta una herramienta MCP en la célula de este organismo.
   * Usado por el Orquestador para rutear tool calls del LLM.
   */
  public async callTool(name: string, args: Record<string, any>): Promise<any> {
    if (!this.cell)
      throw new MutationError("La célula no está inicializada.", {
        organism: this.organismName,
      });

    this.log.info({ tool: name }, "Ejecutando herramienta MCP");
    const result = await this.cell.callTool({ name, arguments: args });
    return result;
  }

  /**
   * Despierta la célula independientemente (Cierra conexiones MCP).
   */
  public async detach(): Promise<void> {
    if (this.cell) {
      // El protocolo cierra la conexión al matarse el proceso de NodeJS temporal
    }
  }

  /**
   * Interfaz obligatoria que cada órgano hijo implementará con la "Mente" de su Agente. (LLM call o lógica de negocio)
   * @param intention Mensaje cruzado asíncrono desde el Orquestador principal u otro Órgano.
   */
  abstract process(intention: any): Promise<any>;
}

/**
 * Contrato que todo Organismo (Sub-Agente MCP) debe cumplir.
 */
export interface IOrganism {
  /** Nombre identificador del organismo */
  readonly organismName: string;

  /** Conecta la célula MCP hija como proceso independiente */
  initializeContext(): Promise<void>;

  /** Muta la célula interna al perfil indicado */
  stimulate(customType: string): Promise<void>;

  /** Inspecciona las herramientas MCP disponibles en la célula */
  inspectTools(): Promise<any[] | null>;

  /** Ejecuta una herramienta MCP en la célula */
  callTool(name: string, args: Record<string, any>): Promise<any>;

  /** Desconecta la célula MCP */
  detach(): Promise<void>;

  /** Lógica de negocio del organismo (LLM call, procesamiento, etc.) */
  process(intention: any): Promise<any>;
}

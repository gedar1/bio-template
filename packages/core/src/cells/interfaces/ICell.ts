/**
 * Contrato que toda Célula MCP debe cumplir.
 * Define el ciclo de vida de mutación dinámica.
 */
export interface ICell {
  /** Perfil actual de la célula ('undifferentiated', 'sensory', 'memory', etc.) */
  readonly currentType: string;

  /** Arranca la célula con el transporte indicado */
  run(transport?: any): Promise<void>;
}

/**
 * Evento de mutación celular para trazabilidad.
 */
export interface MutationEvent {
  timestamp: number;
  from: string;
  to: string;
  moleculesActivated: string[];
  toolsRegistered: string[];
}

import type { IOrganism } from "../../organisms/interfaces/IOrganism.js";
import type { IStimulus } from "./IStimulus.js";

/**
 * Contrato que todo Orquestador (Cortex) debe cumplir.
 */
export interface IOrchestrator {
  /** Registra un organismo en el sistema */
  registerOrganism(org: IOrganism): void;

  /** Inicializa todos los organismos registrados (conecta células MCP) */
  init(): Promise<void>;

  /**
   * Difunde señal de diferenciación a todos los organismos.
   * Acepta string (retrocompatible) o IStimulus (con trazabilidad).
   */
  routeStimulus(stimulus: string | IStimulus): Promise<void>;

  /** Obtiene herramientas unificadas y deduplicadas de todos los organismos */
  getUnifiedTools(): Promise<any[]>;

  /** Punto de entrada principal: procesa un mensaje del usuario */
  chat(userMessage: string): Promise<void>;

  /** Resumen de métricas de performance */
  getPerfSummary(): Record<
    string,
    { count: number; avgMs: number; minMs: number; maxMs: number }
  >;

  /** Mensajes del historial de la sesión actual */
  getHistory(): Array<{ role: string; content: string }>;

  /** ID de la sesión actual */
  getSessionId(): string;
}

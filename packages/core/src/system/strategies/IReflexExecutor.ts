import type {
  ReflexMatch,
  ReflexStep,
} from "../../molecules/ReflexMolecule.js";

/**
 * Strategy interface for reflex (procedural memory).
 *
 * Encapsula la consulta de la sugerencia de Jev, el registro incremental de
 * pasos de la sesión actual y la persistencia de la secuencia como historial.
 * La ejecución de cadenas no pasa por aquí: la hace el gate de UnifiedCortex
 * (ver docs/DECISIONS-AND-CONFIG.md, sección 3.6).
 */
export interface IReflexExecutor {
  /** Inicializa la memoria refleja subyacente (DB). */
  initialize(): Promise<void>;

  /**
   * Registra el input del usuario y resetea la secuencia de pasos acumulada.
   * Llamar al inicio de cada turno de chat.
   */
  trackInput(input: string): void;

  /**
   * Registra un paso ejecutado (mutación o herramienta) en la secuencia actual.
   * El orquestador lo invoca desde `executeAction` tras cada paso exitoso.
   */
  recordStep(step: ReflexStep, args: Record<string, unknown>): void;

  /**
   * Pide a Jev la cadena sugerida para el input, con las herramientas de
   * tools.json que pertenecen a las células permitidas.
   * @returns La sugerencia como match (mode hint) o null si Jev no sugiere nada.
   */
  queryReflex(
    input: string,
    allowedCells?: readonly string[],
  ): Promise<ReflexMatch | null>;

  /**
   * Persiste la secuencia de la sesión actual como historial.
   * No hace nada si no hay pasos acumulados.
   */
  saveReflex(): Promise<void>;
}

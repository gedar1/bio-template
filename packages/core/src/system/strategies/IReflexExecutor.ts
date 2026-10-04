import type {
  ReflexMatch,
  ReflexStep,
} from "../../molecules/ReflexMolecule.js";
import type { IStimulus } from "../interfaces/IStimulus.js";

/**
 * Colaboradores de orquestación que el ReflexExecutor necesita para ejecutar
 * una secuencia refleja. Se inyectan por llamada (no por constructor) porque
 * pertenecen al ciclo de vida del orquestador, no de la estrategia.
 */
export interface ReflexCollaborators {
  /** Difunde una señal de diferenciación (mutación) al cuerpo. */
  routeStimulus: (stimulus: string | IStimulus) => Promise<void>;
  /** Ejecuta una herramienta por nombre y devuelve su salida textual. */
  executeAction: (name: string, args: any) => Promise<string>;
}

/**
 * Strategy interface for reflex (procedural memory) execution.
 *
 * Encapsula la consulta, ejecución y persistencia de reflexes, el registro
 * incremental de pasos de la sesión actual, y el versionado de esquemas de
 * herramientas para detectar incompatibilidades.
 *
 * Nota de diseño: las firmas reflejan la implementación real del sistema
 * (no la versión idealizada del documento de diseño). `executeReflex` recibe
 * un `ReflexMatch` ya resuelto y los colaboradores de orquestación, porque el
 * ruteo de estímulos y la ejecución de herramientas son responsabilidad del
 * orquestador, no de la estrategia.
 */
export interface IReflexExecutor {
  /** Mapa de nombre de herramienta → versión de esquema. */
  readonly toolVersionMap: Map<string, string>;

  /** Inicializa la memoria refleja subyacente (índice vectorial, DB). */
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
   * Busca el reflex más similar al input sin ejecutarlo.
   * @returns El match más cercano (mode reflex|hint) o null si no hay match.
   */
  queryReflex(input: string): Promise<ReflexMatch | null>;

  /**
   * Persiste la secuencia de la sesión actual como un reflex exitoso.
   * No hace nada si no hay pasos acumulados.
   */
  saveReflex(): Promise<void>;

  /**
   * Ejecuta una secuencia refleja directamente sin invocar al LLM.
   * @param match         - Reflex a ejecutar (retornado por queryReflex)
   * @param args          - Args explícitos por herramienta { tool: args }
   * @param collaborators - Callbacks de ruteo de estímulos y ejecución de tools
   * @returns Resultados textuales de cada paso ejecutado
   */
  executeReflex(
    match: ReflexMatch,
    args: Record<string, Record<string, unknown>>,
    collaborators: ReflexCollaborators,
  ): Promise<string[]>;

  /**
   * Construye el mapa de versiones de esquema a partir de las herramientas
   * unificadas disponibles.
   */
  buildToolVersionMap(tools: any[]): void;

  /** Obtiene las versiones de esquema asociadas a los pasos dados. */
  getSchemaVersions(steps: ReflexStep[]): Record<string, string>;

  /**
   * Verifica si las versiones de esquema guardadas siguen siendo compatibles
   * con las herramientas actuales.
   */
  checkSchemaVersions(
    stored: Record<string, string> | null,
    current: Map<string, string>,
  ): {
    compatible: boolean;
    mismatches: Array<{ tool: string; stored: string; current: string }>;
  };
}

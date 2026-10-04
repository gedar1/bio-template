/**
 * Representa un estímulo de diferenciación con trazabilidad.
 *
 * BioCore es agnóstica a la fuente del estímulo.
 * Esta interfaz permite saber QUÉ se pidió, QUIÉN lo pidió y CUÁNDO.
 *
 * @example
 * // Desde el LLM
 * { type: "sensory", source: "llm", metadata: { model: "gemini-2.0-flash" } }
 *
 * // Desde una API REST
 * { type: "memory", source: "api", metadata: { endpoint: "/api/mutate", ip: "192.168.1.1" } }
 *
 * // Desde un scheduler
 * { type: "filesystem", source: "scheduler", metadata: { cron: "0 2 * * *", task: "backup" } }
 *
 * // Desde un webhook
 * { type: "versioncontrol", source: "webhook", metadata: { event: "push", repo: "biocore" } }
 */
export interface IStimulus {
  /** Tipo de diferenciación: "sensory", "memory", "filesystem", etc. */
  type: string;

  /** Origen del estímulo para trazabilidad */
  source: StimulusSource;

  /** Datos adicionales del contexto de origen */
  metadata?: Record<string, any>;

  /** Timestamp del estímulo (auto-generado si no se provee) */
  timestamp?: number;
}

/**
 * Fuentes conocidas de estímulo.
 * Se puede extender con string para fuentes custom.
 */
export type StimulusSource =
  | "llm"
  | "cli"
  | "api"
  | "frontend"
  | "scheduler"
  | "webhook"
  | "database"
  | "filesystem"
  | "organism"
  | "monitor"
  | (string & {});

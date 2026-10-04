import { createLogger } from "../config/logger.js";
import type { LogEntry, LogLevel } from "./types/dashboard.js";

const log = createLogger("LogBuffer");

/**
 * Ring buffer in-memory para capturar log entries del sistema.
 * Soporta un patrón subscriber para notificar a conexiones SSE en tiempo real.
 *
 * - Máximo 1000 entries (configurable)
 * - Subscriber pattern para streaming
 * - getRecent(limit) para consultas históricas
 */
export class LogBuffer {
  private entries: LogEntry[] = [];
  private readonly maxSize: number;
  private subscribers: Set<(entry: LogEntry) => void> = new Set();

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  /**
   * Agrega una entrada al buffer y notifica a todos los subscribers.
   * Si el buffer excede maxSize, descarta las entradas más antiguas.
   */
  push(entry: LogEntry): void {
    this.entries.push(entry);

    if (this.entries.length > this.maxSize) {
      this.entries = this.entries.slice(-this.maxSize);
    }

    for (const subscriber of this.subscribers) {
      try {
        subscriber(entry);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn({ error: message }, "Error notificando subscriber");
      }
    }
  }

  /**
   * Suscribe una función callback que será invocada con cada nueva entry.
   * Retorna una función para cancelar la suscripción.
   */
  subscribe(fn: (entry: LogEntry) => void): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  /**
   * Retorna las últimas N entries del buffer.
   */
  getRecent(limit: number): LogEntry[] {
    if (limit >= this.entries.length) {
      return [...this.entries];
    }
    return this.entries.slice(-limit);
  }

  /**
   * Retorna el número actual de entries en el buffer.
   */
  get size(): number {
    return this.entries.length;
  }

  /**
   * Retorna el número de subscribers activos.
   */
  get subscriberCount(): number {
    return this.subscribers.size;
  }

  /**
   * Limpia todas las entries del buffer.
   */
  clear(): void {
    this.entries = [];
  }
}

// ─── Pino Integration ─────────────────────────────────────────────────────────

/** Pino numeric levels to LogLevel string mapping */
const PINO_LEVEL_MAP: Record<number, LogLevel> = {
  10: "debug", // trace → debug
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "error", // fatal → error
};

/**
 * Crea un Pino destination que captura logs y los pushea al LogBuffer.
 * Se usa como multistream destination junto al transport principal.
 *
 * @example
 * ```typescript
 * import pino from "pino";
 * import { createLogBufferDestination } from "./LogBuffer.js";
 *
 * const logBuffer = new LogBuffer();
 * const dest = createLogBufferDestination(logBuffer);
 * // Integrar con pino multistream o hook
 * ```
 */
export function createLogBufferDestination(buffer: LogBuffer) {
  return {
    write(chunk: string): void {
      try {
        const parsed = JSON.parse(chunk);
        const entry: LogEntry = {
          timestamp: parsed.time || Date.now(),
          level: PINO_LEVEL_MAP[parsed.level] || "info",
          component: parsed.component || "unknown",
          message: parsed.msg || "",
          metadata: extractMetadata(parsed),
        };
        buffer.push(entry);
      } catch {
        // Si no se puede parsear el chunk, crear entry genérica
        buffer.push({
          timestamp: Date.now(),
          level: "info",
          component: "unknown",
          message: chunk.trim(),
        });
      }
    },
  };
}

/**
 * Extrae metadata relevante de un log entry de Pino,
 * excluyendo campos estándar.
 */
function extractMetadata(
  parsed: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const standardKeys = new Set([
    "level",
    "time",
    "pid",
    "hostname",
    "component",
    "msg",
    "traceId",
    "spanId",
  ]);

  const metadata: Record<string, unknown> = {};
  let hasMetadata = false;

  for (const [key, value] of Object.entries(parsed)) {
    if (!standardKeys.has(key)) {
      metadata[key] = value;
      hasMetadata = true;
    }
  }

  return hasMetadata ? metadata : undefined;
}

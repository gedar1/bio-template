import { createLogger } from "../config/logger.js";
import type { ILogger } from "../config/ILogger.js";

export interface RateLimiterOptions {
  /** Nombre del limiter (para logs) */
  name: string;
  /** Máximo de llamadas permitidas en la ventana */
  maxCalls: number;
  /** Ventana de tiempo en ms */
  windowMs: number;
  /** Logger inyectable (fallback a createLogger si no se provee) */
  logger?: ILogger;
}

/**
 * Rate Limiter con ventana deslizante.
 * Protege herramientas sensibles contra abuso (execute_cli, send_email).
 */
export class RateLimiter {
  private readonly name: string;
  private readonly maxCalls: number;
  private readonly windowMs: number;
  private readonly log: ILogger;
  private timestamps: number[] = [];

  constructor(options: RateLimiterOptions) {
    this.name = options.name;
    this.maxCalls = options.maxCalls;
    this.windowMs = options.windowMs;
    this.log = options.logger ?? createLogger("RateLimiter");
  }

  /**
   * Verifica si la llamada está permitida. Si no, lanza error.
   */
  check(): void {
    const now = Date.now();
    // Limpiar timestamps fuera de la ventana
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

    if (this.timestamps.length >= this.maxCalls) {
      const waitMs = this.windowMs - (now - this.timestamps[0]);
      const msg = `Rate limit alcanzado para '${this.name}': ${this.maxCalls} llamadas/${this.windowMs / 1000}s. Reintenta en ${Math.ceil(waitMs / 1000)}s`;
      this.log.warn(msg, {
        limiter: this.name,
        calls: this.timestamps.length,
        max: this.maxCalls,
      });
      throw new Error(msg);
    }

    this.timestamps.push(now);
  }

  /** Llamadas restantes en la ventana actual */
  remaining(): number {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    return Math.max(0, this.maxCalls - this.timestamps.length);
  }

  /** Resetea el limiter */
  reset(): void {
    this.timestamps = [];
  }
}

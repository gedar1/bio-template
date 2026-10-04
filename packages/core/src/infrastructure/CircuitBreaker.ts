import { createLogger } from "../config/logger.js";
import type { ILogger } from "../config/ILogger.js";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  /** Nombre del circuito (para logs) */
  name: string;
  /** Fallos consecutivos para abrir el circuito */
  failureThreshold?: number;
  /** Tiempo en ms antes de intentar recuperación (HALF_OPEN) */
  resetTimeout?: number;
  /** Callback cuando el circuito se abre */
  onOpen?: () => void;
  /** Callback cuando el circuito se cierra (recuperación) */
  onClose?: () => void;
  /** Logger inyectable (fallback a createLogger si no se provee) */
  logger?: ILogger;
}

/**
 * Circuit Breaker para proteger llamadas a servicios externos (LLMs, APIs).
 *
 * Estados:
 * - CLOSED: Funcionando normal, las llamadas pasan.
 * - OPEN: Demasiados fallos, las llamadas se rechazan inmediatamente.
 * - HALF_OPEN: Periodo de prueba, permite una llamada para verificar recuperación.
 */
export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly resetTimeout: number;
  private readonly onOpen?: () => void;
  private readonly onClose?: () => void;
  private readonly log: ILogger;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? 3;
    this.resetTimeout = options.resetTimeout ?? 30000;
    this.onOpen = options.onOpen;
    this.onClose = options.onClose;
    this.log = options.logger ?? createLogger("CircuitBreaker");
  }

  getState(): CircuitState {
    return this.state;
  }

  getFailureCount(): number {
    return this.failureCount;
  }

  getLastFailureTime(): number {
    return this.lastFailureTime;
  }

  getResetTimeout(): number {
    return this.resetTimeout;
  }

  /**
   * Ejecuta una función protegida por el circuit breaker.
   * Si el circuito está abierto, lanza error inmediatamente.
   * Si está half-open, permite un intento de prueba.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime >= this.resetTimeout) {
        this.state = "HALF_OPEN";
        this.log.info("Circuito en HALF_OPEN, probando recuperación", {
          circuit: this.name,
        });
      } else {
        const err = new Error(
          `Circuito '${this.name}' abierto. Reintenta en ${Math.ceil((this.resetTimeout - (Date.now() - this.lastFailureTime)) / 1000)}s`,
        );
        this.log.warn(err.message, { circuit: this.name, state: this.state });
        throw err;
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === "HALF_OPEN") {
      this.log.info("Recuperación exitosa, circuito CLOSED", {
        circuit: this.name,
      });
      this.onClose?.();
    }
    this.failureCount = 0;
    this.state = "CLOSED";
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      this.state = "OPEN";
      this.log.error("Circuito ABIERTO por exceso de fallos", {
        circuit: this.name,
        failures: this.failureCount,
        threshold: this.failureThreshold,
      });
      this.onOpen?.();
    } else {
      this.log.warn("Fallo registrado", {
        circuit: this.name,
        failures: this.failureCount,
        threshold: this.failureThreshold,
      });
    }
  }

  /** Resetea el circuito manualmente */
  reset(): void {
    this.state = "CLOSED";
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.log.info("Circuito reseteado manualmente", { circuit: this.name });
  }
}

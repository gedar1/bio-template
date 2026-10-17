import { createLogger } from "../config/logger.js";
import type { ILogger } from "../config/ILogger.js";
import { CircuitOpenError, ProviderError } from "../errors.js";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold?: number;
  resetTimeout?: number;
  onOpen?: () => void;
  onClose?: () => void;
  /** Classifies failures that belong to the protected transport operation. */
  isFailure?: (error: unknown) => boolean;
  logger?: ILogger;
}

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
  private readonly isFailure: (error: unknown) => boolean;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? 3;
    this.resetTimeout = options.resetTimeout ?? 30000;
    this.onOpen = options.onOpen;
    this.onClose = options.onClose;
    this.log = options.logger ?? createLogger("CircuitBreaker");
    this.isFailure = options.isFailure ?? defaultFailureClassifier;
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

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime >= this.resetTimeout) {
        this.state = "HALF_OPEN";
        this.log.info("Circuito en HALF_OPEN, probando recuperación", {
          circuit: this.name,
        });
      } else {
        const error = new CircuitOpenError(this.name);
        this.log.warn(error.message, { circuit: this.name, state: this.state });
        throw error;
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error: unknown) {
      if (this.isFailure(error) && !(error instanceof CircuitOpenError)) {
        this.onFailure();
      }
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
    this.failureCount += 1;
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

  reset(): void {
    this.state = "CLOSED";
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.log.info("Circuito reseteado manualmente", { circuit: this.name });
  }
}

function defaultFailureClassifier(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return false;
  return !["cancelled", "internal", "missing_key", "circuit_open"].includes(
    error.category,
  );
}

// packages/core/src/config/ILogger.ts

/**
 * Contrato estable para logging.
 * Desacopla los consumidores de la implementación concreta (Pino).
 * Permite inyectar mocks en tests sin side-effects.
 */
export interface ILogger {
  info(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
  error(msg: string, context?: Record<string, unknown>): void;
  debug(msg: string, context?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): ILogger;
}

/** Firma mínima del child logger de Pino que el adapter necesita. */
type PinoLike = {
  info(obj: unknown, msg?: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(obj: unknown, msg?: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(obj: unknown, msg?: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(obj: unknown, msg?: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
  child(bindings: Record<string, unknown>): PinoLike;
};

type LogLevel = "info" | "warn" | "error" | "debug";

/**
 * Adapter que envuelve el child logger de Pino para satisfacer ILogger.
 * createLogger() retorna internamente una instancia de PinoLoggerAdapter.
 *
 * Pino usa la firma `(obj, msg)`; ILogger usa `(msg, context)`.
 * El adapter traduce la firma de ILogger a la de Pino:
 *   `context ? this.pino.info(context, msg) : this.pino.info(msg)`.
 *
 * Para preservar la compatibilidad con los consumidores existentes que ya
 * usan la firma nativa de Pino `(obj, msg)`, cada método acepta ambas firmas
 * vía sobrecargas y detecta el estilo según el tipo del primer argumento.
 */
export class PinoLoggerAdapter implements ILogger {
  constructor(private readonly pino: PinoLike) {}

  // ILogger: (msg, context?) — Pino: (obj, msg?)
  info(msg: string, context?: Record<string, unknown>): void;
  info(obj: Record<string, unknown>, msg?: string): void;
  info(
    a: string | Record<string, unknown>,
    b?: string | Record<string, unknown>,
  ): void {
    this.emit("info", a, b);
  }

  warn(msg: string, context?: Record<string, unknown>): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  warn(
    a: string | Record<string, unknown>,
    b?: string | Record<string, unknown>,
  ): void {
    this.emit("warn", a, b);
  }

  error(msg: string, context?: Record<string, unknown>): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  error(
    a: string | Record<string, unknown>,
    b?: string | Record<string, unknown>,
  ): void {
    this.emit("error", a, b);
  }

  debug(msg: string, context?: Record<string, unknown>): void;
  debug(obj: Record<string, unknown>, msg?: string): void;
  debug(
    a: string | Record<string, unknown>,
    b?: string | Record<string, unknown>,
  ): void {
    this.emit("debug", a, b);
  }

  child(bindings: Record<string, unknown>): ILogger {
    return new PinoLoggerAdapter(this.pino.child(bindings));
  }

  private emit(
    level: LogLevel,
    a: string | Record<string, unknown>,
    b?: string | Record<string, unknown>,
  ): void {
    if (typeof a === "string") {
      // ILogger style: (msg, context?) -> Pino (context, msg)
      if (b !== undefined) {
        this.pino[level](b as Record<string, unknown>, a);
      } else {
        this.pino[level](a);
      }
    } else if (b !== undefined) {
      // Native Pino style: (obj, msg)
      this.pino[level](a, b as string);
    } else {
      // Native Pino style: (obj)
      this.pino[level](a);
    }
  }
}

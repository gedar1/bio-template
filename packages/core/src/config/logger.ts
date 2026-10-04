import pino from "pino";
import { trace } from "@opentelemetry/api";
import { PinoLoggerAdapter } from "./ILogger.js";
export type { ILogger } from "./ILogger.js";
export { PinoLoggerAdapter } from "./ILogger.js";
export {
  startSpan,
  measureSpan,
  initTelemetry,
  shutdownTelemetry,
} from "./telemetry.js";
export type { BioLayer, SpanHandle } from "./telemetry.js";

const isDev = process.env.NODE_ENV !== "production";

// ─── Log Hook System ────────────────────────────────────────────────────────
type LogHookFn = (logObj: Record<string, unknown>) => void;
const logHooks: Set<LogHookFn> = new Set();

/**
 * Registra un hook que será invocado con cada log entry emitido.
 * Usado por ProductionServer para alimentar el LogBuffer/SSE.
 */
export function registerLogHook(fn: LogHookFn): () => void {
  logHooks.add(fn);
  return () => {
    logHooks.delete(fn);
  };
}

/**
 * Logger centralizado de BioCore.
 * - Desarrollo: pino-pretty (colores, legible)
 * - Producción: JSON estructurado (parseable por ELK, Datadog, etc.)
 *
 * Correlación automática con OpenTelemetry:
 * Cada log emitido dentro de un span activo incluye `traceId` y `spanId`,
 * permitiendo correlacionar logs con trazas en Jaeger/Datadog/Grafana.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
  // Mixin: inyecta traceId/spanId del span OTel activo en cada log
  mixin() {
    const span = trace.getActiveSpan();
    if (!span) return {};
    const { traceId, spanId, traceFlags } = span.spanContext();
    // Solo inyecta si el span es válido (traceFlags & 1 = sampled)
    if (!(traceFlags & 1)) return {};
    return { traceId, spanId };
  },
  hooks: {
    logMethod(inputArgs, method, level) {
      // Notify registered hooks with the log data
      if (logHooks.size > 0) {
        // Build a minimal log object from the arguments
        // Pino logMethod args: either [msg], [obj, msg], or [obj, msg, ...interpolation]
        const logObj: Record<string, unknown> = { level, time: Date.now() };
        if (typeof inputArgs[0] === "string") {
          logObj.msg = inputArgs[0];
        } else if (typeof inputArgs[0] === "object" && inputArgs[0] !== null) {
          Object.assign(logObj, inputArgs[0]);
          if (typeof inputArgs[1] === "string") {
            logObj.msg = inputArgs[1];
          }
        }
        for (const hook of logHooks) {
          try {
            hook(logObj);
          } catch {
            /* ignore hook errors */
          }
        }
      }
      // Call original method
      method.apply(this, inputArgs);
    },
  },
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss",
        ignore: "pid,hostname",
      },
    },
  }),
});

/**
 * Crea un child logger con contexto de capa.
 * Cada componente de BioCore usa su propio child para trazabilidad.
 * Si hay un span OTel activo, los logs incluirán traceId + spanId automáticamente.
 *
 * Retorna un PinoLoggerAdapter que satisface la interfaz ILogger, permitiendo
 * inyección de dependencias y mocks en tests. El adapter preserva la firma
 * nativa de Pino `(obj, msg)` para compatibilidad con consumidores existentes.
 *
 * @example
 * const log = createLogger("CellServer");
 * log.info("Mutación exitosa", { type: "sensory" });
 * // En producción emite: { component: "CellServer", traceId: "abc123", spanId: "def456", ... }
 */
export function createLogger(component: string): PinoLoggerAdapter {
  return new PinoLoggerAdapter(logger.child({ component }));
}

// Re-exporta context de OTel para uso en componentes que necesiten propagación manual
export { context as otelContext } from "@opentelemetry/api";

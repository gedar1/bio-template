import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  SimpleSpanProcessor,
  ConsoleSpanExporter,
  BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import {
  trace,
  context,
  SpanStatusCode,
  type Tracer,
  type Span,
  type Attributes,
} from "@opentelemetry/api";

// ─── Capas BioCore ────────────────────────────────────────────────────────────
export type BioLayer =
  | "Cortex"
  | "Orchestrator"
  | "Organism"
  | "Cell"
  | "Molecule"
  | "Atom"
  | "System";

const isDev = process.env.NODE_ENV !== "production";
const OTLP_ENDPOINT =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318/v1/traces";
const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || "biocore";
const SERVICE_VERSION = process.env.npm_package_version || "1.0.0";

// ─── SDK Singleton ─────────────────────────────────────────────────────────────
let _sdk: NodeSDK | null = null;

/**
 * Inicializa el SDK de OpenTelemetry.
 * Debe llamarse una vez al arrancar el proceso, antes de cualquier import de componentes.
 *
 * - Desarrollo: exporta spans a la consola (legible)
 * - Producción: exporta al colector OTLP (Jaeger, Datadog, Grafana Tempo, etc.)
 *
 * @example
 * // Al inicio de NervousSystem.ts o ProductionServer.ts:
 * import { initTelemetry } from "../config/telemetry.js";
 * initTelemetry();
 */
export function initTelemetry(): void {
  if (_sdk) return; // Ya inicializado

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
    "deployment.environment": process.env.NODE_ENV || "development",
  });

  const spanProcessors = isDev
    ? [new SimpleSpanProcessor(new ConsoleSpanExporter())]
    : [new BatchSpanProcessor(new OTLPTraceExporter({ url: OTLP_ENDPOINT }))];

  _sdk = new NodeSDK({
    resource,
    spanProcessors,
  });

  _sdk.start();

  // Apagado limpio
  process.on("SIGTERM", () => _sdk?.shutdown().catch(console.error));
  process.on("SIGINT", () => _sdk?.shutdown().catch(console.error));
}

/**
 * Apaga el SDK limpiamente (útil en tests o shutdown manual).
 */
export async function shutdownTelemetry(): Promise<void> {
  if (_sdk) {
    await _sdk.shutdown();
    _sdk = null;
  }
}

// ─── Tracer por capa ───────────────────────────────────────────────────────────

/**
 * Devuelve el tracer de OpenTelemetry para una capa BioCore.
 * Usa el nombre del servicio + capa para agrupar spans en el colector.
 */
export function getTracer(layer: BioLayer): Tracer {
  return trace.getTracer(`${SERVICE_NAME}.${layer}`);
}

// ─── startSpan ─────────────────────────────────────────────────────────────────

export interface SpanHandle {
  /** Span de OTel subyacente, por si necesitas agregar atributos manualmente */
  span: Span;
  /**
   * Finaliza el span con éxito y opcionalmente agrega atributos de cierre.
   * @param attributes - métricas finales: durationMs, model, tokens, etc.
   */
  end(attributes?: Attributes): void;
  /**
   * Finaliza el span marcándolo como error.
   * Registra el stack trace en el span para debugging.
   */
  fail(error: Error, attributes?: Attributes): void;
}

/**
 * Crea un span de OpenTelemetry para rastrear una operación BioCore.
 * El span queda activo en el contexto actual para que spans hijos lo hereden.
 *
 * @param layer  - Capa arquitectónica ("Cortex", "Cell", "Molecule", etc.)
 * @param operation - Nombre de la operación ("mutate", "llm_call", "tool_execution")
 * @param attributes - Atributos iniciales del span (cellType, model, tenant, etc.)
 *
 * @example
 * // En CellServer.mutate():
 * const span = startSpan("Cell", "mutate", { "cell.type": newType });
 * try {
 *   await doMutation();
 *   span.end({ "cell.duration_ms": elapsed });
 * } catch (err) {
 *   span.fail(err as Error);
 *   throw err;
 * }
 */
export function startSpan(
  layer: BioLayer,
  operation: string,
  attributes?: Attributes,
): SpanHandle {
  const tracer = getTracer(layer);
  const span = tracer.startSpan(`${layer}.${operation}`, {
    attributes: {
      "biocore.layer": layer,
      "biocore.operation": operation,
      ...attributes,
    },
  });

  // Activa el span en el contexto para propagación automática a hijos
  const ctx = trace.setSpan(context.active(), span);
  context.with(ctx, () => {}); // activa sin bloquear

  return {
    span,
    end(attrs?: Attributes) {
      if (attrs) span.setAttributes(attrs);
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
    },
    fail(error: Error, attrs?: Attributes) {
      if (attrs) span.setAttributes(attrs);
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      span.end();
    },
  };
}

/**
 * Mide una función async creando automáticamente un span.
 * Versión de conveniencia para wrap rápido sin manejar el handle.
 *
 * @example
 * const result = await measureSpan("Molecule", "db_query", () => db.find(query), { "db.table": "users" });
 */
export async function measureSpan<T>(
  layer: BioLayer,
  operation: string,
  fn: () => Promise<T>,
  attributes?: Attributes,
): Promise<T> {
  const handle = startSpan(layer, operation, attributes);
  const start = performance.now();
  try {
    const result = await fn();
    handle.end({
      "biocore.duration_ms": Math.round(performance.now() - start),
    });
    return result;
  } catch (error) {
    handle.fail(error as Error, {
      "biocore.duration_ms": Math.round(performance.now() - start),
    });
    throw error;
  }
}

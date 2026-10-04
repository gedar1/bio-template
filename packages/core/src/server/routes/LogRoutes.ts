import type { IncomingMessage, ServerResponse } from "node:http";
import { HealthServer } from "../HealthServer.js";
import { LogBuffer } from "../LogBuffer.js";
import { createLogger } from "../../config/logger.js";

const log = createLogger("LogRoutes");

/**
 * Rutas de logs: streaming SSE de log entries en tiempo real.
 * También expone un endpoint GET para obtener entries recientes.
 */
export function setupLogRoutes(
  health: HealthServer,
  logBuffer: LogBuffer,
): void {
  // Endpoint para obtener logs recientes (polling fallback)
  health.registerData("logs", async (body?: Record<string, unknown>) => {
    const limit = (body?.limit as number) || 100;
    const entries = logBuffer.getRecent(limit);
    return {
      entries,
      total: entries.length,
      bufferSize: logBuffer.size,
      subscribers: logBuffer.subscriberCount,
    };
  });

  // Registrar el handler SSE para logs/stream
  // Esto requiere acceso directo al HTTP server — usamos registerData
  // con un marcador especial que el HealthServer puede detectar.
  // Alternativa: registrar un handler SSE dedicado.
  health.registerData("logs/stream", async () => {
    // Este endpoint se maneja de forma especial via registerSSEHandler
    // Si se llama como GET normal, retorna instrucciones
    return {
      info: "Use SSE connection to /api/logs/stream for real-time streaming",
      hint: "Connect via EventSource or fetch with Accept: text/event-stream",
      recentCount: logBuffer.size,
    };
  });
}

/**
 * Handler SSE para streaming de logs.
 * Se invoca directamente desde el HealthServer cuando detecta
 * una conexión SSE a /api/logs/stream.
 *
 * @param req - HTTP request
 * @param res - HTTP response (se mantiene abierta para SSE)
 * @param logBuffer - Buffer de logs con subscriber pattern
 */
export function handleLogSSE(
  req: IncomingMessage,
  res: ServerResponse,
  logBuffer: LogBuffer,
): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  // Enviar entries recientes como batch inicial
  const recent = logBuffer.getRecent(50);
  if (recent.length > 0) {
    res.write(
      `data: ${JSON.stringify({ type: "initial", entries: recent })}\n\n`,
    );
  }

  // Suscribirse a nuevas entries
  const unsubscribe = logBuffer.subscribe((entry) => {
    try {
      res.write(`data: ${JSON.stringify({ type: "entry", entry })}\n\n`);
    } catch {
      // Connection closed
      unsubscribe();
    }
  });

  // Cleanup cuando el cliente se desconecta
  req.on("close", () => {
    unsubscribe();
    log.debug("SSE log client disconnected");
  });

  req.on("error", () => {
    unsubscribe();
  });

  log.debug("SSE log client connected");
}

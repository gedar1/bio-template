import { HealthServer } from "../HealthServer.js";
import { checkRole } from "../middleware/roleMiddleware.js";
import type { TenantManager } from "../TenantManager.js";
import type { WebSocketServerInfo } from "../types/dashboard.js";
import { createLogger } from "../../config/logger.js";

const log = createLogger("WebSocketRoutes");

/**
 * Estado interno de servidores WebSocket gestionados por el dashboard.
 * En producción, esto se sincroniza con los WS servers creados por el cell type `realtime`.
 */
interface WebSocketState {
  servers: Map<number, WebSocketServerInfo>;
}

/**
 * Rutas de WebSocket: gestión de servidores y clientes conectados.
 */
export function setupWebSocketRoutes(
  health: HealthServer,
  tenantManager: TenantManager,
): void {
  // Estado compartido de servidores WS conocidos
  const state: WebSocketState = {
    servers: new Map(),
  };

  health.registerData("websocket", async (body?: Record<string, unknown>) => {
    const tenantId = (body?.tenantId as string) || "default";

    try {
      // Intentar obtener info de WS del tenant via tool call
      const tenant = await tenantManager.getTenant(tenantId);
      const tools = await tenant.cortex.getUnifiedTools();

      // Check if realtime tools are available
      const hasRealtimeTools = tools.some(
        (t: { name: string }) =>
          t.name === "ws_list_clients" || t.name === "ws_start_server",
      );

      const servers = Array.from(state.servers.values());

      return {
        servers,
        totalServers: servers.length,
        hasRealtimeCapability: hasRealtimeTools,
      };
    } catch {
      return {
        servers: [],
        totalServers: 0,
        hasRealtimeCapability: false,
      };
    }
  });

  health.registerData(
    "websocket/broadcast",
    async (body?: Record<string, unknown>) => {
      const roleError = checkRole("admin");
      if (roleError) return roleError;

      const tenantId = (body?.tenantId as string) || "default";
      const port = body?.port as number | undefined;
      const message = body?.message as string | undefined;

      if (!port || !message) {
        return { error: "port y message requeridos" };
      }

      try {
        // Execute broadcast via tenant's cortex (uses ws_broadcast tool)
        const response = await tenantManager.chat(
          tenantId,
          `Envía un broadcast al servidor WebSocket en puerto ${port} con el mensaje: ${message}`,
        );

        log.info({ tenantId, port }, "Broadcast enviado via dashboard");
        return { broadcast: true, port, response };
      } catch (err: unknown) {
        const errMessage = err instanceof Error ? err.message : String(err);
        log.error({ error: errMessage, port }, "Error enviando broadcast");
        return { error: errMessage };
      }
    },
  );

  health.registerData(
    "websocket/disconnect",
    async (body?: Record<string, unknown>) => {
      const roleError = checkRole("admin");
      if (roleError) return roleError;

      const tenantId = (body?.tenantId as string) || "default";
      const port = body?.port as number | undefined;
      const clientId = body?.clientId as string | undefined;

      if (!port) {
        return { error: "port requerido" };
      }

      try {
        if (clientId) {
          // Disconnect specific client
          const response = await tenantManager.chat(
            tenantId,
            `Desconecta al cliente ${clientId} del servidor WebSocket en puerto ${port}`,
          );
          log.info(
            { tenantId, port, clientId },
            "Cliente desconectado via dashboard",
          );
          return { disconnected: true, clientId, response };
        } else {
          // Stop the server
          const response = await tenantManager.chat(
            tenantId,
            `Detén el servidor WebSocket en puerto ${port}`,
          );
          state.servers.delete(port);
          log.info({ tenantId, port }, "Servidor WS detenido via dashboard");
          return { stopped: true, port, response };
        }
      } catch (err: unknown) {
        const errMessage = err instanceof Error ? err.message : String(err);
        log.error({ error: errMessage, port }, "Error en operación WebSocket");
        return { error: errMessage };
      }
    },
  );
}

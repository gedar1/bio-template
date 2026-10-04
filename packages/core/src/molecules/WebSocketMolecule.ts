import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { createLogger } from "../config/logger.js";
import type {
  IWebSocket,
  WsSendResult,
  WsClientInfo,
  WsMessageHandler,
} from "./interfaces/IWebSocket.js";

const log = createLogger("WebSocketMolecule");

interface ClientEntry {
  ws: WebSocket;
  info: WsClientInfo;
}

/**
 * Molécula de WebSocket para comunicación bidireccional en tiempo real.
 *
 * Crea un servidor WebSocket que permite:
 * - Enviar mensajes a clientes específicos
 * - Hacer broadcast a todos los clientes
 * - Hacer broadcast selectivo con filtros
 * - Escuchar mensajes entrantes de clientes
 *
 * Útil para: dashboards en tiempo real, notificaciones push,
 * comunicación entre organismos, eventos del sistema.
 */
export class WebSocketMolecule implements IWebSocket {
  readonly name = "websocket";
  readonly version = "1.0.0";

  private wss: WebSocketServer | null = null;
  readonly clients: Map<string, ClientEntry> = new Map();
  private messageHandlers: WsMessageHandler[] = [];
  private port: number = 0;

  async initialize(): Promise<void> {
    log.info("WebSocketMolecule inicializada (servidor no activo aún)");
  }

  async dispose(): Promise<void> {
    await this.stopServer();
    this.messageHandlers = [];
    log.info("WebSocketMolecule disposed");
  }

  async startServer(port: number): Promise<void> {
    if (this.wss) {
      log.warn({ port: this.port }, "Servidor WebSocket ya está activo");
      return;
    }

    this.port = port;

    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port });

      this.wss.on("listening", () => {
        log.info({ port }, "Servidor WebSocket activo");
        resolve();
      });

      this.wss.on("error", (error) => {
        log.error(
          { port, error: error.message },
          "Error en servidor WebSocket",
        );
        reject(error);
      });

      this.wss.on("connection", (ws, req) => {
        const clientId = randomUUID();
        const info: WsClientInfo = {
          id: clientId,
          connectedAt: Date.now(),
          remoteAddress: req.socket.remoteAddress,
        };

        this.clients.set(clientId, { ws, info });
        log.info(
          { clientId, remoteAddress: info.remoteAddress },
          "Cliente conectado",
        );

        // Enviar ID al cliente para que se identifique
        ws.send(JSON.stringify({ type: "connected", clientId }));

        ws.on("message", async (rawData: Buffer) => {
          const message = String(rawData);
          log.debug(
            { clientId, messageLength: message.length },
            "Mensaje recibido",
          );

          try {
            // Intentar parsear como JSON para extraer metadata
            const parsed = JSON.parse(message);
            for (const handler of this.messageHandlers) {
              await handler(
                clientId,
                parsed.message || message,
                parsed.metadata,
              );
            }
          } catch {
            // Si no es JSON, pasar como string plano
            for (const handler of this.messageHandlers) {
              await handler(clientId, message);
            }
          }
        });

        ws.on("close", () => {
          this.clients.delete(clientId);
          log.info({ clientId }, "Cliente desconectado");
        });

        ws.on("error", (error) => {
          log.error(
            { clientId, error: error.message },
            "Error en cliente WebSocket",
          );
          this.clients.delete(clientId);
        });
      });
    });
  }

  async stopServer(): Promise<void> {
    if (!this.wss) return;

    // Notificar a todos los clientes antes de cerrar
    for (const [, { ws }] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "server_shutdown" }));
        ws.close(1000, "Server shutting down");
      }
    }

    return new Promise((resolve) => {
      this.wss!.close(() => {
        log.info({ port: this.port }, "Servidor WebSocket detenido");
        this.clients.clear();
        this.wss = null;
        resolve();
      });
    });
  }

  async send(clientId: string, message: string): Promise<WsSendResult> {
    const entry = this.clients.get(clientId);
    if (!entry) {
      return {
        success: false,
        clientsReached: 0,
        error: `Cliente '${clientId}' no encontrado`,
      };
    }

    if (entry.ws.readyState !== WebSocket.OPEN) {
      this.clients.delete(clientId);
      return {
        success: false,
        clientsReached: 0,
        error: `Cliente '${clientId}' no está conectado`,
      };
    }

    try {
      entry.ws.send(JSON.stringify({ type: "message", data: message }));
      return { success: true, clientsReached: 1 };
    } catch (error: any) {
      return { success: false, clientsReached: 0, error: error.message };
    }
  }

  async broadcast(message: string): Promise<WsSendResult> {
    let reached = 0;
    const payload = JSON.stringify({ type: "broadcast", data: message });

    for (const [clientId, { ws }] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(payload);
          reached++;
        } catch (error: any) {
          log.error(
            { clientId, error: error.message },
            "Error enviando broadcast",
          );
          this.clients.delete(clientId);
        }
      } else {
        this.clients.delete(clientId);
      }
    }

    log.debug({ reached, total: this.clients.size }, "Broadcast enviado");
    return { success: reached > 0, clientsReached: reached };
  }

  async broadcastTo(
    filter: (client: WsClientInfo) => boolean,
    message: string,
  ): Promise<WsSendResult> {
    let reached = 0;
    const payload = JSON.stringify({ type: "broadcast", data: message });

    for (const [clientId, { ws, info }] of this.clients) {
      if (ws.readyState === WebSocket.OPEN && filter(info)) {
        try {
          ws.send(payload);
          reached++;
        } catch (error: any) {
          log.error(
            { clientId, error: error.message },
            "Error enviando broadcast selectivo",
          );
          this.clients.delete(clientId);
        }
      }
    }

    return { success: reached > 0, clientsReached: reached };
  }

  onMessage(handler: WsMessageHandler): void {
    this.messageHandlers.push(handler);
  }

  getClients(): WsClientInfo[] {
    return Array.from(this.clients.values()).map(({ info }) => info);
  }

  getClientCount(): number {
    return this.clients.size;
  }

  disconnectClient(clientId: string): void {
    const entry = this.clients.get(clientId);
    if (entry) {
      entry.ws.close(1000, "Disconnected by server");
      this.clients.delete(clientId);
      log.info({ clientId }, "Cliente desconectado por el servidor");
    }
  }

  isRunning(): boolean {
    return this.wss !== null;
  }

  /**
   * Permite asociar metadata a un cliente (ej: tenantId, userId).
   * Útil para broadcastTo con filtros.
   */
  setClientMetadata(clientId: string, metadata: Record<string, any>): void {
    const entry = this.clients.get(clientId);
    if (entry) {
      entry.info.metadata = { ...entry.info.metadata, ...metadata };
    }
  }
}

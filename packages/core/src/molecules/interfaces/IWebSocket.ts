import type { IMolecule } from "./IMolecule.js";

/**
 * Resultado de enviar un mensaje WebSocket.
 */
export interface WsSendResult {
  success: boolean;
  clientsReached: number;
  error?: string;
}

/**
 * Información de un cliente WebSocket conectado.
 */
export interface WsClientInfo {
  id: string;
  connectedAt: number;
  remoteAddress?: string;
  metadata?: Record<string, any>;
}

/**
 * Handler para mensajes entrantes de WebSocket.
 */
export type WsMessageHandler = (
  clientId: string,
  message: string,
  metadata?: Record<string, any>,
) => void | Promise<void>;

/**
 * Contrato para moléculas de comunicación WebSocket bidireccional.
 *
 * Permite crear un servidor WebSocket, enviar mensajes a clientes conectados,
 * hacer broadcast y escuchar mensajes entrantes.
 *
 * @example
 * const ws = new WebSocketMolecule();
 * await ws.startServer(8080);
 * ws.onMessage((clientId, msg) => console.log(`${clientId}: ${msg}`));
 * await ws.broadcast("Hola a todos");
 * await ws.send("client-1", "Mensaje directo");
 * await ws.stopServer();
 */
export interface IWebSocket extends IMolecule {
  /** Inicia el servidor WebSocket en el puerto especificado */
  startServer(port: number): Promise<void>;

  /** Detiene el servidor WebSocket y cierra todas las conexiones */
  stopServer(): Promise<void>;

  /** Envía un mensaje a un cliente específico por su ID */
  send(clientId: string, message: string): Promise<WsSendResult>;

  /** Envía un mensaje a todos los clientes conectados */
  broadcast(message: string): Promise<WsSendResult>;

  /** Envía un mensaje a clientes que cumplan un filtro de metadata */
  broadcastTo(
    filter: (client: WsClientInfo) => boolean,
    message: string,
  ): Promise<WsSendResult>;

  /** Registra un handler para mensajes entrantes */
  onMessage(handler: WsMessageHandler): void;

  /** Lista los clientes conectados */
  getClients(): WsClientInfo[];

  /** Número de clientes conectados */
  getClientCount(): number;

  /** Desconecta un cliente específico */
  disconnectClient(clientId: string): void;

  /** Indica si el servidor está activo */
  isRunning(): boolean;
}

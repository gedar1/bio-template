import { withApiKeyParam } from "./useApi";

/**
 * Conexión SSE compartida a /api/logs/stream. Toda la app usa una sola EventSource:
 * - Se abre con el primer suscriptor y se cierra 5 s después del último, para que un
 *   cambio de sección no reabra la conexión.
 * - Guarda el historial de la conexión actual. Un suscriptor que lo pida (replay)
 *   recibe los mensajes ya llegados antes de los nuevos.
 */

export interface LogStreamMessage {
  type: string;
  // El backend envía "initial" con entries y "entry" con entry; el resto del payload no se valida aquí.
  [key: string]: any;
}

export interface LogStreamStatus {
  connected: boolean;
  error: string | null;
}

type MessageHandler = (msg: LogStreamMessage) => void;
type StatusHandler = (status: LogStreamStatus) => void;

const MAX_HISTORY = 1000;
const CLOSE_DELAY_MS = 5000;
const RECONNECT_DELAY_MS = 3000;

let source: EventSource | null = null;
let connected = false;
let lastError: string | null = null;
let history: LogStreamMessage[] = [];
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const messageHandlers = new Set<MessageHandler>();
const statusHandlers = new Set<StatusHandler>();

function currentStatus(): LogStreamStatus {
  return { connected, error: lastError };
}

function emitStatus(): void {
  const status = currentStatus();
  for (const handler of statusHandlers) handler(status);
}

function openSource(): void {
  if (source) return;
  // El servidor envía "initial" en cada conexión nueva: el historial anterior ya no aplica.
  history = [];
  const es = new EventSource(withApiKeyParam("/api/logs/stream"));
  source = es;

  es.onopen = () => {
    connected = true;
    lastError = null;
    emitStatus();
  };

  es.onmessage = (event) => {
    let msg: LogStreamMessage;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    history.push(msg);
    if (history.length > MAX_HISTORY) {
      history.splice(0, history.length - MAX_HISTORY);
    }
    for (const handler of messageHandlers) handler(msg);
  };

  es.onerror = () => {
    connected = false;
    lastError = "Conexión perdida. Reconectando...";
    emitStatus();
    es.close();
    source = null;
    if (messageHandlers.size > 0 && !reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (messageHandlers.size > 0) openSource();
      }, RECONNECT_DELAY_MS);
    }
  };
}

function closeSource(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (source) {
    source.close();
    source = null;
  }
  connected = false;
  lastError = null;
  emitStatus();
}

export interface SubscribeOptions {
  /** Entrega al suscriptor los mensajes ya recibidos en esta conexión. */
  replay?: boolean;
}

/**
 * Suscribe un handler a los mensajes del stream de logs. Devuelve la función para
 * cancelar la suscripción.
 */
export function subscribeLogStream(
  handler: MessageHandler,
  options: SubscribeOptions = {},
): () => void {
  if (options.replay) {
    for (const msg of history) handler(msg);
  }
  messageHandlers.add(handler);

  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  openSource();

  return () => {
    messageHandlers.delete(handler);
    if (messageHandlers.size === 0 && !closeTimer) {
      closeTimer = setTimeout(() => {
        closeTimer = null;
        if (messageHandlers.size === 0) closeSource();
      }, CLOSE_DELAY_MS);
    }
  };
}

/**
 * Suscribe a los cambios de estado de la conexión. Llama al handler con el estado
 * actual al suscribirse. Devuelve la función para cancelar la suscripción.
 */
export function subscribeLogStatus(handler: StatusHandler): () => void {
  statusHandlers.add(handler);
  handler(currentStatus());
  return () => {
    statusHandlers.delete(handler);
  };
}

import { useState } from "react";
import { Radio, Square, X } from "lucide-react";
import { useApi } from "../../hooks/useApi";
import { useRole } from "../../context/RoleContext";
import { RoleGuard } from "../RoleGuard";
import type {
  WebSocketServerInfo,
  WebSocketClientInfo,
} from "../../types/dashboard";
import type {
  WebSocketPanelProps,
  WebSocketApiResponse,
} from "./WebSocketPanel.types";

/**
 * WebSocketPanel — displays active servers with port/status/client count,
 * client list with connection duration, broadcast message form,
 * disconnect/stop controls.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */
export const WebSocketPanel: React.FC<WebSocketPanelProps> = ({ tenantId }) => {
  const { data, loading, error, refetch } = useApi<WebSocketApiResponse>(
    `/api/websocket?tenantId=${tenantId}`,
    5000,
  );

  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcastTarget, setBroadcastTarget] = useState<number | null>(null);
  const [broadcasting, setBroadcasting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const servers = data?.servers ?? [];

  const handleBroadcast = async () => {
    if (!broadcastMessage.trim() || broadcastTarget === null) return;
    setBroadcasting(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await fetch("/api/websocket/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          port: broadcastTarget,
          message: broadcastMessage,
          tenantId,
        }),
      });
      const json = await res.json();

      if (!res.ok || json.error) {
        setActionError(json.error ?? `Error ${res.status}`);
      } else {
        setActionSuccess("Mensaje enviado correctamente");
        setBroadcastMessage("");
        setTimeout(() => setActionSuccess(null), 3000);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setActionError(message);
    } finally {
      setBroadcasting(false);
    }
  };

  const handleDisconnect = async (port: number, clientId: string) => {
    setActionError(null);
    try {
      const res = await fetch("/api/websocket/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port, clientId, tenantId }),
      });
      const json = await res.json();

      if (!res.ok || json.error) {
        setActionError(json.error ?? `Error ${res.status}`);
      } else {
        refetch();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setActionError(message);
    }
  };

  const handleStopServer = async (port: number) => {
    setActionError(null);
    try {
      const res = await fetch("/api/websocket/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port, stopServer: true, tenantId }),
      });
      const json = await res.json();

      if (!res.ok || json.error) {
        setActionError(json.error ?? `Error ${res.status}`);
      } else {
        refetch();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setActionError(message);
    }
  };

  if (loading) {
    return (
      <div className="text-gray-400">Cargando servidores WebSocket...</div>
    );
  }

  if (error) {
    return <div className="text-red-400">Error: {error}</div>;
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <h3 className="text-gray-300 text-sm font-medium mb-3">
        WebSocket — Servidores en Tiempo Real
      </h3>

      {/* Error/Success messages */}
      {actionError && (
        <div className="text-red-400 text-xs bg-red-900/30 px-3 py-1.5 rounded mb-3">
          {actionError}
        </div>
      )}
      {actionSuccess && (
        <div className="text-green-400 text-xs bg-green-900/30 px-3 py-1.5 rounded mb-3">
          {actionSuccess}
        </div>
      )}

      {/* Broadcast form (Req 9.3) */}
      <RoleGuard action="websocket-broadcast">
        <div className="mb-4 p-3 bg-gray-900 rounded-lg border border-gray-700">
          <div className="text-gray-400 text-xs font-medium mb-2">
            Broadcast Message
          </div>
          <div className="flex gap-2">
            <select
              value={broadcastTarget ?? ""}
              onChange={(e) =>
                setBroadcastTarget(
                  e.target.value ? Number(e.target.value) : null,
                )
              }
              className="bg-gray-800 text-white rounded px-2 py-1 text-xs border border-gray-600 focus:border-blue-500 focus:outline-none"
              aria-label="Seleccionar servidor"
            >
              <option value="">Servidor...</option>
              {servers
                .filter((s) => s.status === "running")
                .map((s) => (
                  <option key={s.port} value={s.port}>
                    :{s.port} ({s.clientCount} clientes)
                  </option>
                ))}
            </select>
            <input
              type="text"
              value={broadcastMessage}
              onChange={(e) => setBroadcastMessage(e.target.value)}
              placeholder="Mensaje a enviar..."
              className="flex-1 bg-gray-800 text-white rounded px-2 py-1 text-xs border border-gray-600 focus:border-blue-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleBroadcast}
              disabled={
                !broadcastMessage.trim() ||
                broadcastTarget === null ||
                broadcasting
              }
              className="bg-blue-600 text-white px-3 py-1 rounded text-xs hover:bg-blue-700 disabled:opacity-50"
            >
              {broadcasting ? (
                "Enviando..."
              ) : (
                <>
                  <Radio size={14} className="inline" /> Enviar
                </>
              )}
            </button>
          </div>
        </div>
      </RoleGuard>

      {/* Server list (Req 9.1) */}
      <div className="space-y-3">
        {servers.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-gray-500 text-3xl mb-3">
              <Radio size={32} className="mx-auto text-gray-500" />
            </div>
            <div className="text-gray-400 text-sm">
              No hay servidores WebSocket activos.
            </div>
            <div className="text-gray-500 text-xs mt-1">
              Usa el chat para iniciar uno.
            </div>
          </div>
        ) : (
          servers.map((server) => (
            <ServerCard
              key={server.port}
              server={server}
              onDisconnect={(clientId) =>
                handleDisconnect(server.port, clientId)
              }
              onStop={() => handleStopServer(server.port)}
            />
          ))
        )}
      </div>
    </div>
  );
};

// ─── Sub-Components ─────────────────────────────────────────────────────────

interface ServerCardProps {
  server: WebSocketServerInfo;
  onDisconnect: (clientId: string) => void;
  onStop: () => void;
}

function ServerCard({
  server,
  onDisconnect,
  onStop,
}: Readonly<ServerCardProps>) {
  const [showClients, setShowClients] = useState(false);
  const { role } = useRole();

  const statusConfig: Record<
    string,
    { color: string; bgColor: string; label: string }
  > = {
    running: {
      color: "text-green-400",
      bgColor: "bg-green-600",
      label: "running",
    },
    stopped: {
      color: "text-gray-400",
      bgColor: "bg-gray-600",
      label: "stopped",
    },
    error: { color: "text-red-400", bgColor: "bg-red-600", label: "error" },
  };

  const config = statusConfig[server.status] ?? statusConfig.stopped;

  return (
    <div className="bg-gray-900 rounded-lg p-3 border border-gray-700">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <span className="text-gray-200 text-sm font-mono font-medium">
            :{server.port}
          </span>
          <span
            className={`px-1.5 py-0.5 rounded text-xs text-white ${config.bgColor}`}
          >
            {config.label}
          </span>
          <span className="text-gray-500 text-xs">
            {server.clientCount} cliente{server.clientCount !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {server.clients.length > 0 && (
            <button
              type="button"
              onClick={() => setShowClients(!showClients)}
              className="text-gray-400 text-xs hover:text-gray-200"
            >
              {showClients ? "Ocultar" : "Ver clientes"}
            </button>
          )}
          {/* Stop server control (Req 9.4) */}
          {(role === "admin" || role === "super_admin") &&
            server.status === "running" && (
              <button
                type="button"
                onClick={onStop}
                className="text-red-400 text-xs hover:text-red-300 border border-red-700/50 rounded px-2 py-0.5 inline-flex items-center gap-1"
              >
                <Square size={12} /> Detener
              </button>
            )}
        </div>
      </div>

      {/* Client list (Req 9.2) */}
      {showClients && server.clients.length > 0 && (
        <div className="mt-2 space-y-1 ml-2">
          {server.clients.map((client) => (
            <ClientRow
              key={client.id}
              client={client}
              canDisconnect={role === "admin" || role === "super_admin"}
              onDisconnect={() => onDisconnect(client.id)}
            />
          ))}
        </div>
      )}

      {/* Error display (Req 9.5) */}
      {server.status === "error" && (
        <div className="mt-2 text-xs text-red-400 bg-red-900/20 rounded px-2 py-1">
          Error al iniciar servidor. Verifique que el puerto :{server.port} no
          esté en uso.
        </div>
      )}
    </div>
  );
}

interface ClientRowProps {
  client: WebSocketClientInfo;
  canDisconnect: boolean;
  onDisconnect: () => void;
}

function ClientRow({
  client,
  canDisconnect,
  onDisconnect,
}: Readonly<ClientRowProps>) {
  const duration = formatDuration(Date.now() - client.connectedAt);

  return (
    <div className="flex items-center justify-between text-xs bg-gray-800 rounded px-2 py-1.5 border border-gray-700">
      <div className="flex items-center gap-3">
        <span className="text-gray-300 font-mono">{client.id}</span>
        <span className="text-gray-500">{client.remoteAddress}</span>
        <span className="text-gray-500">conectado {duration}</span>
      </div>
      {canDisconnect && (
        <button
          type="button"
          onClick={onDisconnect}
          className="text-red-400 hover:text-red-300 text-xs"
          title="Desconectar cliente"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;

  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

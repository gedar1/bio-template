import { ClipboardList } from "lucide-react";
import { useApi } from "../../hooks/useApi";

interface ActivityEntry {
  taskId: string;
  taskName: string;
  timestamp: number;
  status: "ok" | "error";
  result: string;
}

interface ActivityData {
  activity: ActivityEntry[];
}

export function ActivityPanel() {
  const { data, loading } = useApi<ActivityData>(
    "/api/scheduler/activity",
    5000,
  );

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString("es", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const formatAgo = (ts: number) => {
    const diff = Math.round((Date.now() - ts) / 1000);
    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.round(diff / 60)}m`;
    return `${Math.round(diff / 3600)}h`;
  };

  if (loading)
    return <div className="text-gray-400">Cargando actividad...</div>;

  const entries = data?.activity || [];

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <h3 className="text-gray-300 text-sm font-medium mb-3">
        Actividad del Scheduler ({entries.length})
      </h3>

      {entries.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-gray-500 text-3xl mb-3">
            <ClipboardList size={32} className="mx-auto text-gray-500" />
          </div>
          <div className="text-gray-400 text-sm">Sin actividad reciente.</div>
          <div className="text-gray-500 text-xs mt-1">
            Las ejecuciones del scheduler aparecerán aquí.
          </div>
        </div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {entries.map((entry, i) => (
            <div
              key={`${entry.taskId}-${entry.timestamp}-${i}`}
              className="p-3 bg-gray-900 rounded-lg"
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${entry.status === "ok" ? "bg-green-500" : "bg-red-500"}`}
                  />
                  <span className="text-white text-sm font-mono">
                    {entry.taskName}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span>{formatTime(entry.timestamp)}</span>
                  <span>({formatAgo(entry.timestamp)} atrás)</span>
                </div>
              </div>
              <div
                className={`text-sm mt-1 leading-relaxed ${entry.status === "ok" ? "text-gray-300" : "text-red-400"}`}
              >
                {entry.result.length > 300
                  ? entry.result.substring(0, 300) + "..."
                  : entry.result}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

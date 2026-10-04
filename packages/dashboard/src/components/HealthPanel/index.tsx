import { useApi } from "../../hooks/useApi";
import { StatusCard } from "../StatusCard";

interface HealthData {
  status: "ok" | "degraded" | "down";
  uptime: number;
  version: string;
  checks: Record<string, boolean>;
}

export function HealthPanel() {
  const { data, error, loading } = useApi<HealthData>("/health", 5000);

  if (loading) return <div className="text-gray-400">Cargando...</div>;
  if (error) return <div className="text-red-400">Error: {error}</div>;
  if (!data) return null;

  const formatUptime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatusCard
        title="Estado"
        value={data.status.toUpperCase()}
        status={data.status}
      />
      <StatusCard title="Uptime" value={formatUptime(data.uptime)} />
      <StatusCard title="Versión" value={data.version} />
      <StatusCard
        title="Checks"
        value={`${Object.values(data.checks).filter(Boolean).length}/${Object.keys(data.checks).length}`}
        status={Object.values(data.checks).every(Boolean) ? "ok" : "degraded"}
      />
    </div>
  );
}

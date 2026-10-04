import { useApi } from "../../hooks/useApi";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface PerfSummary {
  [operation: string]: {
    count: number;
    avgMs: number;
    minMs: number;
    maxMs: number;
  };
}

export function PerfPanel({ tenantId }: { tenantId: string }) {
  const { data, loading } = useApi<PerfSummary>(
    `/api/perf?tenantId=${tenantId}`,
    10000,
  );

  if (loading) return <div className="text-gray-400">Cargando métricas...</div>;
  if (!data || Object.keys(data).length === 0) {
    return (
      <div className="text-gray-500 text-sm">
        Sin métricas aún. Interactúa con el Cortex para generar datos.
      </div>
    );
  }

  const chartData = Object.entries(data).map(([op, stats]) => ({
    name: op.replace("tool:", ""),
    avg: stats.avgMs,
    count: stats.count,
  }));

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <h3 className="text-gray-300 text-sm font-medium mb-4">
        Latencia por Operación (ms)
      </h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData}>
          <XAxis dataKey="name" tick={{ fill: "#9ca3af", fontSize: 12 }} />
          <YAxis tick={{ fill: "#9ca3af", fontSize: 12 }} />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1f2937",
              border: "1px solid #374151",
              borderRadius: 8,
            }}
            labelStyle={{ color: "#e5e7eb" }}
          />
          <Bar dataKey="avg" fill="#3b82f6" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

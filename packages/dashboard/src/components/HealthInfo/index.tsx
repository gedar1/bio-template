import { Clock } from "lucide-react";
import { useApi } from "../../hooks/useApi";

interface HealthData {
  status: string;
  uptime: number;
  version: string;
  checks: Record<string, boolean>;
}

const formatUptime = (s: number): string => {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

export const HealthInfo: React.FC = () => {
  const { data } = useApi<HealthData>("/health", 5000);

  if (!data) return null;

  const uptime = data.uptime ?? 0;
  const checks = data.checks ?? {};
  const passedChecks = Object.values(checks).filter(Boolean).length;
  const totalChecks = Object.keys(checks).length;

  return (
    <div className="flex items-center gap-3 text-xs text-gray-400">
      <span className="flex items-center gap-1" title="Uptime">
        <Clock size={12} /> {formatUptime(uptime)}
      </span>
      <span className="text-gray-700">│</span>
      <span title="Versión">v{data.version}</span>
      {totalChecks > 0 && (
        <>
          <span className="text-gray-700">│</span>
          <span
            className={
              passedChecks === totalChecks
                ? "text-green-400"
                : "text-yellow-400"
            }
            title={`Checks: ${passedChecks}/${totalChecks}`}
          >
            ✓ {passedChecks}/{totalChecks}
          </span>
        </>
      )}
    </div>
  );
};

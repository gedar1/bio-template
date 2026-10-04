import { useApi } from "../../hooks/useApi";

const STATUS_CONFIG: Record<
  string,
  { color: string; pulse: boolean; label: string }
> = {
  ok: { color: "bg-green-500", pulse: false, label: "Sistema operativo" },
  degraded: { color: "bg-yellow-500", pulse: true, label: "Degradado" },
  down: { color: "bg-red-500", pulse: true, label: "Caído" },
  unknown: { color: "bg-gray-500", pulse: false, label: "Conectando..." },
};

export const HealthSemaphore: React.FC = () => {
  const { data } = useApi<{ status: string }>("/health", 5000);
  const status = data?.status ?? "unknown";

  const { color, pulse, label } =
    STATUS_CONFIG[status] ?? STATUS_CONFIG.unknown;

  return (
    <div className="flex items-center gap-1.5" title={label}>
      <span
        className={`w-2.5 h-2.5 rounded-full ${color} ${pulse ? "animate-pulse" : ""}`}
      />
    </div>
  );
};

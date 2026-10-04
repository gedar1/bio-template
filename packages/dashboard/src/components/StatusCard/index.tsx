interface Props {
  title: string;
  value: string | number;
  status?: "ok" | "degraded" | "down";
}

const colors = {
  ok: "bg-green-500",
  degraded: "bg-yellow-500",
  down: "bg-red-500",
};

export function StatusCard({ title, value, status }: Readonly<Props>) {
  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-400 text-sm">{title}</span>
        {status && (
          <span className={`w-2.5 h-2.5 rounded-full ${colors[status]}`} />
        )}
      </div>
      <div className="text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}

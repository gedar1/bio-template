import { useState } from "react";
import { useApi } from "../../hooks/useApi";

interface TenantsData {
  tenants: Array<{ id: string; idleSeconds: number }>;
  total: number;
}

interface Props {
  current: string;
  onChange: (id: string) => void;
}

export function TenantSelector({ current, onChange }: Props) {
  const [newId, setNewId] = useState("");
  const { data } = useApi<TenantsData>("/api/tenants", 5000);

  const addTenant = () => {
    if (newId.trim()) {
      onChange(newId.trim());
      setNewId("");
    }
  };

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-gray-400 text-sm">Tenant:</span>
      {data?.tenants.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-3 py-1 rounded text-sm ${
            t.id === current
              ? "bg-blue-600 text-white"
              : "bg-gray-700 text-gray-300 hover:bg-gray-600"
          }`}
        >
          {t.id}
          <span className="ml-1 text-xs opacity-60">({t.idleSeconds}s)</span>
        </button>
      ))}
      <div className="flex gap-1">
        <input
          type="text"
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTenant()}
          placeholder="nuevo tenant..."
          className="bg-gray-900 text-white rounded px-2 py-1 text-sm border border-gray-600 w-32 focus:border-blue-500 focus:outline-none"
        />
        <button
          onClick={addTenant}
          disabled={!newId.trim()}
          className="bg-gray-700 text-gray-300 px-2 py-1 rounded text-sm hover:bg-gray-600 disabled:opacity-50"
        >
          +
        </button>
      </div>
    </div>
  );
}

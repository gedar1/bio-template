import { useApi } from "../../../hooks/useApi";
import type {
  RestaurantWidgetsProps,
  OrderSummary,
  DailySummaryData,
  StockAlert,
} from "./RestaurantWidgets.types";

export const RestaurantWidgets: React.FC<RestaurantWidgetsProps> = ({
  tenantId,
}) => {
  const { data: orders } = useApi<{ orders: OrderSummary[] }>(
    `/api/orders/active?tenantId=${tenantId}`,
    5000,
  );
  const { data: summary } = useApi<DailySummaryData>(
    `/api/orders/summary?tenantId=${tenantId}`,
    10000,
  );
  const { data: alerts } = useApi<{ alerts: StockAlert[] }>(
    `/api/inventory/alerts?tenantId=${tenantId}`,
    15000,
  );

  const activeOrders = orders?.orders || [];
  const stockAlerts = alerts?.alerts || [];

  return (
    <div className="space-y-4">
      {/* Resumen del día */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
          <p className="text-xs text-gray-400">Pedidos hoy</p>
          <p className="text-2xl font-bold text-white">
            {summary?.totalOrders ?? "—"}
          </p>
        </div>
        <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
          <p className="text-xs text-gray-400">Ingresos</p>
          <p className="text-2xl font-bold text-emerald-400">
            ${summary?.totalRevenue?.toLocaleString() ?? "—"}
          </p>
        </div>
        <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
          <p className="text-xs text-gray-400">Ticket promedio</p>
          <p className="text-2xl font-bold text-blue-400">
            ${summary?.avgOrderValue?.toFixed(0) ?? "—"}
          </p>
        </div>
      </div>

      {/* Pedidos activos */}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">
          🍔 Pedidos activos ({activeOrders.length})
        </h3>
        {activeOrders.length === 0 ? (
          <p className="text-xs text-gray-500">Sin pedidos activos</p>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {activeOrders.map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between bg-gray-750 rounded px-3 py-2 border border-gray-600"
              >
                <div className="flex items-center gap-2">
                  <StatusBadge status={order.status} />
                  <span className="text-xs text-gray-300">
                    #{order.id}{" "}
                    {order.table
                      ? `Mesa ${order.table}`
                      : order.customerName || ""}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">
                    {order.items
                      .map((i) => `${i.quantity}x ${i.name}`)
                      .join(", ")}
                  </span>
                  <span className="text-xs font-medium text-emerald-400">
                    ${order.total}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Alertas de stock */}
      {stockAlerts.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-4 border border-amber-700/50">
          <h3 className="text-sm font-semibold text-amber-400 mb-2">
            ⚠️ Stock bajo ({stockAlerts.length})
          </h3>
          <div className="space-y-1">
            {stockAlerts.map((alert) => (
              <div key={alert.item} className="flex justify-between text-xs">
                <span className="text-gray-300">{alert.item}</span>
                <span className="text-amber-400">
                  {alert.current} {alert.unit} (mín: {alert.minimum})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Sub-componente: badge de estado ─────────────────────────────────────────

const StatusBadge: React.FC<{ status: OrderSummary["status"] }> = ({
  status,
}) => {
  const config: Record<string, { color: string; label: string }> = {
    pending: { color: "bg-yellow-500", label: "Pendiente" },
    preparing: { color: "bg-blue-500", label: "Preparando" },
    ready: { color: "bg-emerald-500", label: "Listo" },
    delivered: { color: "bg-gray-500", label: "Entregado" },
    cancelled: { color: "bg-red-500", label: "Cancelado" },
  };

  const { color, label } = config[status] || config.pending;

  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${color}`}
      title={label}
    />
  );
};

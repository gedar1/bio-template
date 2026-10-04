export interface RestaurantWidgetsProps {
  tenantId: string;
}

export interface OrderSummary {
  id: number;
  items: Array<{ name: string; quantity: number }>;
  status: "pending" | "preparing" | "ready" | "delivered" | "cancelled";
  table?: string;
  customerName?: string;
  total: number;
  createdAt: number;
}

export interface DailySummaryData {
  totalOrders: number;
  totalRevenue: number;
  avgOrderValue: number;
}

export interface StockAlert {
  item: string;
  current: number;
  minimum: number;
  unit: string;
}

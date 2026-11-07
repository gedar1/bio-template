export interface ActivityEntry {
  taskId: string;
  taskName: string;
  timestamp: number;
  status: "ok" | "error";
  result: string;
}

export interface ActivityData {
  activity: ActivityEntry[];
}

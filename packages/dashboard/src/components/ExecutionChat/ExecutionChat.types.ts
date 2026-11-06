export interface ExecutionChatProps {
  tenantId: string;
}

/** Etapa visible de una ejecución, en el orden en que ocurren */
export type ExecutionStage =
  | "detecting"
  | "executing"
  | "persisting"
  | "done"
  | "error";

export type StepStatus = "pending" | "running" | "ok" | "error";

export interface ExecutionStep {
  tool: string;
  status: StepStatus;
}

/** Evento que emite el backend (o el mock) durante una ejecución */
export type ExecutionEvent =
  | { type: "detecting" }
  | { type: "chain"; steps: string[] }
  | { type: "step"; index: number; status: StepStatus }
  | { type: "persisting" }
  | { type: "done"; summary: string }
  | { type: "error"; message: string };

export interface ExecutionRun {
  id: string;
  prompt: string;
  stage: ExecutionStage;
  steps: ExecutionStep[];
  summary?: string;
  errorMessage?: string;
}

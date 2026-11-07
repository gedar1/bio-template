import type {
  ExecutionEvent,
  ExecutionRun,
  ExecutionStage,
} from "./ExecutionChat.types";

export function createRun(id: string, prompt: string): ExecutionRun {
  return { id, prompt, stage: "detecting", steps: [] };
}

export function isTerminalStage(stage: ExecutionStage): boolean {
  return stage === "done" || stage === "error";
}

/**
 * Aplica un evento a una ejecución y devuelve una nueva copia.
 * Función pura: no toca red ni timers, así se puede probar sin UI.
 */
export function reduceExecutionEvent(
  run: ExecutionRun,
  event: ExecutionEvent,
): ExecutionRun {
  switch (event.type) {
    case "detecting":
      return { ...run, stage: "detecting" };
    case "chain":
      return {
        ...run,
        stage: "executing",
        steps: event.steps.map((tool) => ({ tool, status: "pending" })),
      };
    case "step":
      return {
        ...run,
        stage: "executing",
        steps: run.steps.map((step, i) =>
          i === event.index ? { ...step, status: event.status } : step,
        ),
      };
    case "persisting":
      return { ...run, stage: "persisting" };
    case "done":
      return { ...run, stage: "done", summary: event.summary };
    case "error":
      return { ...run, stage: "error", errorMessage: event.message };
  }
}

import type { ExecutionEvent } from "./ExecutionChat.types";
import { toolLabel } from "./toolLabels";

/**
 * Duración mínima de cada etapa. Es el perceived delay: aunque la
 * respuesta llegue rápido, la UI muestra cada estado el tiempo suficiente
 * para que el usuario lo lea.
 */
const MIN_STAGE_MS = 100;
const STEP_MS = 1500;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Cadena simulada a partir del texto. Solo para validar la UI:
 * el backend real la devolverá con Jev.
 * Las intenciones se evalúan por separado para que "busca" nunca dispare "guarda".
 */
export function planMockChain(prompt: string): string[] {
  const lower = prompt.toLowerCase();
  const chain: string[] = [];
  if (/scrap|web|url|http/.test(lower)) chain.push("scrape_url");
  if (/busca|consult|encuentr|find/.test(lower)) chain.push("db_find");
  if (/guard|registr|insert/.test(lower)) chain.push("db_insert");
  if (chain.length === 0) chain.push("db_query");
  return chain;
}

/**
 * Emite una ejecución simulada. Si el texto contiene "falla", el último
 * paso termina en error para validar ese estado.
 */
export async function runMockExecution(
  prompt: string,
  emit: (event: ExecutionEvent) => void,
  isCancelled: () => boolean,
  attempt = 1,
): Promise<void> {
  const steps = planMockChain(prompt);
  // Solo falla en el primer intento, para poder validar que reintentar funciona
  const shouldFail = prompt.toLowerCase().includes("falla") && attempt === 1;

  emit({ type: "detecting" });
  await sleep(MIN_STAGE_MS);
  if (isCancelled()) return;

  emit({ type: "chain", steps });

  for (let i = 0; i < steps.length; i++) {
    emit({ type: "step", index: i, status: "running" });
    await sleep(STEP_MS);
    if (isCancelled()) return;

    const isLast = i === steps.length - 1;
    if (shouldFail && isLast) {
      emit({ type: "step", index: i, status: "error" });
      emit({
        type: "error",
        message: `No se pudo completar "${toolLabel(steps[i])}". Intenta de nuevo.`,
      });
      return;
    }
    emit({ type: "step", index: i, status: "ok" });
  }

  if (steps.includes("db_insert")) {
    emit({ type: "persisting" });
    await sleep(MIN_STAGE_MS);
    if (isCancelled()) return;
  }

  emit({
    type: "done",
    summary: `Listo: ${steps.map(toolLabel).join(" → ")}`,
  });
}

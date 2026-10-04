import { initTelemetry, createLogger } from "../config/logger.js";
initTelemetry(); // debe ser lo primero, antes de cualquier componente

import { fileURLToPath } from "url";
import { HeadlessOrchestrator } from "./HeadlessOrchestrator.js";
import { HeadlessEscalationError } from "../errors.js";

const log = createLogger("NervousSystem");

/**
 * NervousSystem — Punto de entrada headless de BioCore.
 *
 * Demuestra el HeadlessOrchestrator en sus tres modos de operación:
 *
 *   REFLEX   — patrones aprendidos, 0 tokens, < 10ms
 *   JEV      — routing Jev cuando no hay reflex (~$0.00004, ~150ms)
 *   EXPLICIT — pasos predefinidos cuando Jev tiene baja confianza
 *
 * No requiere un LLM configurado. Funciona sin GEMINI_API_KEY ni ANTHROPIC_API_KEY.
 * Si configuras TYPESAFE_API_KEY, Jev activa el routing automático (estrategia 2).
 *
 * Uso: `npm run start`
 */
async function main() {
  log.info("BioCore NervousSystem — modo headless iniciando");

  const headless = new HeadlessOrchestrator({
    sessionId: "headless-demo",
    // Células disponibles para este ejemplo
    allowedCells: ["sensory", "memory", "filesystem"],
    // Umbral de confianza Jev (default 0.7)
    jevConfidenceThreshold: 0.7,
  });

  // ── Ejemplo 1: Tarea con pasos explícitos ─────────────────────────────────
  // La primera vez usa EXPLICIT. A partir de la segunda, ReflexMolecule
  // aprende el patrón y lo ejecuta en modo REFLEX (0 tokens).
  log.info("── Ejemplo 1: ejecutar con fallback explícito ──");
  try {
    const result = await headless.execute({
      instruction:
        "scrapea https://example.com y guarda el título en la tabla scrapes",
      fallback: [
        {
          cell: "sensory",
          tool: "scrape_url",
          args: { url: "https://example.com" },
        },
        {
          cell: "memory",
          tool: "db_insert",
          args: { table: "scrapes", data: { url: "https://example.com" } },
        },
      ],
    });

    log.info(
      {
        mode: result.mode,
        cellType: result.cellType,
        steps: result.outputs.length,
        jevTokens: result.jevTokens,
      },
      "✅ Tarea completada",
    );
  } catch (err) {
    if (err instanceof HeadlessEscalationError) {
      log.warn(
        { instruction: err.instruction, code: err.code },
        "⚠️  Escalación necesaria — esta tarea requiere LLM",
      );
    } else {
      log.error({ err }, "Error inesperado");
    }
  }

  // ── Ejemplo 2: Tarea sin fallback (depende de reflex o Jev) ───────────────
  // Si ya existe un reflex para esta instrucción → REFLEX (0 tokens).
  // Si TYPESAFE_API_KEY está configurada → JEV routing automático.
  // Si no → HeadlessEscalationError (la tarea necesita LLM o fallback explícito).
  log.info("── Ejemplo 2: ejecutar sin fallback ──");
  try {
    const result = await headless.execute({
      instruction: "lista los archivos en el directorio actual",
    });

    log.info(
      { mode: result.mode, jevConfidence: result.jevConfidence },
      "✅ Tarea completada",
    );
    log.info({ output: result.outputs[0]?.substring(0, 200) }, "Output");
  } catch (err) {
    if (err instanceof HeadlessEscalationError) {
      log.warn(
        {
          instruction: err.instruction,
          jevConfidence: err.jevConfidence,
          suggestion:
            "Configura TYPESAFE_API_KEY para routing automático via Jev, o agrega un fallback explícito",
        },
        "⚠️  Escalación — sin reflex, sin Jev, sin fallback",
      );
    } else {
      log.error({ err }, "Error inesperado");
    }
  }

  log.info("NervousSystem demo completado");
}

// Punto de entrada `npm run start`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    log.error({ err }, "Error fatal en NervousSystem");
    process.exit(1);
  });
}

// Re-exportar para uso como módulo
export { HeadlessOrchestrator } from "./HeadlessOrchestrator.js";
export type {
  HeadlessTask,
  HeadlessStep,
  HeadlessResult,
  HeadlessOrchestratorOptions,
} from "./HeadlessOrchestrator.js";
export { HeadlessEscalationError } from "../errors.js";

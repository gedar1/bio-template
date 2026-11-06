import { TypeSafeClient, choice, noul } from "@typesafe-ai/sdk";
import { createLogger } from "../config/logger.js";
import type { ReflexRecord } from "../molecules/ReflexMolecule.js";

const log = createLogger("ReflexSelector");

/**
 * Confianza mínima del primer paso de Jev para formar una cadena.
 * Es una guardia, no un umbral de reflex: sin ella se formarían cadenas con confianza baja.
 */
export const REFLEX_SELECTION_THRESHOLD = 0.7;

/** Opción de next_step que indica que la tarea termina con el primer paso. */
export const NO_NEXT_STEP = "ninguno";

export interface ReflexSelection {
  readonly record: ReflexRecord;
  readonly confidence: number;
  readonly source: "jev";
}

let jevClient: TypeSafeClient | null = null;

function getJevClient(): TypeSafeClient | null {
  if (!process.env.TYPESAFE_API_KEY) return null;
  jevClient ??= new TypeSafeClient({
    apiKey: process.env.TYPESAFE_API_KEY,
    defaultModel: "jev-latest",
    logLevel: "warn",
    timeout: 5000,
  });
  return jevClient;
}

/**
 * Elige la cadena de herramientas con dos llamadas secuenciales a Jev.
 *
 * 1. Primer paso y si la tarea requiere varios pasos. Se pregunta sobre el catálogo completo.
 * 2. Siguiente paso. Se pregunta con el primer paso como dato del estado y sin ese paso
 *    entre las opciones, para que Jev no repita la misma herramienta.
 *
 * Las dos preguntas no pueden ir en paralelo: next_step necesita la respuesta del primero.
 *
 * @param message - Mensaje del usuario (e.g., "scrapea la web y guarda en la bd")
 * @param toolsData - Herramientas disponibles (nombre → descripción), ya filtradas por célula
 * @returns Cadena elegida con la confianza del primer paso, o null
 */
export async function jevEvaluateAll(
  message: string,
  toolsData: Record<string, string>,
): Promise<ReflexSelection | null> {
  if (Object.keys(toolsData).length === 0) return null;

  const client = getJevClient();
  if (!client) {
    log.debug("Jev API key not configured; no chain suggested");
    return null;
  }

  try {
    const first = await client.systemOne({
      state: message,
      questions: {
        reflexes_anatomic: choice(
          "¿Cuál es el PRIMER paso para resolver la intención del usuario?",
          toolsData,
        ),
        is_multi_step: noul(
          "¿Requiere múltiples pasos para resolver la intención?",
          {
            true: "Se necesitan varias herramientas en secuencia (ej: scrape + insert)",
            false: "Una sola herramienta resuelve todo",
          },
        ),
      },
    });

    const primaryStep = first.answers.reflexes_anatomic.choice;
    const primaryConfidence = first.answers.reflexes_anatomic.confidence;
    const isMultiStep = first.answers.is_multi_step.noul;

    log.debug(
      { primaryStep, primaryConfidence, isMultiStep },
      "Jev primer paso",
    );

    if (primaryConfidence < REFLEX_SELECTION_THRESHOLD) {
      log.debug(
        {
          primaryConfidence,
          threshold: REFLEX_SELECTION_THRESHOLD,
          primaryStep,
        },
        "Jev primary confidence below guard; no chain",
      );
      return null;
    }

    // Segunda llamada: el primer paso va como dato y se quita de las opciones.
    const nextCriteria: Record<string, string> = { ...toolsData };
    delete nextCriteria[primaryStep];
    nextCriteria[NO_NEXT_STEP] =
      "No hace falta otra herramienta: la tarea termina con el primer paso";

    const second = await client.systemOne({
      state: { message, first_step: primaryStep },
      questions: {
        next_step: choice(
          "Dado el primer paso ya elegido, ¿cuál es el SIGUIENTE paso para completar la intención? Elige 'ninguno' si la tarea termina ahí.",
          nextCriteria,
        ),
      },
    });

    const nextChoice = second.answers.next_step.choice;
    const nextConfidence = second.answers.next_step.confidence;
    const secondStep = nextChoice === NO_NEXT_STEP ? undefined : nextChoice;
    const executionChain = secondStep
      ? [primaryStep, secondStep]
      : [primaryStep];

    log.debug(
      { nextStep: nextChoice, nextConfidence, isMultiStep },
      "Jev siguiente paso",
    );

    const record: ReflexRecord = {
      id: 0, // Placeholder: la sugerencia de Jev no es un reflex guardado
      taskSummary: `[${executionChain.join(" → ")}]`,
      sequence: executionChain.join("→"),
      steps: [],
      successCount: 0,
      failureCount: 0,
      lastUsed: Date.now(),
      argTemplates: null,
      schemaVersions: null,
    };

    log.info(
      {
        executionChain,
        primaryConfidence,
        nextConfidence,
        isMultiStep,
        source: "jev",
      },
      "Jev execution chain resolved",
    );

    return {
      record,
      confidence: primaryConfidence,
      source: "jev",
    };
  } catch (error: unknown) {
    log.warn(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      "Jev evaluation failed; no chain suggested",
    );
    return null;
  }
}

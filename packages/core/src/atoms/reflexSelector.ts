import { TypeSafeClient, choice } from "@typesafe-ai/sdk";
import { createLogger } from "../config/logger.js";
import type { ReflexRecord } from "../molecules/ReflexMolecule.js";

const log = createLogger("ReflexSelector");

export const REFLEX_SELECTION_THRESHOLD = 0.7;
export const REFLEX_AMBIGUITY_MARGIN = 0.08;

export interface ReflexSelection {
  readonly record: ReflexRecord;
  readonly confidence: number;
  readonly source: "jev" | "structured-fallback";
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
 * Evaluates intent using Jev with 3 parallelized questions from playground payload:
 * 1. reflexes_anatomic (choice): First step to resolve user intent
 * 2. next_step (choice): Next step after the first to complete intent
 * 3. is_multi_step (noul): Requires multiple steps to resolve intent
 *
 * Returns execution chain with confidence and traceability.
 *
 * @param message - User input (e.g., "scrapea la web y guarda en la bd")
 * @param toolsData - Tools available for evaluation (tool_name -> description)
 * @returns Selected reflex record with execution chain, confidence, and source, or null
 */
export async function jevEvaluateAll(
  message: string,
  toolsData: Record<string, string>,
): Promise<ReflexSelection | null> {
  if (Object.keys(toolsData).length === 0) return null;

  const client = getJevClient();
  if (!client) {
    log.debug(
      "Jev API key not configured; falling back to structured selection",
    );
    return null;
  }

  try {
    // Use toolsData directly as criteria
    const toolsCriteria = toolsData;

    log.debug(
      {
        toolsCriteriaCount: Object.keys(toolsCriteria).length,
        toolsNames: Object.keys(toolsCriteria).slice(0, 10), // First 10 tools
        message,
      },
      "jevEvaluateAll input state",
    );

    // Import noul primitive for is_multi_step question
    const { noul } = await import("@typesafe-ai/sdk");

    // Build the full request structure as it will be sent to Jev
    const requestStructure = {
      state: message,
      questions: {
        reflexes_anatomic: {
          type: "choice",
          instructions:
            "¿Cuál es el PRIMER paso para resolver la intención del usuario?",
          criteria: toolsCriteria,
        },
        next_step: {
          type: "choice",
          instructions:
            "¿Cuál es el SIGUIENTE paso después del primero para completar la intención?",
          criteria: toolsCriteria,
        },
        is_multi_step: {
          type: "noul",
          instructions: "¿Requiere múltiples pasos para resolver la intención?",
          criteria: {
            true: "Se necesitan varias herramientas en secuencia (ej: scrape + insert)",
            false: "Una sola herramienta resuelve todo",
          },
        },
      },
    };

    // Execute 3 parallelized questions exactly as in playground payload
    const result = await client.systemOne({
      state: message,
      questions: {
        reflexes_anatomic: choice(
          "¿Cuál es el PRIMER paso para resolver la intención del usuario?",
          toolsCriteria,
        ),
        next_step: choice(
          "¿Cuál es el SIGUIENTE paso después del primero para completar la intención?",
          toolsCriteria,
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

    console.log("[result in reflexSelector", result);

    // Parse Jev responses
    const primaryStep = result.answers.reflexes_anatomic.choice;
    const secondStep = result.answers.next_step.choice;
    const isMultiStep = result.answers.is_multi_step.noul;

    const primaryConfidence = result.answers.reflexes_anatomic.confidence;
    const nextStepConfidence = result.answers.next_step.confidence;

    // Use primary confidence for execution chain (most important decision)
    // next_step and is_multi_step are supporting signals
    const executionConfidence = primaryConfidence;

    log.debug(
      {
        primaryConfidence,
        nextStepConfidence,
        isMultiStep,
      },
      "Confidence breakdown for execution chain",
    );

    log.info(
      {
        primaryStep,
        primaryConfidence,
        nextStep: secondStep,
        nextStepConfidence,
        isMultiStep,
        executionConfidence,
        executionChain: [primaryStep, secondStep].filter(Boolean),
        source: "jev",
      },
      "Jev evaluated 3 parallelized questions for intent resolution",
    );

    // Check if primary confidence meets threshold
    if (executionConfidence < REFLEX_SELECTION_THRESHOLD) {
      log.debug(
        {
          executionConfidence,
          threshold: REFLEX_SELECTION_THRESHOLD,
          primaryStep,
          nextStep: secondStep,
        },
        "Jev primary confidence below threshold; abstaining",
      );
      return null;
    }

    // Build execution_chain record representing the detected sequence
    // Filter out duplicates: if next_step == primaryStep, it's single-step
    const chainRaw = [primaryStep, secondStep].filter(Boolean);
    const executionChain = Array.from(new Set(chainRaw)); // Remove duplicates

    const record: ReflexRecord = {
      id: 0, // Placeholder — will be resolved in TenantManager
      taskSummary: `[${executionChain.join(" → ")}]`,
      sequence: executionChain.join("→"),
      steps: [],
      successCount: 1,
      failureCount: 0,
      lastUsed: Date.now(),
      argTemplates: null,
      schemaVersions: null,
    };

    log.info(
      {
        executionChain,
        isMultiStep,
        confidence: executionConfidence,
        source: "jev",
      },
      "Jev execution chain resolved",
    );

    return {
      record,
      confidence: executionConfidence,
      source: "jev",
    };
  } catch (error: unknown) {
    log.warn(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      "Jev evaluation failed; falling back to structured selection",
    );
    return null;
  }
}

/**
 * Structured fallback: selects from sorted candidates without Jev.
 * Used when Jev is unavailable or declines to evaluate.
 *
 * @param candidates - Already sorted by relevance
 * @returns Top match or null if selection is ambiguous
 */
export function selectStructuredFallback(
  candidates: readonly ReflexRecord[],
): ReflexSelection | null {
  if (candidates.length === 0) return null;

  const best = candidates[0];
  const second = candidates[1];

  // Estimate confidence from success/failure metrics
  const total = best.successCount + best.failureCount;
  const baseConfidence = total === 0 ? 0.5 : best.successCount / total;
  const confidence = Math.min(0.99, 0.5 + baseConfidence * 0.49);

  // Check for ambiguity: if top two are too close, abstain
  if (second) {
    const secondTotal = second.successCount + second.failureCount;
    const secondConfidence =
      secondTotal === 0 ? 0.5 : second.successCount / secondTotal;
    const margin = confidence - secondConfidence;

    if (margin < REFLEX_AMBIGUITY_MARGIN) {
      log.info(
        {
          reflexId: best.id,
          taskSummary: best.taskSummary,
          confidence,
          margin,
          source: "structured-fallback",
          ambiguous: true,
        },
        "Selection too ambiguous; abstaining",
      );
      return null;
    }
  }

  // Very low confidence on single reflex — abstain
  if (confidence < 0.3) {
    log.info(
      {
        reflexId: best.id,
        taskSummary: best.taskSummary,
        confidence,
        source: "structured-fallback",
        reason: "low_confidence",
      },
      "Selection confidence too low; abstaining",
    );
    return null;
  }

  log.info(
    {
      reflexId: best.id,
      taskSummary: best.taskSummary,
      confidence,
      source: "structured-fallback",
    },
    "Structured fallback selected reflex",
  );

  return {
    record: best,
    confidence,
    source: "structured-fallback",
  };
}

/**
 * Main entry point: single-phase reflex selection.
 * Tries Jev first; falls back to structured selection if unavailable.
 *
 * @param message - User input
 * @param candidates - All candidate reflexes (unsorted, unfiltered)
 * @returns Selected reflex with confidence, or null
 */
export async function selectReflex(
  message: string,
  candidates: readonly ReflexRecord[],
): Promise<ReflexSelection | null> {
  if (candidates.length === 0) return null;

  // Convert candidates to toolsData format for Jev
  const toolsData: Record<string, string> = {};
  for (const c of candidates) {
    toolsData[c.taskSummary] =
      `${c.taskSummary} (success: ${c.successCount}, failures: ${c.failureCount})`;
  }

  // Try Jev first
  const jevResult = await jevEvaluateAll(message, toolsData);
  if (jevResult) return jevResult;

  // Fall back to structured selection (sorted by success/failure ratio)
  const sorted = [...candidates].sort((a, b) => {
    const aRatio =
      a.successCount / Math.max(1, a.successCount + a.failureCount);
    const bRatio =
      b.successCount / Math.max(1, b.successCount + b.failureCount);
    return bRatio - aRatio;
  });

  return selectStructuredFallback(sorted);
}

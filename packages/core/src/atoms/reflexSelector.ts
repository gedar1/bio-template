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
 * Evaluates ALL candidates using Jev noul in a single phase.
 * No embeddings pre-filtering — Jev makes the decision directly.
 *
 * @param message - User input
 * @param candidates - All reflexes to evaluate (no pre-filter)
 * @returns Top match with confidence and source, or null if Jev abstains
 */
export async function jevEvaluateAll(
  message: string,
  candidates: readonly ReflexRecord[],
): Promise<ReflexSelection | null> {
  if (candidates.length === 0) return null;

  const client = getJevClient();
  if (!client) {
    log.debug(
      "Jev API key not configured; falling back to structured selection",
    );
    return null;
  }

  try {
    const criteria = Object.fromEntries(
      candidates.map((record) => [
        String(record.id),
        `${record.taskSummary}; secuencia: ${record.sequence}`,
      ]),
    );

    const result = await client.systemOne({
      state: {
        message,
        candidates: candidates
          .map((record) => `${record.id}: ${record.taskSummary}`)
          .join("\n"),
      },
      questions: {
        reflex: choice(
          "¿Qué reflex resuelve mejor la intención del usuario?",
          criteria,
        ),
      },
    });

    const answer = result.answers.reflex;
    const selectedRecord = candidates.find(
      (item) => String(item.id) === answer.choice,
    );

    if (!selectedRecord || answer.confidence < REFLEX_SELECTION_THRESHOLD) {
      log.debug(
        {
          confidence: answer.confidence,
          threshold: REFLEX_SELECTION_THRESHOLD,
          reflexId: selectedRecord?.id,
        },
        "Jev confidence below threshold",
      );
      return null;
    }

    log.info(
      {
        reflexId: selectedRecord.id,
        taskSummary: selectedRecord.taskSummary,
        confidence: answer.confidence,
        source: "jev",
      },
      "Jev selected reflex",
    );

    return {
      record: selectedRecord,
      confidence: answer.confidence,
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

  // Try Jev first
  const jevResult = await jevEvaluateAll(message, candidates);
  if (jevResult) return jevResult;

  // Fall back to structured selection (sorted by success/failure ratio)
  const sorted = [...candidates].sort((a, b) => {
    const aRatio = a.successCount / Math.max(1, a.successCount + a.failureCount);
    const bRatio = b.successCount / Math.max(1, b.successCount + b.failureCount);
    return bRatio - aRatio;
  });

  return selectStructuredFallback(sorted);
}

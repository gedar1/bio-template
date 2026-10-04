import type { ReflexMetrics, ReflexMode } from "../types/dashboard";

export type ReflexEvent = "hit" | "miss";

export interface ReflexComputeInput {
  history: ReflexEvent[];
  totalReflexes: number;
  currentMode: ReflexMode;
  /** Average tokens saved per hit */
  tokensPerHit?: number;
}

/**
 * Computes reflex metrics from a history of hit/miss events.
 * hitRate + missRate always equals 1.0 (within floating point tolerance).
 * tokenSavings is always >= 0.
 */
export function computeReflexMetrics(input: ReflexComputeInput): ReflexMetrics {
  const { history, totalReflexes, currentMode, tokensPerHit = 500 } = input;

  if (history.length === 0) {
    return {
      totalReflexes,
      hitRate: 0,
      missRate: 0,
      estimatedTokenSavings: 0,
      currentMode,
    };
  }

  const hits = history.filter((e) => e === "hit").length;
  const total = history.length;
  const hitRate = hits / total;
  const missRate = 1 - hitRate;

  return {
    totalReflexes,
    hitRate,
    missRate,
    estimatedTokenSavings: Math.max(0, hits * tokensPerHit),
    currentMode,
  };
}

/**
 * Computes the adaptive threshold for reflex activation.
 *
 * Rules:
 * - Result is always within [0.80, 1.0]
 * - Higher success ratio → lower threshold (easier to activate)
 * - Lower success ratio → higher threshold (harder to activate)
 * - Monotonicity: for fixed total, increasing success ratio produces
 *   threshold <= threshold for lower success ratio
 *
 * @param successCount Number of successful executions
 * @param failureCount Number of failed executions
 * @returns Threshold value in [0.80, 1.0]
 */
export function computeAdaptiveThreshold(
  successCount: number,
  failureCount: number,
): number {
  const MIN_THRESHOLD = 0.8;
  const MAX_THRESHOLD = 1;
  const DEFAULT_THRESHOLD = 0.95;

  const total = successCount + failureCount;

  // Not enough data — return default
  if (total === 0) {
    return DEFAULT_THRESHOLD;
  }

  const successRatio = successCount / total;

  // Linear interpolation: high success → low threshold, low success → high threshold
  // successRatio=1.0 → MIN_THRESHOLD (0.80)
  // successRatio=0.0 → MAX_THRESHOLD (1.0)
  const threshold =
    MAX_THRESHOLD - successRatio * (MAX_THRESHOLD - MIN_THRESHOLD);

  // Clamp to bounds
  return Math.max(MIN_THRESHOLD, Math.min(MAX_THRESHOLD, threshold));
}

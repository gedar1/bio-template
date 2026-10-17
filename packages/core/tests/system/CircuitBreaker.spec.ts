import { describe, expect, it } from "vitest";
import { CircuitBreaker } from "../../src/infrastructure/CircuitBreaker.js";
import { ProviderError, CircuitOpenError } from "../../src/errors.js";

describe("CircuitBreaker transport boundary", () => {
  it("throws a typed open error and does not count cancellation", async () => {
    const breaker = new CircuitBreaker({
      name: "gemini",
      failureThreshold: 1,
    });
    const cancelled = new ProviderError("gemini", "cancelled", "cancelled", {
      retryable: false,
    });

    await expect(breaker.execute(async () => { throw cancelled; })).rejects.toBe(cancelled);
    expect(breaker.getFailureCount()).toBe(0);

    await expect(breaker.execute(async () => {
      throw new ProviderError("gemini", "network", "down", { retryable: true });
    })).rejects.toBeInstanceOf(ProviderError);
    expect(breaker.getState()).toBe("OPEN");
    await expect(breaker.execute(async () => undefined)).rejects.toBeInstanceOf(CircuitOpenError);
  });
});

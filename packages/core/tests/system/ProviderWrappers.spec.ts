import { describe, expect, it } from "vitest";
import { ClaudeCortex } from "../../src/system/implementations/ClaudeCortex.js";
import { GeminiCortex } from "../../src/system/implementations/GeminiCortex.js";
import { NvidiaCortex } from "../../src/system/implementations/NvidiaCortex.js";

describe("deprecated provider wrappers", () => {
  it.each([
    [ClaudeCortex, "ANTHROPIC-SESSION", "claude"],
    [GeminiCortex, "GEMINI-SESSION", "gemini"],
    [NvidiaCortex, "NVIDIA-SESSION", "nvidia"],
  ])("preserves the historical facade for %s", (Wrapper, sessionId, provider) => {
    const cortex = new Wrapper();
    expect(cortex.getSessionId()).toBe(sessionId);
    expect(cortex.getProviderConfig()).toEqual({
      primaryProvider: provider,
      fallbackOrder: [],
    });
    expect("anthropic" in cortex).toBe(false);
    expect("genAI" in cortex).toBe(false);
  });
});

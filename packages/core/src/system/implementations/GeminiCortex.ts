import { UnifiedCortex, type UnifiedCortexOptions } from "./UnifiedCortex.js";

/** @deprecated Use UnifiedCortex with primaryProvider: "gemini". */
export class GeminiCortex extends UnifiedCortex {
  constructor(options: UnifiedCortexOptions = {}) {
    super({
      ...options,
      sessionId: "GEMINI-SESSION",
      primaryProvider: "gemini",
      fallbackOrder: [],
      singleProvider: true,
    });
  }
}

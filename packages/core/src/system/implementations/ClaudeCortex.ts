import { UnifiedCortex, type UnifiedCortexOptions } from "./UnifiedCortex.js";

/** @deprecated Use UnifiedCortex with primaryProvider: "claude". */
export class ClaudeCortex extends UnifiedCortex {
  constructor(options: UnifiedCortexOptions = {}) {
    super({
      ...options,
      sessionId: "ANTHROPIC-SESSION",
      primaryProvider: "claude",
      fallbackOrder: [],
      singleProvider: true,
    });
  }
}

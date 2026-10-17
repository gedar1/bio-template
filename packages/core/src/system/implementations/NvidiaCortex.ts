import { UnifiedCortex, type UnifiedCortexOptions } from "./UnifiedCortex.js";

/** @deprecated Use UnifiedCortex with primaryProvider: "nvidia". */
export class NvidiaCortex extends UnifiedCortex {
  constructor(options: UnifiedCortexOptions = {}) {
    super({
      ...options,
      sessionId: "NVIDIA-SESSION",
      primaryProvider: "nvidia",
      fallbackOrder: [],
      singleProvider: true,
    });
  }
}

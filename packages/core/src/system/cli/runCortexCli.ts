import { createInterface } from "node:readline/promises";
import type { UnifiedCortex } from "../implementations/UnifiedCortex.js";
import { createLogger } from "../../config/logger.js";

const log = createLogger("CortexCLI");

export async function runCortexCli(cortex: UnifiedCortex): Promise<void> {
  await cortex.init();
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const input = await readline.question("👤 [TÚ]: ");
      if (input.toLowerCase() === "salir") break;
      await cortex.chat(input);
    }
  } finally {
    readline.close();
    log.info("Cortex CLI cerrado");
  }
}

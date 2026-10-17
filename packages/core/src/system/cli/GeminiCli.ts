import { fileURLToPath } from "node:url";
import { GeminiCortex } from "../implementations/GeminiCortex.js";
import { runCortexCli } from "./runCortexCli.js";

export async function main(): Promise<void> {
  await runCortexCli(new GeminiCortex());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

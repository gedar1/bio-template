import { fileURLToPath } from "node:url";
import { ClaudeCortex } from "../implementations/ClaudeCortex.js";
import { runCortexCli } from "./runCortexCli.js";

export async function main(): Promise<void> {
  await runCortexCli(new ClaudeCortex());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

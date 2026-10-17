import { fileURLToPath } from "node:url";
import { NvidiaCortex } from "../implementations/NvidiaCortex.js";
import { runCortexCli } from "./runCortexCli.js";

export async function main(): Promise<void> {
  await runCortexCli(new NvidiaCortex());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

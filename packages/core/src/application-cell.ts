import { createApplicationComposition } from "./config/applicationComposition.js";
import { runCellServer } from "./cells/CellServer.js";

await runCellServer(createApplicationComposition());

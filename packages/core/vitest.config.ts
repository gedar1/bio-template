import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  root: repositoryRoot,
  test: {
    include: ["packages/core/tests/**/*.spec.ts"],
    globals: true,
  },
});

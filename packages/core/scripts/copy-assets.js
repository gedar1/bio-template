import { cpSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Ensure dist/config/agents exists
mkdirSync(join(root, "dist/config/agents"), { recursive: true });

// Copy JSON config files
const jsonFiles = [
  "registry.json",
  "tenant-profiles.json",
  "templates.json",
  "domain-registry.json",
];
for (const file of jsonFiles) {
  cpSync(join(root, "src/config", file), join(root, "dist/config", file));
}

// Copy agents directory
cpSync(join(root, "src/config/agents"), join(root, "dist/config/agents"), {
  recursive: true,
});

console.log("✓ Config assets copied to dist/config/");

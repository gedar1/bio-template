import { cpSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Ensure dist/config/agents exists
mkdirSync(join(root, "dist/config/agents"), { recursive: true });

// Copy JSON config files (skip if missing)
const jsonFiles = [
  "registry.json",
  "tenant-profiles.json",
  "domain-registry.json",
];
for (const file of jsonFiles) {
  const src = join(root, "src/config", file);
  const dst = join(root, "dist/config", file);
  if (existsSync(src)) {
    cpSync(src, dst);
  }
}

// Copy templates directory (recursive, if exists)
const templatesDir = join(root, "src/config/templates");
if (existsSync(templatesDir)) {
  cpSync(templatesDir, join(root, "dist/config/templates"), {
    recursive: true,
  });

  // Also copy templates.json to root of dist/config for backward compatibility
  const templatesJsonSrc = join(root, "src/config/templates/templates.json");
  if (existsSync(templatesJsonSrc)) {
    cpSync(templatesJsonSrc, join(root, "dist/config/templates.json"));
  }
}

// Copy agents directory
const agentsDir = join(root, "src/config/agents");
if (existsSync(agentsDir)) {
  cpSync(agentsDir, join(root, "dist/config/agents"), {
    recursive: true,
  });
}

console.log("✓ Config assets copied to dist/config/");

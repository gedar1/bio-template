/**
 * Valida la estructura portable mínima de bio-template.
 *
 * El validador inspecciona únicamente rutas de configuración y archivos fuente
 * conocidos. No recorre el checkout y nunca abre .env, *.db, data/ ni dist/.
 */

import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface TemplateContractIssue {
  path: string;
  message: string;
}

export interface TemplateContractResult {
  root: string;
  valid: boolean;
  issues: TemplateContractIssue[];
  checkedPaths: string[];
}

const REQUIRED_FILES = [
  "package.json",
  "tsconfig.json",
  "tsconfig.base.json",
  ".env.example",
  "README.md",
  "docs/START_HERE.md",
  ".gitignore",
  "packages/core/package.json",
  "packages/core/tsconfig.json",
  "packages/core/src/config/registry.json",
  "packages/core/src/config/domain-registry.json",
  "packages/core/src/config/domain-profile.ts",
  "packages/core/src/config/domain-agent.md",
  "packages/core/src/config/profileRegistry.ts",
  "packages/core/src/molecules/ExampleMolecule.ts",
  "packages/core/src/config/applicationComposition.ts",
  "packages/core/src/application-cell.ts",
  "scripts/validate-template-contract.ts",
  ".kiro/hooks/validate-template-contract.kiro.hook",
  ".kiro/hooks/update-docs-on-task.kiro.hook",
] as const;

const REQUIRED_DIRECTORIES = [
  "packages/core/src/atoms",
  "packages/core/src/cells",
  "packages/core/src/config",
  "packages/core/src/molecules",
  "packages/core/src/organisms",
  "packages/core/src/system",
] as const;

/** Canonical steering files copied from BioCore; template-* files stay local. */
export const REQUIRED_STEERING = [
  "project-overview.md",
  "coding-standards.md",
  "biocore-architecture.md",
  "biocore-glossary.md",
  "react-conventions.md",
  "html-docs.md",
  "lessons-learned.md",
  "biocore-index.md",
  "biocore-decisions.md",
  "biocore-execution-flow.md",
  "biocore-llm-decision-flow.md",
  "biocore-mutation-lifecycle.md",
  "biocore-stimulus-sources.md",
  "biocore-tools-comparison.md",
  "biocore-what-llm-receives.md",
  "biocore-boundaries.md",
  "biocore-create-atom.md",
  "biocore-create-molecule.md",
  "biocore-create-cell.md",
  "biocore-create-organism.md",
  "biocore-create-strategy.md",
  "biocore-create-profile.md",
  "biocore-testing-validation.md",
] as const;

const VALIDATE_SCRIPT = "tsx scripts/validate-template-contract.ts --root .";
const REQUIRED_ROOT_SCRIPTS = ["build", "build:ts", "test"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(
  root: string,
  relativePath: string,
  issues: TemplateContractIssue[],
): unknown | undefined {
  const absolutePath = join(root, relativePath);
  try {
    return JSON.parse(readFileSync(absolutePath, "utf8")) as unknown;
  } catch (error) {
    issues.push({
      path: relativePath,
      message:
        error instanceof SyntaxError
          ? "JSON inválido"
          : `No se pudo leer o parsear: ${error instanceof Error ? error.message : String(error)}`,
    });
    return undefined;
  }
}

function hasLineMatching(contents: string, pattern: RegExp): boolean {
  return contents.split(/\r?\n/).some((line) => pattern.test(line.trim()));
}

function checkRequiredFiles(
  root: string,
  issues: TemplateContractIssue[],
  checkedPaths: string[],
): void {
  for (const relativePath of REQUIRED_FILES) {
    checkedPaths.push(relativePath);
    const absolutePath = join(root, relativePath);
    if (!existsSync(absolutePath)) {
      issues.push({ path: relativePath, message: "archivo requerido ausente" });
      continue;
    }
    if (!lstatSync(absolutePath).isFile()) {
      issues.push({
        path: relativePath,
        message: "debe ser un archivo regular",
      });
    }
  }

  for (const relativePath of REQUIRED_DIRECTORIES) {
    checkedPaths.push(relativePath);
    const absolutePath = join(root, relativePath);
    if (!existsSync(absolutePath)) {
      issues.push({
        path: relativePath,
        message: "directorio requerido ausente",
      });
      continue;
    }
    if (!lstatSync(absolutePath).isDirectory()) {
      issues.push({
        path: relativePath,
        message: "debe ser un directorio",
      });
    }
  }

  for (const steeringFile of REQUIRED_STEERING) {
    const relativePath = join(".kiro", "steering", steeringFile);
    checkedPaths.push(relativePath);
    const absolutePath = join(root, relativePath);
    if (!existsSync(absolutePath)) {
      issues.push({ path: relativePath, message: "steering canónico ausente" });
    } else if (!lstatSync(absolutePath).isFile()) {
      issues.push({
        path: relativePath,
        message: "debe ser un archivo regular",
      });
    }
  }
}

function checkPackageConfiguration(
  root: string,
  issues: TemplateContractIssue[],
): void {
  const packageJson = readJson(root, "package.json", issues);
  if (isRecord(packageJson)) {
    const scripts = packageJson.scripts;
    if (
      !isRecord(scripts) ||
      scripts["validate-template"] !== VALIDATE_SCRIPT
    ) {
      issues.push({
        path: "package.json",
        message: `scripts.validate-template debe ser \"${VALIDATE_SCRIPT}\"`,
      });
    }
    for (const scriptName of REQUIRED_ROOT_SCRIPTS) {
      const scriptValue = isRecord(scripts) ? scripts[scriptName] : undefined;
      if (typeof scriptValue !== "string" || scriptValue.trim() === "") {
        issues.push({
          path: "package.json",
          message: `scripts.${scriptName} debe estar definido`,
        });
      }
    }
  }

  const corePackage = readJson(root, "packages/core/package.json", issues);
  if (isRecord(corePackage) && typeof corePackage.type !== "string") {
    issues.push({
      path: "packages/core/package.json",
      message: "debe declarar type: module",
    });
  }

  readJson(root, "tsconfig.json", issues);
  readJson(root, "tsconfig.base.json", issues);
  readJson(root, "packages/core/tsconfig.json", issues);
  readJson(root, "packages/core/src/config/registry.json", issues);
}

function checkDomainRegistry(
  root: string,
  issues: TemplateContractIssue[],
): void {
  const registry = readJson(
    root,
    "packages/core/src/config/domain-registry.json",
    issues,
  );
  if (!isRecord(registry)) return;

  if (!Array.isArray(registry.cells) || registry.cells.length === 0) {
    issues.push({
      path: "packages/core/src/config/domain-registry.json",
      message: "cells debe ser un array no vacío",
    });
    return;
  }

  registry.cells.forEach((cell, index) => {
    if (
      !isRecord(cell) ||
      typeof cell.type !== "string" ||
      !Array.isArray(cell.tools)
    ) {
      issues.push({
        path: "packages/core/src/config/domain-registry.json",
        message: `cells[${index}] debe tener type y tools`,
      });
    }
  });
}

function checkDomainConfiguration(
  root: string,
  issues: TemplateContractIssue[],
): void {
  const requirements: Array<[string, string[]]> = [
    [
      "packages/core/src/config/domain-profile.ts",
      ["allowedCells", "agentFile"],
    ],
    [
      "packages/core/src/molecules/ExampleMolecule.ts",
      ["IMolecule", "initialize", "dispose"],
    ],
  ];
  for (const [relativePath, requiredTokens] of requirements) {
    let contents: string;
    try {
      contents = readFileSync(join(root, relativePath), "utf8");
    } catch {
      continue;
    }
    for (const token of requiredTokens) {
      if (!contents.includes(token)) {
        issues.push({
          path: relativePath,
          message: `configuración mínima ausente: ${token}`,
        });
      }
    }
  }
}

function checkGitignore(root: string, issues: TemplateContractIssue[]): void {
  const relativePath = ".gitignore";
  let contents: string;
  try {
    contents = readFileSync(join(root, relativePath), "utf8");
  } catch {
    return;
  }

  const requiredPatterns: Array<[RegExp, string]> = [
    [/^\.env(?:\.local)?$/, ".env"],
    [/^\*\.db$/, "*.db"],
    [/^data\/?$/, "data/"],
    [/^(?:dist|[^#\s]+\/dist)\/?$/, "dist"],
  ];
  for (const [pattern, label] of requiredPatterns) {
    if (!hasLineMatching(contents, pattern)) {
      issues.push({
        path: relativePath,
        message: `debe ignorar ${label} para proteger secretos/runtime`,
      });
    }
  }
}

function checkHook(
  root: string,
  relativePath: string,
  issues: TemplateContractIssue[],
): void {
  const hook = readJson(root, relativePath, issues);
  if (!isRecord(hook)) return;
  const when = hook.when;
  const then = hook.then;
  if (!isRecord(when) || when.type !== "postTaskExecution") {
    issues.push({
      path: relativePath,
      message: "debe usar when.type postTaskExecution",
    });
  }
  if (!isRecord(then) || then.type !== "askAgent") {
    issues.push({
      path: relativePath,
      message: "debe usar then.type askAgent",
    });
  }
}

export function validateTemplateContract(
  templateRoot: string,
): TemplateContractResult {
  const root = resolve(templateRoot);
  const issues: TemplateContractIssue[] = [];
  const checkedPaths: string[] = [];

  if (!existsSync(root)) {
    issues.push({ path: ".", message: "la raíz del template no existe" });
    return { root, valid: false, issues, checkedPaths };
  }

  checkRequiredFiles(root, issues, checkedPaths);
  checkPackageConfiguration(root, issues);
  checkDomainRegistry(root, issues);
  checkDomainConfiguration(root, issues);
  checkGitignore(root, issues);
  checkHook(root, ".kiro/hooks/validate-template-contract.kiro.hook", issues);
  checkHook(root, ".kiro/hooks/update-docs-on-task.kiro.hook", issues);

  return { root, valid: issues.length === 0, issues, checkedPaths };
}

export function formatValidationResult(result: TemplateContractResult): string {
  if (result.valid) {
    return `✅ Contrato de bio-template válido (${result.checkedPaths.length} rutas verificadas)`;
  }
  const details = result.issues
    .map((issue) => `- ${issue.path}: ${issue.message}`)
    .join("\n");
  return `❌ Contrato de bio-template inválido (${result.issues.length} errores)\n${details}`;
}

function parseRootArgument(args: string[]): string | undefined {
  const inlineArgument = args.find((argument) =>
    argument.startsWith("--root="),
  );
  if (inlineArgument) return inlineArgument.slice("--root=".length);

  const rootIndex = args.indexOf("--root");
  if (rootIndex === -1) return undefined;
  const value = args[rootIndex + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("--root requiere una ruta");
  }
  return value;
}

export function resolveValidationRoot(
  scriptPath = fileURLToPath(import.meta.url),
  args = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): string {
  const explicitRoot = parseRootArgument(args);
  if (explicitRoot) return resolve(cwd, explicitRoot);

  const configuredPath = environment.BIO_TEMPLATE_PATH?.trim();
  if (configuredPath) {
    return isAbsolute(configuredPath)
      ? resolve(configuredPath)
      : resolve(cwd, configuredPath);
  }

  return resolve(dirname(scriptPath), "..", "..", "bio-template");
}

function main(): void {
  try {
    const templateRoot = resolveValidationRoot();
    const result = validateTemplateContract(templateRoot);
    console.log(formatValidationResult(result));
    if (!result.valid) process.exitCode = 1;
  } catch (error) {
    console.error(
      `❌ No se pudo resolver el template: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  main();
}

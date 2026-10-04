import { z } from "zod";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { CellTypeDefinition } from "../atoms/index.js";
import { getModuleDir } from "../atoms/paths.js";

const require = createRequire(import.meta.url);
const __dirname = getModuleDir(import.meta.url);

const registry = require(join(__dirname, "registry.json")) as {
  cells: CellTypeDefinition[];
};

// ─── Tipos válidos de estímulo (derivados del registry) ───────────────────────
const cellTypes = registry.cells.map((c) => c.type) as [string, ...string[]];

export const StimulusTypeSchema = z.enum(cellTypes, {
  errorMap: () => ({
    message: `Tipo de estímulo inválido. Válidos: ${cellTypes.join(", ")}`,
  }),
});

export type StimulusType = z.infer<typeof StimulusTypeSchema>;

// ─── Validadores de moléculas ─────────────────────────────────────────────────

/** Validación para operaciones de base de datos */
export const DbInsertSchema = z.object({
  table: z
    .string()
    .min(1, "Nombre de tabla requerido")
    .regex(
      /^[a-zA-Z_][a-zA-Z0-9_]*$/,
      "Nombre de tabla inválido (solo alfanuméricos y _)",
    ),
  data: z.record(z.any()).refine((d) => Object.keys(d).length > 0, {
    message: "Data no puede estar vacío",
  }),
});

export const DbQuerySchema = z.object({
  sql: z.string().min(1, "SQL requerido"),
  params: z.array(z.any()).optional(),
});

export const DbFilterSchema = z.object({
  table: z
    .string()
    .min(1, "Nombre de tabla requerido")
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Nombre de tabla inválido"),
  filter: z.record(z.any()).optional(),
});

/** Validación para operaciones de email */
export const EmailSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email()).min(1)]),
  subject: z.string().min(1, "Subject requerido"),
  body: z.string().min(1, "Body requerido"),
  isHTML: z.boolean().optional(),
});

/** Validación para operaciones de scraping */
export const ScrapeSchema = z.object({
  url: z.string().url("URL inválida"),
  schema: z.record(z.any()).refine((s) => Object.keys(s).length > 0, {
    message: "Schema de extracción no puede estar vacío",
  }),
});

export const UrlSchema = z.string().url("URL inválida");

/**
 * Binarios permitidos para execute_cli.
 * Solo herramientas de procesamiento de datos y diagnóstico.
 * NO incluye shells, downloaders, ni herramientas destructivas.
 */
const ALLOWED_CLI_BINARIES = new Set([
  // Procesamiento multimedia
  "ffmpeg",
  "ffprobe",
  "convert",
  "magick",
  "identify",
  // Conversión de documentos
  "pandoc",
  "wkhtmltopdf",
  // Diagnóstico de red (read-only)
  "ping",
  "traceroute",
  "tracert",
  "nslookup",
  "dig",
  "host",
  // Info del sistema (read-only)
  "uname",
  "hostname",
  "whoami",
  "date",
  "uptime",
  "df",
  "du",
  "free",
  "top",
  "ps",
  // Compresión
  "gzip",
  "gunzip",
  "tar",
  "zip",
  "unzip",
  // Texto
  "cat",
  "head",
  "tail",
  "wc",
  "sort",
  "uniq",
  "grep",
  "find",
  "ls",
  "dir",
  // Node/NPM (para scripts del proyecto)
  "node",
  "npm",
  "npx",
]);

/**
 * Patrones peligrosos que se bloquean incluso dentro de comandos permitidos.
 */
const DANGEROUS_PATTERNS: RegExp[] = [
  /rm\s+(-[a-z]*r|-[a-z]*f|--recursive|--force)/i, // rm -rf, rm -f, rm --recursive
  /chmod\s+777/, // chmod 777
  />\s*\/dev\/sd/, // write to disk devices
  /mkfs/, // format filesystem
  /dd\s+if=/, // disk dump
  /:(){ :|:& };:/, // fork bomb
  /\/etc\/passwd/, // password file access
  /\/etc\/shadow/, // shadow file access
  /eval\s/, // eval execution
  /exec\s/, // exec execution
  />\s*\/etc\//, // write to /etc/
  /curl.*\|\s*(bash|sh|zsh)/, // curl pipe to shell (even if curl were allowed)
  /wget.*\|\s*(bash|sh|zsh)/, // wget pipe to shell
];

/** Validación para operaciones de sistema */
export const CommandSchema = z
  .string()
  .min(1, "Comando requerido")
  .refine(
    (cmd) => !cmd.includes("&&") && !cmd.includes("||") && !cmd.includes(";"),
    {
      message: "Encadenamiento de comandos no permitido (&&, ||, ;)",
    },
  )
  .refine((cmd) => !cmd.includes("|"), {
    message: "Piping de comandos no permitido (|)",
  })
  .refine((cmd) => !cmd.includes("`") && !cmd.includes("$("), {
    message: "Sustitución de comandos no permitida (` o $()",
  })
  .refine(
    (cmd) => {
      const binary = cmd.trim().split(/\s+/)[0].toLowerCase();
      return ALLOWED_CLI_BINARIES.has(binary);
    },
    {
      message: `Comando no permitido. Binarios permitidos: ${Array.from(ALLOWED_CLI_BINARIES).join(", ")}`,
    },
  )
  .refine(
    (cmd) => {
      const lower = cmd.toLowerCase();
      return !DANGEROUS_PATTERNS.some((pattern) => pattern.test(lower));
    },
    {
      message: "Comando contiene patrones peligrosos (rm -rf, chmod 777, etc.)",
    },
  );

/** Validación para operaciones de filesystem */
export const FilePathSchema = z
  .string()
  .min(1, "Path requerido")
  .refine((p) => !p.includes(".."), {
    message: "Path traversal no permitido (..)",
  });

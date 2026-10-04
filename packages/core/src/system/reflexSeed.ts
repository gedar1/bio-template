/**
 * Flujos pre-cargados de Memoria Refleja.
 * Exporta seedReflexes() para uso programático (ProductionServer)
 * y el array FLOWS para el script CLI.
 *
 * Cada flujo incluye arg_templates para que el sistema pueda ejecutar
 * en modo REFLEX (0 tokens) interpolando parámetros del input del usuario.
 */

import {
  computeEmbedding,
  normalizeForEmbedding,
} from "../atoms/embeddings.js";
import {
  ReflexMolecule,
  type ReflexStep,
} from "../molecules/ReflexMolecule.js";
import type { ReflexArgTemplates } from "../atoms/interpolation.js";

export interface ReflexFlow {
  label: string;
  phrases: string[];
  steps: ReflexStep[];
  argTemplates: ReflexArgTemplates;
  schemaVersions: Record<string, string>;
}

export const FLOWS: ReflexFlow[] = [
  // ── 1. Scraping → Base de datos ───────────────────────────────────────────
  {
    label: "Scrape URL → guardar en DB",
    phrases: [
      "scrapea esta URL y guardala en la base de datos",
      "extrae el contenido de la pagina y guardalo en la DB",
      "scrape this URL and save to database",
      "extrae informacion del sitio web y almacenala",
      "scrapea la url",
      "scrapea la pagina",
    ],
    steps: [
      { action: "mutate:sensory" },
      { action: "scrape_url", paramKeys: ["url"] },
      { action: "mutate:memory" },
      { action: "db_insert", paramKeys: ["table", "data"] },
    ],
    argTemplates: [
      { placeholders: {}, originalArgs: {}, placeholderMeta: [] },
      {
        placeholders: { url: "$URL" },
        originalArgs: { url: "https://example.com" },
        placeholderMeta: [{ name: "$URL", argKey: "url", valueType: "url" }],
      },
      { placeholders: {}, originalArgs: {}, placeholderMeta: [] },
      {
        placeholders: { table: "$TABLE" },
        originalArgs: { table: "scraped_data", data: {} },
        placeholderMeta: [
          { name: "$TABLE", argKey: "table", valueType: "table" },
        ],
      },
    ],
    schemaVersions: { scrape_url: "1.0.0", db_insert: "1.0.0" },
  },

  // ── 2. Scraping → Archivo ─────────────────────────────────────────────────
  {
    label: "Scrape URL → guardar en archivo",
    phrases: [
      "scrapea esta URL y guarda el contenido en un archivo",
      "descarga el contenido de la pagina y guardalo como archivo",
      "scrape the page and save it to a file",
    ],
    steps: [
      { action: "mutate:sensory" },
      { action: "scrape_url", paramKeys: ["url"] },
      { action: "mutate:filesystem" },
      { action: "write_file", paramKeys: ["path", "content"] },
    ],
    argTemplates: [
      { placeholders: {}, originalArgs: {}, placeholderMeta: [] },
      {
        placeholders: { url: "$URL" },
        originalArgs: { url: "https://example.com" },
        placeholderMeta: [{ name: "$URL", argKey: "url", valueType: "url" }],
      },
      { placeholders: {}, originalArgs: {}, placeholderMeta: [] },
      {
        placeholders: { path: "$PATH" },
        originalArgs: { path: "./output.html", content: "" },
        placeholderMeta: [{ name: "$PATH", argKey: "path", valueType: "path" }],
      },
    ],
    schemaVersions: { scrape_url: "1.0.0", write_file: "1.0.0" },
  },

  // ── 3. Git: commit + push ─────────────────────────────────────────────────
  {
    label: "Git: add → commit → push",
    phrases: [
      "haz commit y push de los cambios",
      "guarda y sube los cambios al repositorio",
      "commit and push the changes",
      "sube los cambios a git",
    ],
    steps: [
      { action: "mutate:versioncontrol" },
      { action: "git_add", paramKeys: ["files"] },
      { action: "git_commit", paramKeys: ["message"] },
      { action: "git_push" },
    ],
    argTemplates: [
      { placeholders: {}, originalArgs: {}, placeholderMeta: [] },
      {
        placeholders: { files: "$FILES" },
        originalArgs: { files: "." },
        placeholderMeta: [
          { name: "$FILES", argKey: "files", valueType: "string" },
        ],
      },
      {
        placeholders: { message: "$MESSAGE" },
        originalArgs: { message: "update" },
        placeholderMeta: [
          { name: "$MESSAGE", argKey: "message", valueType: "string" },
        ],
      },
      { placeholders: {}, originalArgs: {}, placeholderMeta: [] },
    ],
    schemaVersions: {
      git_add: "1.0.0",
      git_commit: "1.0.0",
      git_push: "1.0.0",
    },
  },

  // ── 4. Git: estado del repositorio ───────────────────────────────────────
  {
    label: "Git: status + log",
    phrases: [
      "muestra el estado del repositorio git",
      "que cambios hay pendientes en git",
      "show git status and recent commits",
      "revisa el estado del repo",
    ],
    steps: [
      { action: "mutate:versioncontrol" },
      { action: "git_status" },
      { action: "git_log" },
    ],
    argTemplates: [
      { placeholders: {}, originalArgs: {}, placeholderMeta: [] },
      { placeholders: {}, originalArgs: {}, placeholderMeta: [] },
      { placeholders: {}, originalArgs: {}, placeholderMeta: [] },
    ],
    schemaVersions: { git_status: "1.0.0", git_log: "1.0.0" },
  },

  // ── 5. Información del sistema ────────────────────────────────────────────
  {
    label: "Info del sistema",
    phrases: [
      "muestra la informacion del sistema",
      "que recursos tiene el servidor",
      "show system info",
      "cuanta memoria y cpu tiene el sistema",
    ],
    steps: [{ action: "mutate:system" }, { action: "system_info" }],
    argTemplates: [
      { placeholders: {}, originalArgs: {}, placeholderMeta: [] },
      { placeholders: {}, originalArgs: {}, placeholderMeta: [] },
    ],
    schemaVersions: { system_info: "1.0.0" },
  },

  // ── 6. Leer archivo ───────────────────────────────────────────────────────
  {
    label: "Leer archivo",
    phrases: [
      "lee el contenido del archivo",
      "muestra el contenido del fichero",
      "read the file content",
      "abre y lee el archivo",
    ],
    steps: [
      { action: "mutate:filesystem" },
      { action: "read_file", paramKeys: ["path"] },
    ],
    argTemplates: [
      { placeholders: {}, originalArgs: {}, placeholderMeta: [] },
      {
        placeholders: { path: "$PATH" },
        originalArgs: { path: "./file.txt" },
        placeholderMeta: [{ name: "$PATH", argKey: "path", valueType: "path" }],
      },
    ],
    schemaVersions: { read_file: "1.0.0" },
  },

  // ── 7. Escribir/crear archivo ─────────────────────────────────────────────
  {
    label: "Escribir archivo",
    phrases: [
      "crea un archivo con este contenido",
      "escribe este texto en un archivo",
      "create a file with this content",
      "guarda esto en un archivo nuevo",
    ],
    steps: [
      { action: "mutate:filesystem" },
      { action: "write_file", paramKeys: ["path", "content"] },
    ],
    argTemplates: [
      { placeholders: {}, originalArgs: {}, placeholderMeta: [] },
      {
        placeholders: { path: "$PATH" },
        originalArgs: { path: "./output.txt", content: "" },
        placeholderMeta: [{ name: "$PATH", argKey: "path", valueType: "path" }],
      },
    ],
    schemaVersions: { write_file: "1.0.0" },
  },

  // ── 8. Llamar API → guardar en DB ─────────────────────────────────────────
  {
    label: "HTTP GET → guardar en DB",
    phrases: [
      "llama a esta API y guarda la respuesta en la base de datos",
      "consulta el endpoint y almacena el resultado",
      "fetch the API and save the response to DB",
      "hace un GET a la URL y guarda los datos",
    ],
    steps: [
      { action: "mutate:http" },
      { action: "http_get", paramKeys: ["url"] },
      { action: "mutate:memory" },
      { action: "db_insert", paramKeys: ["table", "data"] },
    ],
    argTemplates: [
      { placeholders: {}, originalArgs: {}, placeholderMeta: [] },
      {
        placeholders: { url: "$URL" },
        originalArgs: { url: "https://api.example.com/data" },
        placeholderMeta: [{ name: "$URL", argKey: "url", valueType: "url" }],
      },
      { placeholders: {}, originalArgs: {}, placeholderMeta: [] },
      {
        placeholders: { table: "$TABLE" },
        originalArgs: { table: "api_data", data: {} },
        placeholderMeta: [
          { name: "$TABLE", argKey: "table", valueType: "table" },
        ],
      },
    ],
    schemaVersions: { http_get: "1.0.0", db_insert: "1.0.0" },
  },

  // ── 9. Enviar email ───────────────────────────────────────────────────────
  {
    label: "Enviar email",
    phrases: [
      "envia un correo electronico",
      "manda un email a",
      "send an email to",
      "enviar mensaje por correo",
    ],
    steps: [
      { action: "mutate:communication" },
      { action: "send_email", paramKeys: ["to", "subject", "body"] },
    ],
    argTemplates: [
      { placeholders: {}, originalArgs: {}, placeholderMeta: [] },
      {
        placeholders: { to: "$EMAIL" },
        originalArgs: {
          to: "user@example.com",
          subject: "Notification",
          body: "",
        },
        placeholderMeta: [{ name: "$EMAIL", argKey: "to", valueType: "email" }],
      },
    ],
    schemaVersions: { send_email: "1.0.0" },
  },

  // ── 10. Monitorear servicio web ───────────────────────────────────────────
  {
    label: "Monitorear servicio / health check",
    phrases: [
      "verifica si el servicio esta funcionando",
      "monitorea el estado del servidor",
      "check if the service is up",
      "haz un health check del endpoint",
    ],
    steps: [
      { action: "mutate:monitor" },
      { action: "http_get", paramKeys: ["url"] },
      { action: "system_info" },
    ],
    argTemplates: [
      { placeholders: {}, originalArgs: {}, placeholderMeta: [] },
      {
        placeholders: { url: "$URL" },
        originalArgs: { url: "https://example.com/health" },
        placeholderMeta: [{ name: "$URL", argKey: "url", valueType: "url" }],
      },
      { placeholders: {}, originalArgs: {}, placeholderMeta: [] },
    ],
    schemaVersions: { http_get: "1.0.0", system_info: "1.0.0" },
  },

  // ── 11. Consultar base de datos ───────────────────────────────────────────
  {
    label: "Consultar DB",
    phrases: [
      "consulta la base de datos",
      "busca registros en la DB",
      "query the database",
      "muestra los datos de la tabla",
    ],
    steps: [
      { action: "mutate:memory" },
      { action: "db_query", paramKeys: ["query"] },
    ],
    argTemplates: [
      { placeholders: {}, originalArgs: {}, placeholderMeta: [] },
      {
        placeholders: { query: "$QUERY" },
        originalArgs: { query: "SELECT * FROM data LIMIT 10" },
        placeholderMeta: [
          { name: "$QUERY", argKey: "query", valueType: "query" },
        ],
      },
    ],
    schemaVersions: { db_query: "1.0.0" },
  },

  // ── 12. Descargar archivo de URL ──────────────────────────────────────────
  {
    label: "Descargar archivo de URL",
    phrases: [
      "descarga el archivo de esta URL",
      "baja este archivo de internet",
      "download the file from this URL",
      "descarga y guarda el fichero",
    ],
    steps: [
      { action: "mutate:http" },
      { action: "http_download", paramKeys: ["url", "destination"] },
    ],
    argTemplates: [
      { placeholders: {}, originalArgs: {}, placeholderMeta: [] },
      {
        placeholders: { url: "$URL", destination: "$PATH" },
        originalArgs: {
          url: "https://example.com/file.zip",
          destination: "./downloads/",
        },
        placeholderMeta: [
          { name: "$URL", argKey: "url", valueType: "url" },
          { name: "$PATH", argKey: "destination", valueType: "path" },
        ],
      },
    ],
    schemaVersions: { http_download: "1.0.0" },
  },
];

/**
 * Siembra los flujos pre-cargados en la BD.
 * Borra reflexes existentes y re-siembra con arg_templates completos.
 *
 * @param db      Instancia inicializada de ReflexMolecule
 * @param verbose Si true, imprime cada frase sembrada
 * @returns Número de frases efectivamente insertadas
 */
export async function seedReflexes(
  db: ReflexMolecule,
  verbose = false,
): Promise<number> {
  let total = 0;

  // Access the internal DB for direct inserts (bypass sequence dedup).
  // This allows multiple embeddings per sequence — one per phrase variation.
  const internalDb = (db as any).db as import("better-sqlite3").Database;
  const { serializeArgTemplates } = await import("../atoms/interpolation.js");
  const { serializeEmbedding } = await import("../atoms/embeddings.js");

  const insertStmt = internalDb.prepare(`
    INSERT INTO reflexes
      (task_summary, sequence, steps_json, embedding, success_count, failure_count, last_used, created_at, arg_templates_json, schema_versions)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
  `);

  for (const flow of FLOWS) {
    const sequence = flow.steps
      .map((s) => s.action.trim().toLowerCase())
      .join("->");
    const stepsJson = JSON.stringify(flow.steps);
    const argTemplatesJson = serializeArgTemplates(flow.argTemplates);
    const schemaVersionsJson = JSON.stringify(flow.schemaVersions);

    for (const phrase of flow.phrases) {
      const emb = await computeEmbedding(normalizeForEmbedding(phrase));
      const now = Date.now();

      insertStmt.run(
        phrase.substring(0, 200),
        sequence,
        stepsJson,
        serializeEmbedding(emb),
        4, // success_count = 4 (above MIN_SUCCESS_COUNT of 3)
        now,
        now,
        argTemplatesJson,
        schemaVersionsJson,
      );

      total++;
      if (verbose) console.log(`  ✓ "${phrase.substring(0, 60)}"`);
    }
    if (verbose) {
      console.log(`    Secuencia: ${sequence}`);
    }
  }

  // Rebuild the vector index with all new entries
  (db as any).rebuildIndex();

  return total;
}

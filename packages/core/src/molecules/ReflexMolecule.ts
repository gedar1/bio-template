import Database from "better-sqlite3";
import { createLogger } from "../config/logger.js";
import type { IMolecule } from "./interfaces/IMolecule.js";
import { normalizeSequence } from "../atoms/sequence.js";
import type { PerfMonitor } from "../infrastructure/PerfMonitor.js";
import { resolveDataPath } from "../atoms/paths.js";

const log = createLogger("ReflexMolecule");

// ─── Interfaces ───────────────────────────────────────────────────────────────

/** Un paso de ejecución en la secuencia: mutación o tool call */
export interface ReflexStep {
  /** "mutate:sensory" | "scrape_url" | "db_insert" | etc. */
  action: string;
  /** Parámetros opcionales que ayudan al LLM a adaptar el reflex */
  paramKeys?: string[];
  /** Declarative output chaining: which arg key of the NEXT step receives this step's output */
  chainOutputTo?: string;
}

/** Un reflejo guardado: secuencia de herramientas de una tarea exitosa */
export interface ReflexRecord {
  id: number;
  /** Resumen de la tarea original (primeras 200 chars del input) */
  taskSummary: string;
  /** Secuencia canónica: "mutate:sensory->scrape_url->mutate:memory->db_insert" */
  sequence: string;
  /** Pasos deserializados */
  steps: ReflexStep[];
  /** Número de veces que se registró la secuencia (historial, no decide nada) */
  successCount: number;
  /** Número de veces que falló al reutilizarse */
  failureCount: number;
  /** Timestamp del último uso */
  lastUsed: number;
  /** Schema versions at creation time (null for legacy reflexes) */
  schemaVersions: Record<string, string> | null;
  /** Similitud con el input actual (solo en resultados de búsqueda) */
  similarity?: number;
  /** Puntaje compuesto (solo en resultados de búsqueda) */
  compositeScore?: number;
}

/** Sugerencia de cadena para un input */
export interface ReflexMatch {
  record: ReflexRecord;
  /** Confianza de la sugerencia (0-1) */
  similarity: number;
  /** Puntaje compuesto */
  compositeScore: number;
  /** Modo recomendado. Solo "hint": la sugerencia la usa el orquestador */
  mode: "reflex" | "hint" | "none";
  /** If degraded, the reason */
  degradationReason?:
    | "missing_params"
    | "schema_mismatch"
    | "execution_failure";
}

/**
 * Molécula de historial de cadenas — "Procedural Memory" de BioCore.
 *
 * Guarda las secuencias de herramientas que se ejecutaron. La selección de
 * cadenas la hace Jev sobre tools.json (ver docs/DECISIONS-AND-CONFIG.md, 3.6),
 * así que esta tabla es un registro, no un criterio de decisión.
 *
 * La columna `embedding` se conserva como texto vacío por compatibilidad con
 * la tabla existente. La búsqueda vectorial se retiró.
 */
export class ReflexMolecule implements IMolecule {
  readonly name = "reflex";
  readonly version = "1.0.0";

  private db!: Database.Database;
  private readonly dbPath: string;

  /** Optional PerfMonitor for recording reflex metrics */
  private perf?: PerfMonitor;

  constructor(
    dbPath: string = resolveDataPath(
      process.env.DATABASE_PATH || "./data/biocore.db",
    ),
    perf?: PerfMonitor,
  ) {
    this.dbPath = dbPath;
    this.perf = perf;
  }

  /** Sets the PerfMonitor instance for recording reflex metrics */
  setPerfMonitor(perf: PerfMonitor): void {
    this.perf = perf;
  }

  async initialize(): Promise<void> {
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");

    // Ejecutar script de migración para limpiar tablas obsoletas
    this.runMigration();

    this.initTable();

    log.info({ path: this.dbPath }, "ReflexMolecule conectada");
  }

  async dispose(): Promise<void> {
    this.db?.close();
  }

  private initTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reflexes (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        task_summary  TEXT    NOT NULL,
        sequence      TEXT    NOT NULL,
        steps_json    TEXT    NOT NULL,
        embedding     TEXT    NOT NULL,
        success_count INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        last_used     INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL
      )
    `);
    // Add new columns if they don't exist (backward compatible)
    this.addColumnIfNotExists("schema_versions", "TEXT DEFAULT NULL");
  }

  private runMigration(): void {
    try {
      // Drop obsolete tables from old schema
      // reflexes_atomic and reflex_dependencies were for atomic reflexes
      // Now: tools.json = atoms, reflexes table = sequences only
      this.db.exec("DROP TABLE IF EXISTS reflex_dependencies");
      this.db.exec("DROP TABLE IF EXISTS reflexes_atomic");

      log.info("Migration: Obsolete reflex tables cleaned up");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(
        { error: message },
        "Migration: Failed to clean obsolete tables (may not exist)",
      );
    }
  }

  private addColumnIfNotExists(column: string, definition: string): void {
    const info = this.db.pragma(`table_info(reflexes)`) as Array<{
      name: string;
    }>;
    if (!info.some((col) => col.name === column)) {
      this.db.exec(`ALTER TABLE reflexes ADD COLUMN ${column} ${definition}`);
    }
  }

  // ─── Core Methods ─────────────────────────────────────────────────────────

  /**
   * Guarda una secuencia ejecutada o incrementa su contador si ya existe.
   *
   * @param taskSummary    - Descripción corta del input del usuario
   * @param steps          - Pasos de ejecución en orden
   * @param schemaVersions - Schema versions at creation time (optional, legacy)
   */
  save(
    taskSummary: string,
    steps: ReflexStep[],
    schemaVersions?: Record<string, string>,
  ): number {
    const sequence = normalizeSequence(steps.map((s) => s.action));
    const schemaVersionsJson = schemaVersions
      ? JSON.stringify(schemaVersions)
      : null;

    // Verificar si ya existe una secuencia idéntica
    const existing = this.db
      .prepare("SELECT id FROM reflexes WHERE sequence = ?")
      .get(sequence) as { id: number } | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE reflexes
           SET success_count = success_count + 1, last_used = ?,
               schema_versions = COALESCE(?, schema_versions),
               steps_json = ?
           WHERE id = ?`,
        )
        .run(
          Date.now(),
          schemaVersionsJson,
          JSON.stringify(steps),
          existing.id,
        );

      log.debug({ sequence, id: existing.id }, "Reflex existente actualizado");
      return existing.id;
    }

    const result = this.db
      .prepare(
        `INSERT INTO reflexes
          (task_summary, sequence, steps_json, embedding, success_count, last_used, created_at, schema_versions)
         VALUES (?, ?, ?, '', 1, ?, ?, ?)`,
      )
      .run(
        taskSummary.substring(0, 200),
        sequence,
        JSON.stringify(steps),
        Date.now(),
        Date.now(),
        schemaVersionsJson,
      );

    const newId = result.lastInsertRowid as number;
    log.info({ sequence, id: newId }, "Nuevo reflex guardado");
    return newId;
  }

  /**
   * Incrementa el contador de fallos de un reflex.
   */
  markFailed(id: number): void {
    this.db
      .prepare(
        "UPDATE reflexes SET failure_count = failure_count + 1 WHERE id = ?",
      )
      .run(id);
  }

  /**
   * Incrementa el contador de ejecuciones y actualiza last_used.
   */
  markSuccess(id: number): void {
    this.db
      .prepare(
        "UPDATE reflexes SET success_count = success_count + 1, last_used = ? WHERE id = ?",
      )
      .run(Date.now(), id);
  }

  /** Lista todos los reflexes guardados (para debugging y dashboard) */
  list(): ReflexRecord[] {
    return (
      this.db
        .prepare(
          `SELECT id, task_summary, sequence, steps_json,
                  success_count, failure_count, last_used, schema_versions
           FROM reflexes
           ORDER BY success_count DESC`,
        )
        .all() as Array<{
        id: number;
        task_summary: string;
        sequence: string;
        steps_json: string;
        success_count: number;
        failure_count: number;
        last_used: number;
        schema_versions: string | null;
      }>
    ).map((row) => ({
      id: row.id,
      taskSummary: row.task_summary,
      sequence: row.sequence,
      steps: JSON.parse(row.steps_json) as ReflexStep[],
      successCount: row.success_count,
      failureCount: row.failure_count,
      lastUsed: row.last_used,
      schemaVersions: row.schema_versions
        ? JSON.parse(row.schema_versions)
        : null,
    }));
  }

  /**
   * Carga todos los reflexes guardados, sin filtrar, para la evaluación de Jev.
   * @returns Los registros ordenados por uso reciente
   */
  loadAllReflexes(): ReflexRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, task_summary, sequence, steps_json,
                success_count, failure_count, last_used, schema_versions
         FROM reflexes
         ORDER BY success_count DESC, last_used DESC`,
      )
      .all() as Array<{
      id: number;
      task_summary: string;
      sequence: string;
      steps_json: string;
      success_count: number;
      failure_count: number;
      last_used: number;
      schema_versions: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      taskSummary: row.task_summary,
      sequence: row.sequence,
      steps: JSON.parse(row.steps_json) as ReflexStep[],
      successCount: row.success_count,
      failureCount: row.failure_count,
      lastUsed: row.last_used,
      schemaVersions: row.schema_versions
        ? JSON.parse(row.schema_versions)
        : null,
    }));
  }

  /** Elimina un reflex por ID (para limpieza manual) */
  remove(id: number): boolean {
    const result = this.db.prepare("DELETE FROM reflexes WHERE id = ?").run(id);
    return result.changes > 0;
  }
}

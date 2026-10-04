import Database from "better-sqlite3";
import { createLogger } from "../config/logger.js";
import type { IMolecule } from "./interfaces/IMolecule.js";
import {
  cosineSimilarity,
  normalizeSequence,
  serializeEmbedding,
  deserializeEmbedding,
  type Embedding,
} from "../atoms/embeddings.js";
import {
  serializeArgTemplates,
  deserializeArgTemplates,
  type ReflexArgTemplates,
} from "../atoms/interpolation.js";
import { measureSpan } from "../config/telemetry.js";
import type { PerfMonitor } from "../infrastructure/PerfMonitor.js";

const log = createLogger("ReflexMolecule");

// ─── Dynamic import for hnswlib-node (may not be available) ───────────────────

let HierarchicalNSW: any = null;

async function loadHnswlib(): Promise<void> {
  try {
    // @ts-ignore — hnswlib-node is optional; native binary may not be available on all platforms
    const mod = await import("hnswlib-node");
    HierarchicalNSW =
      mod.HierarchicalNSW ?? (mod as any).default?.HierarchicalNSW;
  } catch {
    // hnswlib-node not available — will use linear scan fallback
  }
}

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

/** Un reflejo guardado: tarea + secuencia exitosa */
export interface ReflexRecord {
  id: number;
  /** Resumen de la tarea original (primeras 200 chars del input) */
  taskSummary: string;
  /** Secuencia canónica: "mutate:sensory→scrape_url→mutate:memory→db_insert" */
  sequence: string;
  /** Pasos deserializados */
  steps: ReflexStep[];
  /** Número de veces que se ejecutó con éxito */
  successCount: number;
  /** Número de veces que falló al reutilizarse */
  failureCount: number;
  /** Timestamp del último uso */
  lastUsed: number;
  /** Arg templates for each step (null for legacy reflexes) */
  argTemplates: ReflexArgTemplates | null;
  /** Schema versions at creation time (null for legacy reflexes) */
  schemaVersions: Record<string, string> | null;
  /** Similitud con el input actual (solo en resultados de búsqueda) */
  similarity?: number;
  /** Composite score including decay and reliability (only in search results) */
  compositeScore?: number;
}

/** Resultado de búsqueda de reflexes similares */
export interface ReflexMatch {
  record: ReflexRecord;
  /** Similitud coseno contra el input actual (0-1) */
  similarity: number;
  /** Composite score with temporal decay and reliability */
  compositeScore: number;
  /** Recomendación del sistema */
  mode: "reflex" | "hint" | "none";
  /** If degraded, the reason */
  degradationReason?:
    | "missing_params"
    | "schema_mismatch"
    | "execution_failure";
}

/**
 * Molécula de Memoria Refleja — "Procedural Memory" de BioCore.
 *
 * Guarda secuencias de herramientas que resolvieron tareas exitosamente
 * y permite recuperarlas por similitud semántica para:
 *   - REFLEX (sim > adaptive threshold, éxitos ≥ 3): ejecutar directo sin LLM
 *   - HINT   (sim > 0.80):              inyectar como contexto al LLM
 *   - NONE   (sim < 0.80):              LLM resuelve solo y aprende
 *
 * Los embeddings se almacenan serializados en SQLite (JSON).
 * Vector index (hnswlib-node) provides O(log n) search when available.
 * Costo: $0 (100% local, sin API externa).
 */
export class ReflexMolecule implements IMolecule {
  readonly name = "reflex";
  readonly version = "1.0.0";

  private db!: Database.Database;
  private readonly dbPath: string;

  /** Umbral de similitud para ejecución directa sin LLM */
  static readonly REFLEX_THRESHOLD = 0.95;
  /** Umbral de similitud para inyectar hint al LLM */
  static readonly HINT_THRESHOLD = 0.8;
  /** Mínimo de éxitos para activar modo reflex */
  static readonly MIN_SUCCESS_COUNT = 3;

  /** Half-life in days for temporal decay */
  private static readonly DECAY_HALF_LIFE_DAYS = 30;

  /** Base threshold for adaptive calculation */
  private static readonly BASE_THRESHOLD = 0.9;

  /** Max adjustment range for adaptive threshold */
  private static readonly THRESHOLD_RANGE = 0.1;

  // ─── Vector index fields ──────────────────────────────────────────────────

  private vectorIndex: any | null = null;
  private labelToId: Map<number, number> = new Map();
  private idToLabel: Map<number, number> = new Map();
  private nextLabel: number = 0;

  /** Optional PerfMonitor for recording reflex metrics */
  private perf?: PerfMonitor;

  constructor(
    dbPath: string = process.env.DATABASE_PATH || "./biocore.db",
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
    this.initTable();

    // Attempt to load hnswlib-node
    await loadHnswlib();

    // Rebuild vector index from existing data
    await measureSpan(
      "Molecule",
      "vector_index_rebuild",
      async () => {
        this.rebuildIndex();
      },
      { "vector.source": "sqlite" },
    );

    log.info({ path: this.dbPath }, "ReflexMolecule conectada");
  }

  async dispose(): Promise<void> {
    this.vectorIndex = null;
    this.labelToId.clear();
    this.idToLabel.clear();
    this.nextLabel = 0;
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
    this.addColumnIfNotExists("arg_templates_json", "TEXT DEFAULT NULL");
    this.addColumnIfNotExists("schema_versions", "TEXT DEFAULT NULL");
  }

  private addColumnIfNotExists(column: string, definition: string): void {
    const info = this.db.pragma(`table_info(reflexes)`) as Array<{
      name: string;
    }>;
    if (!info.some((col) => col.name === column)) {
      this.db.exec(`ALTER TABLE reflexes ADD COLUMN ${column} ${definition}`);
    }
  }

  // ─── Vector Index Methods ─────────────────────────────────────────────────

  private rebuildIndex(): void {
    if (!HierarchicalNSW) {
      log.debug("hnswlib-node not available, using linear scan fallback");
      return;
    }

    const rows = this.db
      .prepare("SELECT id, embedding FROM reflexes")
      .all() as Array<{ id: number; embedding: string }>;

    if (rows.length === 0) return;

    try {
      const maxElements = Math.max(rows.length * 2, 1000);
      this.vectorIndex = new HierarchicalNSW("cosine", 384);
      this.vectorIndex.initIndex(maxElements, 16, 200, 100);

      for (const row of rows) {
        const embedding = deserializeEmbedding(row.embedding);
        this.vectorIndex.addPoint(embedding, this.nextLabel);
        this.labelToId.set(this.nextLabel, row.id);
        this.idToLabel.set(row.id, this.nextLabel);
        this.nextLabel++;
      }

      log.info({ count: rows.length }, "Vector index rebuilt");
    } catch (err: any) {
      log.warn(
        { error: err.message },
        "Failed to rebuild vector index, using linear scan fallback",
      );
      this.vectorIndex = null;
    }
  }

  private insertIntoIndex(id: number, embedding: Embedding): void {
    if (!this.vectorIndex) return;

    try {
      // Resize if needed
      if (this.nextLabel >= this.vectorIndex.getMaxElements()) {
        this.vectorIndex.resizeIndex(this.vectorIndex.getMaxElements() * 2);
      }

      // If this id already has a label, we skip re-adding (HNSW doesn't support update)
      if (this.idToLabel.has(id)) return;

      this.vectorIndex.addPoint(embedding, this.nextLabel);
      this.labelToId.set(this.nextLabel, id);
      this.idToLabel.set(id, this.nextLabel);
      this.nextLabel++;
    } catch (err: any) {
      log.warn(
        { error: err.message, id },
        "Failed to insert into vector index",
      );
    }
  }

  // ─── Scoring Methods ──────────────────────────────────────────────────────

  /**
   * Exponential decay based on days since last use.
   * halfLifeDays = 30 → unused for 30 days = 50% weight.
   */
  static temporalDecay(
    lastUsedMs: number,
    nowMs: number = Date.now(),
    halfLifeDays: number = 30,
  ): number {
    const daysSinceUse = (nowMs - lastUsedMs) / (1000 * 60 * 60 * 24);
    return Math.pow(0.5, daysSinceUse / halfLifeDays);
  }

  /**
   * Reliability boost: slight preference for higher success ratio.
   * Maps [0,1] success ratio → [0.8, 1.2] multiplier.
   */
  static reliabilityBoost(successCount: number, failureCount: number): number {
    const total = successCount + failureCount;
    if (total === 0) return 1.0;
    const ratio = successCount / total;
    return 0.8 + 0.4 * ratio;
  }

  /**
   * Adaptive threshold based on success/failure ratio.
   * High success → lower threshold (easier to activate).
   * High failure → higher threshold (harder to activate).
   * Clamped to [HINT_THRESHOLD, 1.0].
   */
  static computeAdaptiveThreshold(
    successCount: number,
    failureCount: number,
  ): number {
    const total = successCount + failureCount;
    if (total < ReflexMolecule.MIN_SUCCESS_COUNT)
      return ReflexMolecule.BASE_THRESHOLD;

    const successRatio = successCount / total;
    const adjustment =
      ReflexMolecule.THRESHOLD_RANGE * (successRatio - 0.5) * 2;
    const threshold = ReflexMolecule.BASE_THRESHOLD - adjustment;

    return Math.max(ReflexMolecule.HINT_THRESHOLD, Math.min(1.0, threshold));
  }

  // ─── Core Methods ─────────────────────────────────────────────────────────

  /**
   * Guarda una nueva secuencia exitosa o incrementa su contador si ya existe.
   *
   * @param taskSummary    - Descripción corta del input del usuario
   * @param steps          - Pasos de ejecución en orden
   * @param embedding      - Vector del taskSummary (calculado con computeEmbedding)
   * @param argTemplates   - Arg templates for each step (optional)
   * @param schemaVersions - Schema versions at creation time (optional)
   */
  save(
    taskSummary: string,
    steps: ReflexStep[],
    embedding: Embedding,
    argTemplates?: ReflexArgTemplates,
    schemaVersions?: Record<string, string>,
  ): number {
    const sequence = normalizeSequence(steps.map((s) => s.action));
    const argTemplatesJson = argTemplates
      ? serializeArgTemplates(argTemplates)
      : null;
    const schemaVersionsJson = schemaVersions
      ? JSON.stringify(schemaVersions)
      : null;

    // Verificar si ya existe una secuencia idéntica
    const existing = this.db
      .prepare("SELECT id, success_count FROM reflexes WHERE sequence = ?")
      .get(sequence) as { id: number; success_count: number } | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE reflexes 
           SET success_count = success_count + 1, last_used = ?,
               arg_templates_json = COALESCE(?, arg_templates_json),
               schema_versions = COALESCE(?, schema_versions),
               steps_json = ?
           WHERE id = ?`,
        )
        .run(
          Date.now(),
          argTemplatesJson,
          schemaVersionsJson,
          JSON.stringify(steps),
          existing.id,
        );

      // Update vector index if embedding changed
      this.insertIntoIndex(existing.id, embedding);

      log.debug({ sequence, id: existing.id }, "Reflex existente actualizado");
      return existing.id;
    }

    const result = this.db
      .prepare(
        `INSERT INTO reflexes
          (task_summary, sequence, steps_json, embedding, success_count, last_used, created_at, arg_templates_json, schema_versions)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      )
      .run(
        taskSummary.substring(0, 200),
        sequence,
        JSON.stringify(steps),
        serializeEmbedding(embedding),
        Date.now(),
        Date.now(),
        argTemplatesJson,
        schemaVersionsJson,
      );

    const newId = result.lastInsertRowid as number;
    this.insertIntoIndex(newId, embedding);

    log.info({ sequence, id: newId }, "Nuevo reflex guardado");
    return newId;
  }

  /**
   * Busca el reflex más similar al embedding dado.
   * Uses HNSW vector index when available, falls back to linear scan.
   * Applies temporal decay and reliability boost for composite scoring.
   *
   * @param embedding  - Vector del input actual
   * @param topK       - Máximo de candidatos a evaluar (default: 5)
   * @returns El mejor match con su similitud y modo recomendado
   */
  findSimilar(embedding: Embedding, topK: number = 5): ReflexMatch | null {
    const now = Date.now();
    let candidates: Array<{ id: number; similarity: number }>;

    if (this.vectorIndex && this.labelToId.size > 0) {
      // Use HNSW index for fast search
      const k = Math.min(topK * 2, this.labelToId.size);
      const result = this.vectorIndex.searchKnn(embedding, k);
      candidates = result.neighbors.map((label: number, i: number) => ({
        id: this.labelToId.get(label)!,
        similarity: 1 - result.distances[i], // cosine distance → similarity
      }));
    } else {
      // Fallback: linear scan
      const rows = this.db
        .prepare(
          `SELECT id, embedding FROM reflexes ORDER BY success_count DESC, last_used DESC LIMIT 50`,
        )
        .all() as Array<{ id: number; embedding: string }>;

      if (rows.length === 0) {
        this.perf?.recordReflexQuery("miss");
        return null;
      }

      candidates = rows.map((row) => ({
        id: row.id,
        similarity: cosineSimilarity(
          embedding,
          deserializeEmbedding(row.embedding),
        ),
      }));
    }

    if (candidates.length === 0) {
      this.perf?.recordReflexQuery("miss");
      return null;
    }

    // Fetch metadata for candidates
    const ids = candidates.map((c) => c.id);
    const placeholders = ids.map(() => "?").join(",");
    const metaRows = this.db
      .prepare(
        `SELECT id, task_summary, sequence, steps_json, success_count, failure_count, 
                last_used, arg_templates_json, schema_versions
         FROM reflexes WHERE id IN (${placeholders})`,
      )
      .all(...ids) as Array<{
      id: number;
      task_summary: string;
      sequence: string;
      steps_json: string;
      success_count: number;
      failure_count: number;
      last_used: number;
      arg_templates_json: string | null;
      schema_versions: string | null;
    }>;

    const metaMap = new Map(metaRows.map((r) => [r.id, r]));

    // Compute composite scores
    const scored = candidates
      .filter((c) => metaMap.has(c.id))
      .map((c) => {
        const meta = metaMap.get(c.id)!;
        const decay = ReflexMolecule.temporalDecay(meta.last_used, now);
        const reliability = ReflexMolecule.reliabilityBoost(
          meta.success_count,
          meta.failure_count,
        );
        const compositeScore = c.similarity * decay * reliability;
        return { ...c, meta, compositeScore };
      })
      .sort((a, b) => b.compositeScore - a.compositeScore)
      .slice(0, topK);

    const best = scored[0];
    if (!best || best.similarity < ReflexMolecule.HINT_THRESHOLD) {
      this.perf?.recordReflexQuery("miss");
      return null;
    }

    const record: ReflexRecord = {
      id: best.meta.id,
      taskSummary: best.meta.task_summary,
      sequence: best.meta.sequence,
      steps: JSON.parse(best.meta.steps_json) as ReflexStep[],
      successCount: best.meta.success_count,
      failureCount: best.meta.failure_count,
      lastUsed: best.meta.last_used,
      argTemplates: best.meta.arg_templates_json
        ? deserializeArgTemplates(best.meta.arg_templates_json)
        : null,
      schemaVersions: best.meta.schema_versions
        ? JSON.parse(best.meta.schema_versions)
        : null,
      similarity: best.similarity,
      compositeScore: best.compositeScore,
    };

    // Determine mode using adaptive threshold
    const adaptiveThreshold = ReflexMolecule.computeAdaptiveThreshold(
      best.meta.success_count,
      best.meta.failure_count,
    );
    const isReflex =
      best.similarity >= adaptiveThreshold &&
      best.meta.success_count >= ReflexMolecule.MIN_SUCCESS_COUNT;
    const mode: ReflexMatch["mode"] = isReflex ? "reflex" : "hint";

    // Record metrics
    this.perf?.recordReflexQuery(mode, best.similarity);

    log.debug(
      {
        sequence: record.sequence,
        similarity: best.similarity.toFixed(3),
        compositeScore: best.compositeScore.toFixed(3),
        adaptiveThreshold: adaptiveThreshold.toFixed(3),
        mode,
      },
      "Reflex encontrado",
    );

    return {
      record,
      similarity: best.similarity,
      compositeScore: best.compositeScore,
      mode,
    };
  }

  /**
   * Incrementa el contador de fallos de un reflex.
   * Se llama cuando un reflex ejecutado directamente produjo un resultado incorrecto.
   */
  markFailed(id: number): void {
    this.db
      .prepare(
        "UPDATE reflexes SET failure_count = failure_count + 1 WHERE id = ?",
      )
      .run(id);
  }

  /**
   * Incrementa el contador de éxitos y actualiza last_used.
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
                  success_count, failure_count, last_used,
                  arg_templates_json, schema_versions
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
        arg_templates_json: string | null;
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
      argTemplates: row.arg_templates_json
        ? deserializeArgTemplates(row.arg_templates_json)
        : null,
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

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

interface HnswIndex {
  initIndex(
    maxElements: number,
    m: number,
    efConstruction: number,
    randomSeed: number,
  ): void;
  addPoint(embedding: Embedding, label: number): void;
  getMaxElements(): number;
  resizeIndex(maxElements: number): void;
  searchKnn(
    embedding: Embedding,
    k: number,
  ): { neighbors: number[]; distances: number[] };
}

type HnswConstructor = new (space: "cosine", dimension: number) => HnswIndex;

type HnswModule = {
  HierarchicalNSW?: HnswConstructor;
  default?: { HierarchicalNSW?: HnswConstructor };
};

let HierarchicalNSW: HnswConstructor | null = null;

async function loadHnswlib(): Promise<void> {
  try {
    // @ts-ignore — hnswlib-node is an optional peer without required type declarations
    const mod = (await import("hnswlib-node")) as unknown as HnswModule;
    HierarchicalNSW =
      mod.HierarchicalNSW ?? mod.default?.HierarchicalNSW ?? null;
    if (!HierarchicalNSW) {
      log.info("hnswlib-node unavailable; using linear scan fallback");
    }
  } catch (error: unknown) {
    HierarchicalNSW = null;
    log.info(
      { error: error instanceof Error ? error.message : String(error) },
      "hnswlib-node unavailable; using linear scan fallback",
    );
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
 * Vector index (`hnswlib-node`, optional peer) provides O(log n) search when available.
 * Linear scan remains available with O(n) cost when the native index is absent.
 * `better-sqlite3` is a separate required native dependency for persistence.
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

  private vectorIndex: HnswIndex | null = null;
  private vectorIndexMode: "hnsw" | "linear" = "linear";
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

  /** Reports whether reflex search uses HNSW or the linear fallback. */
  getVectorIndexMode(): "hnsw" | "linear" {
    if (this.vectorIndexMode === "hnsw" && !this.hasUsableVectorIndex()) {
      this.invalidateVectorIndex("mapping", "HNSW label maps are inconsistent");
    }
    return this.vectorIndexMode;
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
    this.vectorIndexMode = "linear";
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

  private invalidateVectorIndex(
    operation: "addPoint" | "resizeIndex" | "rebuild" | "searchKnn" | "mapping",
    error: unknown,
    id?: number,
  ): void {
    this.vectorIndex = null;
    this.vectorIndexMode = "linear";
    this.labelToId.clear();
    this.idToLabel.clear();
    this.nextLabel = 0;

    log.warn(
      {
        operation,
        ...(id === undefined ? {} : { id }),
        error: error instanceof Error ? error.message : String(error),
      },
      "HNSW vector index invalidated; using linear scan fallback",
    );
  }

  private hasUsableVectorIndex(): boolean {
    if (
      !this.vectorIndex ||
      this.labelToId.size === 0 ||
      this.idToLabel.size !== this.labelToId.size ||
      this.nextLabel !== this.labelToId.size
    ) {
      return false;
    }

    for (const [label, id] of this.labelToId) {
      if (this.idToLabel.get(id) !== label) return false;
    }
    for (const [id, label] of this.idToLabel) {
      if (this.labelToId.get(label) !== id) return false;
    }
    return true;
  }

  private rebuildIndex(): void {
    // Linear is the safe state until an index is fully initialized and usable.
    this.vectorIndex = null;
    this.vectorIndexMode = "linear";
    this.labelToId.clear();
    this.idToLabel.clear();
    this.nextLabel = 0;

    const rows = this.db
      .prepare("SELECT id, embedding FROM reflexes")
      .all() as Array<{ id: number; embedding: string }>;

    if (!HierarchicalNSW || rows.length === 0) {
      log.info(
        { vectorIndex: this.vectorIndexMode },
        "Using linear scan fallback for reflex search",
      );
      return;
    }

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

      if (!this.hasUsableVectorIndex() || this.labelToId.size !== rows.length) {
        this.invalidateVectorIndex(
          "mapping",
          "HNSW label maps are inconsistent",
        );
        return;
      }

      this.vectorIndexMode = "hnsw";
      log.info({ count: rows.length }, "Vector index rebuilt");
    } catch (error: unknown) {
      this.invalidateVectorIndex("rebuild", error);
    }
  }

  private insertIntoIndex(id: number, embedding: Embedding): void {
    if (!this.vectorIndex) {
      if (HierarchicalNSW) {
        this.rebuildIndex();
      }
      return;
    }
    if (!this.hasUsableVectorIndex()) {
      this.invalidateVectorIndex(
        "mapping",
        "HNSW label maps are inconsistent",
        id,
      );
      return;
    }

    let operation: "addPoint" | "resizeIndex" = "addPoint";
    try {
      // Resize if needed
      const currentMaxElements = this.vectorIndex.getMaxElements();
      if (this.nextLabel >= currentMaxElements) {
        operation = "resizeIndex";
        const nextMaxElements = Math.max(
          this.nextLabel + 1,
          Math.max(currentMaxElements, 1) * 2,
        );
        this.vectorIndex.resizeIndex(nextMaxElements);
        operation = "addPoint";
      }

      // If this id already has a label, we skip re-adding (HNSW doesn't support update)
      if (this.idToLabel.has(id)) return;

      this.vectorIndex.addPoint(embedding, this.nextLabel);
      this.labelToId.set(this.nextLabel, id);
      this.idToLabel.set(id, this.nextLabel);
      this.nextLabel++;
    } catch (error: unknown) {
      this.invalidateVectorIndex(operation, error, id);
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
    const serializedEmbedding = serializeEmbedding(embedding);
    const argTemplatesJson = argTemplates
      ? serializeArgTemplates(argTemplates)
      : null;
    const schemaVersionsJson = schemaVersions
      ? JSON.stringify(schemaVersions)
      : null;

    // Verificar si ya existe una secuencia idéntica
    const existing = this.db
      .prepare(
        "SELECT id, success_count, embedding FROM reflexes WHERE sequence = ?",
      )
      .get(sequence) as
      | { id: number; success_count: number; embedding: string }
      | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE reflexes 
           SET embedding = ?, success_count = success_count + 1, last_used = ?,
               arg_templates_json = COALESCE(?, arg_templates_json),
               schema_versions = COALESCE(?, schema_versions),
               steps_json = ?
           WHERE id = ?`,
        )
        .run(
          serializedEmbedding,
          Date.now(),
          argTemplatesJson,
          schemaVersionsJson,
          JSON.stringify(steps),
          existing.id,
        );

      // HNSW does not support updates; rebuild from SQLite when its embedding changes.
      if (existing.embedding !== serializedEmbedding && this.vectorIndex) {
        this.rebuildIndex();
      }

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
        serializedEmbedding,
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

  private findLinearCandidates(
    embedding: Embedding,
  ): Array<{ id: number; similarity: number }> {
    const rows = this.db
      .prepare(
        "SELECT id, embedding FROM reflexes ORDER BY success_count DESC, last_used DESC",
      )
      .all() as Array<{ id: number; embedding: string }>;

    return rows.flatMap((row) => {
      try {
        const candidateEmbedding = deserializeEmbedding(row.embedding);
        if (
          !Array.isArray(candidateEmbedding) ||
          candidateEmbedding.length !== 384 ||
          candidateEmbedding.some((value) => !Number.isFinite(value))
        ) {
          throw new TypeError(
            "embedding must be a finite 384-dimensional array",
          );
        }

        return [
          {
            id: row.id,
            similarity: cosineSimilarity(embedding, candidateEmbedding),
          },
        ];
      } catch (error: unknown) {
        log.warn(
          {
            id: row.id,
            error: error instanceof Error ? error.message : String(error),
          },
          "Skipping invalid reflex embedding during linear scan",
        );
        return [];
      }
    });
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

    if (this.vectorIndex && !this.hasUsableVectorIndex()) {
      this.invalidateVectorIndex("mapping", "HNSW label maps are inconsistent");
    }

    if (this.hasUsableVectorIndex()) {
      const k = Math.min(topK * 2, this.labelToId.size);
      try {
        const result = this.vectorIndex!.searchKnn(embedding, k);
        const hasInvalidLabels =
          result.neighbors.length !== result.distances.length ||
          result.neighbors.some(
            (label: number) =>
              !Number.isInteger(label) || !this.labelToId.has(label),
          ) ||
          result.distances.some(
            (distance: number) => !Number.isFinite(distance),
          );

        if (hasInvalidLabels) {
          this.invalidateVectorIndex(
            "searchKnn",
            "HNSW search returned inconsistent labels",
          );
          candidates = this.findLinearCandidates(embedding);
        } else {
          this.vectorIndexMode = "hnsw";
          candidates = result.neighbors.map((label: number, i: number) => ({
            id: this.labelToId.get(label) as number,
            similarity: 1 - result.distances[i], // cosine distance → similarity
          }));
        }
      } catch (error: unknown) {
        this.invalidateVectorIndex("searchKnn", error);
        candidates = this.findLinearCandidates(embedding);
      }
    } else {
      this.vectorIndexMode = "linear";
      candidates = this.findLinearCandidates(embedding);
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

  /**
   * Loads ALL reflexes from the database without embeddings filtering.
   * Used for single-phase Jev noul routing (no pre-filtering).
   *
   * Returns all reflexes sorted by success count descending.
   *
   * @returns All reflex records unsorted by similarity, ready for Jev evaluation
   */
  loadAllReflexes(): ReflexRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, task_summary, sequence, steps_json,
                success_count, failure_count, last_used,
                arg_templates_json, schema_versions
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
      arg_templates_json: string | null;
      schema_versions: string | null;
    }>;

    log.debug(
      { count: rows.length },
      "Loaded all reflexes for Jev evaluation (single-phase routing)",
    );

    return rows.map((row) => ({
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
    if (result.changes > 0 && this.vectorIndex) {
      this.rebuildIndex();
    }
    return result.changes > 0;
  }
}

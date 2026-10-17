import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { existsSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hnswFixture = vi.hoisted(() => ({
  failConstruct: false,
  failInit: false,
  failAdd: false,
  failAddAfter: null as number | null,
  addCalls: 0,
  failResize: false,
  failSearch: false,
  forceResize: false,
}));

const loggerFixture = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@xenova/transformers", () => ({
  pipeline: vi.fn(),
  env: { allowLocalModels: true, allowRemoteModels: true },
}));

vi.mock("../../src/config/logger.js", () => ({
  createLogger: vi.fn(() => loggerFixture),
}));

vi.mock(
  "hnswlib-node",
  () => {
    class FakeHnswIndex {
      private maxElements = 0;
      private readonly points = new Map<number, number[]>();

      constructor(_space: "cosine", _dimension: number) {
        if (hnswFixture.failConstruct) {
          throw new Error("fixture constructor failure");
        }
      }

      initIndex(maxElements: number): void {
        if (hnswFixture.failInit) {
          throw new Error("fixture initIndex failure");
        }
        this.maxElements = maxElements;
      }

      addPoint(embedding: number[], label: number): void {
        hnswFixture.addCalls++;
        if (
          hnswFixture.failAdd ||
          (hnswFixture.failAddAfter !== null &&
            hnswFixture.addCalls > hnswFixture.failAddAfter)
        ) {
          throw new Error("fixture addPoint failure");
        }
        this.points.set(label, embedding);
      }

      getMaxElements(): number {
        return hnswFixture.forceResize ? 0 : this.maxElements;
      }

      resizeIndex(maxElements: number): void {
        if (hnswFixture.failResize) {
          throw new Error("fixture resizeIndex failure");
        }
        this.maxElements = maxElements;
      }

      searchKnn(
        embedding: number[],
        k: number,
      ): { neighbors: number[]; distances: number[] } {
        if (hnswFixture.failSearch) {
          throw new Error("fixture searchKnn failure");
        }
        const scored = [...this.points.entries()]
          .map(([label, point]) => ({
            label,
            similarity: point.reduce(
              (sum, value, index) => sum + value * embedding[index],
              0,
            ),
          }))
          .sort((left, right) => right.similarity - left.similarity)
          .slice(0, k);

        return {
          neighbors: scored.map(({ label }) => label),
          distances: scored.map(({ similarity }) => 1 - similarity),
        };
      }
    }

    return { HierarchicalNSW: FakeHnswIndex };
  },
  { virtual: true },
);

import { ReflexMolecule } from "../../src/molecules/ReflexMolecule.js";

function createTempDbPath(): string {
  return join(tmpdir(), `reflex-hnsw-failure-${randomUUID()}.db`);
}

function createFakeEmbedding(seed: number): number[] {
  const embedding = new Array(384).fill(0) as number[];
  for (let index = 0; index < embedding.length; index++) {
    embedding[index] = Math.sin(seed * (index + 1) * 0.01);
  }
  const norm = Math.sqrt(
    embedding.reduce((sum, value) => sum + value * value, 0),
  );
  return embedding.map((value) => value / norm);
}

function createDirectionalEmbedding(index: number): number[] {
  const embedding = new Array(384).fill(0) as number[];
  embedding[index] = 1;
  return embedding;
}

function seedDatabase(dbPath: string, embedding: number[]): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE reflexes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_summary TEXT NOT NULL,
      sequence TEXT NOT NULL,
      steps_json TEXT NOT NULL,
      embedding TEXT NOT NULL,
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_used INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      arg_templates_json TEXT DEFAULT NULL,
      schema_versions TEXT DEFAULT NULL
    )
  `);
  db.prepare(
    `INSERT INTO reflexes
      (task_summary, sequence, steps_json, embedding, success_count, last_used, created_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    "seed reflex",
    "seed_action",
    JSON.stringify([{ action: "seed_action" }]),
    JSON.stringify(embedding),
    Date.now(),
    Date.now(),
  );
  db.close();
}

function insertRawReflex(
  dbPath: string,
  action: string,
  embedding: string,
): void {
  const db = new Database(dbPath);
  const now = Date.now();
  db.prepare(
    `INSERT INTO reflexes
      (task_summary, sequence, steps_json, embedding, success_count, last_used, created_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    `raw ${action}`,
    action,
    JSON.stringify([{ action }]),
    embedding,
    now,
    now,
  );
  db.close();
}

function cleanupDb(dbPath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const path = dbPath + suffix;
    if (existsSync(path)) {
      try {
        unlinkSync(path);
      } catch {
        // Ignore cleanup races on Windows.
      }
    }
  }
}

type RebuildableMolecule = {
  rebuildIndex(): void;
};

type CorruptibleMolecule = {
  labelToId: Map<number, number>;
};

describe("ReflexMolecule HNSW failure recovery", () => {
  let molecule: ReflexMolecule;
  let dbPath: string;

  beforeEach(async () => {
    hnswFixture.failConstruct = false;
    hnswFixture.failInit = false;
    hnswFixture.failAdd = false;
    hnswFixture.failAddAfter = null;
    hnswFixture.addCalls = 0;
    hnswFixture.failResize = false;
    hnswFixture.failSearch = false;
    hnswFixture.forceResize = false;
    loggerFixture.warn.mockClear();
    dbPath = createTempDbPath();
    seedDatabase(dbPath, createFakeEmbedding(1));
    molecule = new ReflexMolecule(dbPath);
    await molecule.initialize();
    expect(molecule.getVectorIndexMode()).toBe("hnsw");
  });

  afterEach(async () => {
    await molecule.dispose();
    cleanupDb(dbPath);
  });

  it("builds HNSW on the first save into an empty database", async () => {
    await molecule.dispose();
    cleanupDb(dbPath);
    dbPath = createTempDbPath();
    molecule = new ReflexMolecule(dbPath);
    await molecule.initialize();

    const embedding = createFakeEmbedding(2);
    const id = molecule.save(
      "reflex saved into an empty database",
      [{ action: "first_save_action" }],
      embedding,
    );

    expect(id).toBeGreaterThan(0);
    expect(molecule.getVectorIndexMode()).toBe("hnsw");
    expect(molecule.findSimilar(embedding)?.record.taskSummary).toBe(
      "reflex saved into an empty database",
    );
  });

  it("invalidates HNSW after addPoint failure and recovers on rebuild", () => {
    const embedding = createFakeEmbedding(2);
    hnswFixture.failAdd = true;

    const id = molecule.save(
      "reflex saved after add failure",
      [{ action: "add_failure_action" }],
      embedding,
    );

    expect(id).toBeGreaterThan(0);
    expect(molecule.getVectorIndexMode()).toBe("linear");
    expect(molecule.list()).toHaveLength(2);
    expect(molecule.findSimilar(embedding)?.record.taskSummary).toBe(
      "reflex saved after add failure",
    );
    expect(loggerFixture.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "addPoint",
        id,
        error: "fixture addPoint failure",
      }),
      expect.stringContaining("invalidated"),
    );

    hnswFixture.failAdd = false;
    (molecule as unknown as RebuildableMolecule).rebuildIndex();

    expect(molecule.getVectorIndexMode()).toBe("hnsw");
    expect(molecule.findSimilar(embedding)?.record.taskSummary).toBe(
      "reflex saved after add failure",
    );
  });

  it("reports linear when HNSW label maps become inconsistent", () => {
    const embedding = createFakeEmbedding(5);
    molecule.save(
      "reflex with inconsistent labels",
      [{ action: "inconsistent_label_action" }],
      embedding,
    );
    (molecule as unknown as CorruptibleMolecule).labelToId.clear();

    expect(molecule.getVectorIndexMode()).toBe("linear");
    expect(molecule.findSimilar(embedding)?.record.taskSummary).toBe(
      "reflex with inconsistent labels",
    );
  });

  it("falls back to linear search when HNSW search fails", () => {
    const embedding = createFakeEmbedding(4);
    const id = molecule.save(
      "reflex saved before search failure",
      [{ action: "search_failure_action" }],
      embedding,
    );
    hnswFixture.failSearch = true;

    const match = molecule.findSimilar(embedding);

    expect(id).toBeGreaterThan(0);
    expect(molecule.getVectorIndexMode()).toBe("linear");
    expect(match?.record.taskSummary).toBe(
      "reflex saved before search failure",
    );
    expect(molecule.list()).toHaveLength(2);
    expect(loggerFixture.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "searchKnn",
        error: "fixture searchKnn failure",
      }),
      expect.stringContaining("invalidated"),
    );

    hnswFixture.failSearch = false;
    (molecule as unknown as RebuildableMolecule).rebuildIndex();

    expect(molecule.getVectorIndexMode()).toBe("hnsw");
    expect(molecule.findSimilar(embedding)?.record.taskSummary).toBe(
      "reflex saved before search failure",
    );
  });

  it("rebuilds after removing, reinserting, and reopening with SQLite consistency", async () => {
    const indexedId = molecule.list()[0].id;
    const indexedEmbedding = createFakeEmbedding(1);
    expect(molecule.findSimilar(indexedEmbedding)?.record.taskSummary).toBe(
      "seed reflex",
    );

    const remainingEmbedding = createDirectionalEmbedding(8);
    const remainingId = molecule.save(
      "remaining reflex after removal",
      [{ action: "remaining_after_removal_action" }],
      remainingEmbedding,
    );

    expect(molecule.remove(indexedId)).toBe(true);
    expect(molecule.getVectorIndexMode()).toBe("hnsw");
    expect(molecule.list().map((record) => record.id)).toEqual([remainingId]);
    expect(molecule.findSimilar(remainingEmbedding)?.record.taskSummary).toBe(
      "remaining reflex after removal",
    );

    const reinsertedEmbedding = createDirectionalEmbedding(9);
    const reinsertedId = molecule.save(
      "reinserted reflex after removal",
      [{ action: "reinserted_after_removal_action" }],
      reinsertedEmbedding,
    );
    expect(molecule.getVectorIndexMode()).toBe("hnsw");
    expect(molecule.list().map((record) => record.id)).toEqual([
      remainingId,
      reinsertedId,
    ]);
    expect(molecule.findSimilar(reinsertedEmbedding)?.record.taskSummary).toBe(
      "reinserted reflex after removal",
    );

    await molecule.dispose();
    molecule = new ReflexMolecule(dbPath);
    await molecule.initialize();

    expect(molecule.getVectorIndexMode()).toBe("hnsw");
    expect(molecule.list().map((record) => record.id)).toEqual([
      remainingId,
      reinsertedId,
    ]);
    expect(molecule.findSimilar(remainingEmbedding)?.record.taskSummary).toBe(
      "remaining reflex after removal",
    );
    expect(molecule.findSimilar(reinsertedEmbedding)?.record.taskSummary).toBe(
      "reinserted reflex after removal",
    );
  });

  it("invalidates HNSW after resize failure while preserving linear search", () => {
    const embedding = createFakeEmbedding(3);
    hnswFixture.forceResize = true;
    hnswFixture.failResize = true;

    const id = molecule.save(
      "reflex saved after resize failure",
      [{ action: "resize_failure_action" }],
      embedding,
    );

    expect(id).toBeGreaterThan(0);
    expect(molecule.getVectorIndexMode()).toBe("linear");
    expect(molecule.list()).toHaveLength(2);
    expect(molecule.findSimilar(embedding)?.record.taskSummary).toBe(
      "reflex saved after resize failure",
    );
    expect(loggerFixture.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "resizeIndex",
        id,
        error: "fixture resizeIndex failure",
      }),
      expect.stringContaining("invalidated"),
    );

    hnswFixture.forceResize = false;
    hnswFixture.failResize = false;
    (molecule as unknown as RebuildableMolecule).rebuildIndex();

    expect(molecule.getVectorIndexMode()).toBe("hnsw");
    expect(molecule.findSimilar(embedding)?.record.taskSummary).toBe(
      "reflex saved after resize failure",
    );
  });

  it("recovers to linear search when HNSW construction fails", () => {
    hnswFixture.failConstruct = true;

    (molecule as unknown as RebuildableMolecule).rebuildIndex();

    expect(molecule.getVectorIndexMode()).toBe("linear");
    expect(molecule.list()).toHaveLength(1);
    expect(
      molecule.findSimilar(createFakeEmbedding(1))?.record.taskSummary,
    ).toBe("seed reflex");

    hnswFixture.failConstruct = false;
    (molecule as unknown as RebuildableMolecule).rebuildIndex();
    expect(molecule.getVectorIndexMode()).toBe("hnsw");
    expect(molecule.list()).toHaveLength(1);
  });

  it("recovers to linear search when HNSW initialization fails", () => {
    hnswFixture.failInit = true;

    (molecule as unknown as RebuildableMolecule).rebuildIndex();

    expect(molecule.getVectorIndexMode()).toBe("linear");
    expect(
      molecule.findSimilar(createFakeEmbedding(1))?.record.taskSummary,
    ).toBe("seed reflex");

    hnswFixture.failInit = false;
    (molecule as unknown as RebuildableMolecule).rebuildIndex();
    expect(molecule.getVectorIndexMode()).toBe("hnsw");
  });

  it("recovers to linear search after a partial rebuild", () => {
    const embedding = createDirectionalEmbedding(1);
    molecule.save(
      "reflex saved before partial rebuild",
      [{ action: "partial_rebuild_action" }],
      embedding,
    );
    hnswFixture.addCalls = 0;
    hnswFixture.failAddAfter = 1;

    (molecule as unknown as RebuildableMolecule).rebuildIndex();

    expect(molecule.getVectorIndexMode()).toBe("linear");
    expect(molecule.list()).toHaveLength(2);
    expect(molecule.findSimilar(embedding)?.record.taskSummary).toBe(
      "reflex saved before partial rebuild",
    );

    hnswFixture.failAddAfter = null;
    (molecule as unknown as RebuildableMolecule).rebuildIndex();
    expect(molecule.getVectorIndexMode()).toBe("hnsw");
    expect(molecule.list()).toHaveLength(2);
  });

  it("skips corrupt SQLite embeddings and continues with valid rows", async () => {
    const validEmbedding = createDirectionalEmbedding(2);
    molecule.save(
      "valid reflex after corrupt rows",
      [{ action: "valid_after_corrupt_action" }],
      validEmbedding,
    );
    insertRawReflex(dbPath, "invalid_json_action", "{not-json");
    insertRawReflex(
      dbPath,
      "invalid_shape_action",
      JSON.stringify({ vector: [] }),
    );

    await molecule.dispose();
    molecule = new ReflexMolecule(dbPath);
    await molecule.initialize();

    expect(molecule.getVectorIndexMode()).toBe("linear");
    const match = molecule.findSimilar(validEmbedding);

    expect(molecule.list()).toHaveLength(4);
    expect(match?.record.taskSummary).toBe("valid reflex after corrupt rows");
    expect(loggerFixture.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) }),
      "Skipping invalid reflex embedding during linear scan",
    );
  });

  it("evaluates every valid candidate in linear fallback without truncation", () => {
    for (let index = 0; index < 51; index++) {
      molecule.save(
        `directional reflex ${index}`,
        [{ action: `directional_action_${index}` }],
        createDirectionalEmbedding(index),
      );
    }
    hnswFixture.failSearch = true;

    const match = molecule.findSimilar(createDirectionalEmbedding(50), 1);

    expect(match?.record.taskSummary).toBe("directional reflex 50");
  });
});

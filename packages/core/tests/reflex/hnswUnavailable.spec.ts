import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@xenova/transformers", () => ({
  pipeline: vi.fn(),
  env: { allowLocalModels: true, allowRemoteModels: true },
}));

vi.mock(
  "hnswlib-node",
  () => {
    throw new Error("optional HNSW peer is unavailable");
  },
  { virtual: true },
);

import { ReflexMolecule } from "../../src/molecules/ReflexMolecule.js";

function createTempDbPath(): string {
  return join(tmpdir(), `reflex-hnsw-unavailable-${randomUUID()}.db`);
}

function createFakeEmbedding(seed: number): number[] {
  const embedding = new Array(384).fill(0) as number[];
  embedding[seed] = 1;
  return embedding;
}

function cleanupDb(dbPath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const path = dbPath + suffix;
    if (existsSync(path)) unlinkSync(path);
  }
}

describe("ReflexMolecule without optional HNSW", () => {
  let molecule: ReflexMolecule;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = createTempDbPath();
    molecule = new ReflexMolecule(dbPath);
    await molecule.initialize();
  });

  afterEach(async () => {
    await molecule.dispose();
    cleanupDb(dbPath);
  });

  it("keeps linear mode on the first save when hnswlib-node is unavailable", () => {
    const embedding = createFakeEmbedding(1);
    molecule.save(
      "reflex without optional hnswlib-node",
      [{ action: "linear_action" }],
      embedding,
    );

    const match = molecule.findSimilar(embedding);

    expect(molecule.getVectorIndexMode()).toBe("linear");
    expect(match?.record.taskSummary).toBe(
      "reflex without optional hnswlib-node",
    );
  });
});

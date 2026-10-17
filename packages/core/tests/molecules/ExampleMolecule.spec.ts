import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExampleMolecule } from "../../src/molecules/ExampleMolecule.js";

describe("ExampleMolecule", () => {
  let temporaryDatabaseDir: string;
  let molecule: ExampleMolecule | undefined;

  beforeEach(() => {
    temporaryDatabaseDir = mkdtempSync(
      join(tmpdir(), "biotemplate-example-molecule-"),
    );
    molecule = new ExampleMolecule(
      join(temporaryDatabaseDir, "example-records.db"),
    );
  });

  afterEach(async () => {
    await molecule?.dispose();
    molecule = undefined;
    rmSync(temporaryDatabaseDir, { recursive: true, force: true });
  });

  it("expone identidad estable y completa su lifecycle SQLite", async () => {
    expect(molecule).toBeDefined();
    if (!molecule) return;

    expect(molecule.name).toBe("example");
    expect(molecule.version).toBe("1.0.0");

    await molecule.initialize();
    const created = molecule.create(
      "fixture-record",
      { kind: "test" },
      "tenant-a",
    );

    expect(created).toMatchObject({
      tenantId: "tenant-a",
      name: "fixture-record",
      status: "active",
      data: { kind: "test" },
    });
    expect(molecule.getById(created.id, "tenant-a")).toEqual(created);
    expect(molecule.list("active", 10, "tenant-a")).toHaveLength(1);

    const updated = molecule.updateStatus(created.id, "pending", "tenant-a");
    expect(updated?.status).toBe("pending");
    expect(molecule.delete(created.id, "tenant-a")).toBe(true);
    expect(molecule.getById(created.id, "tenant-a")).toBeNull();
  });

  it("rechaza JSON inválido y estados que no cumplen el contrato", async () => {
    expect(molecule).toBeDefined();
    if (!molecule) return;

    await molecule.initialize();
    const created = molecule.create("corruptible-record", {}, "tenant-a");
    const database = new Database(
      join(temporaryDatabaseDir, "example-records.db"),
    );
    database
      .prepare("UPDATE domain_records SET data_json = ? WHERE id = ?")
      .run("{invalid-json", created.id);
    database.close();

    expect(() => molecule.getById(created.id, "tenant-a")).toThrow(
      "data_json no contiene JSON válido",
    );

    const validDatabase = new Database(
      join(temporaryDatabaseDir, "example-records.db"),
    );
    validDatabase
      .prepare(
        "UPDATE domain_records SET data_json = ?, status = ? WHERE id = ?",
      )
      .run("{}", "unknown", created.id);
    validDatabase.close();

    expect(() => molecule.getById(created.id, "tenant-a")).toThrow();
  });

  it("mantiene el aislamiento por tenant al listar", async () => {
    await molecule?.initialize();
    molecule?.create("tenant-a-record", {}, "tenant-a");
    molecule?.create("tenant-b-record", {}, "tenant-b");

    expect(molecule?.list(undefined, 50, "tenant-a")).toHaveLength(1);
    expect(molecule?.list(undefined, 50, "tenant-a")[0]?.tenantId).toBe(
      "tenant-a",
    );
  });
});

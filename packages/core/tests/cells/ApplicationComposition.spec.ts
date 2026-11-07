import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { CellServer } from "../../src/cells/CellServer.js";
import { createApplicationComposition } from "../../src/config/applicationComposition.js";
import { ExampleMolecule } from "../../src/molecules/ExampleMolecule.js";
import {
  DOMAIN_PROFILE_ID,
  domainProfile,
} from "../../src/config/domain-profile.js";
import {
  getAvailableProfiles,
  getDefaultProfile,
} from "../../src/config/profileRegistry.js";

const DomainRecordSchema = z.object({
  id: z.number(),
  tenantId: z.string(),
  name: z.string(),
  status: z.enum(["active", "inactive", "pending"]),
  data: z.record(z.unknown()),
  createdAt: z.number(),
  updatedAt: z.number(),
});

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

function readToolText(result: ToolResult): string {
  if (!("content" in result)) return "";
  const text = result.content.find((item) => item.type === "text");
  return text && text.type === "text" ? text.text : "";
}

function insertRawRecord(
  dbPath: string,
  status: string,
  dataJson: string,
): void {
  const database = new Database(dbPath);
  try {
    database
      .prepare(
        `INSERT INTO domain_records
          (tenant_id, name, status, data_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("fixture-tenant", "raw-record", status, dataJson, 1, 1);
  } finally {
    database.close();
  }
}

describe("createApplicationComposition", () => {
  let previousDatabaseDir: string | undefined;
  let temporaryDatabaseDir: string;
  let cell: CellServer | undefined;
  let exampleMolecule: ExampleMolecule | undefined;
  let clientTransport: InMemoryTransport | undefined;
  let serverTransport: InMemoryTransport | undefined;

  beforeEach(() => {
    previousDatabaseDir = process.env.DATABASE_DIR;
    temporaryDatabaseDir = mkdtempSync(
      join(tmpdir(), "biotemplate-application-composition-"),
    );
    process.env.DATABASE_DIR = temporaryDatabaseDir;
  });

  afterEach(async () => {
    await cell?.dispose();
    await exampleMolecule?.dispose();
    await cell?.server.close();
    await clientTransport?.close();
    await serverTransport?.close();

    if (previousDatabaseDir === undefined) {
      delete process.env.DATABASE_DIR;
    } else {
      process.env.DATABASE_DIR = previousDatabaseDir;
    }
    rmSync(temporaryDatabaseDir, { recursive: true, force: true });

    cell = undefined;
    exampleMolecule = undefined;
    clientTransport = undefined;
    serverTransport = undefined;
  });

  it("cumple el contrato de molécula e inicializa y libera su base de datos", async () => {
    const molecule = new ExampleMolecule(
      join(temporaryDatabaseDir, "example-molecule.db"),
    );
    exampleMolecule = molecule;

    expect(molecule.name).toBe("example");
    expect(molecule.version).toBe("1.0.0");

    await molecule.initialize();
    expect(molecule.create("lifecycle-record").name).toBe("lifecycle-record");

    await molecule.dispose();
    exampleMolecule = undefined;
  });

  it("rechaza JSON malformado persistido en un registro", async () => {
    const dbPath = join(temporaryDatabaseDir, "malformed-json.db");
    const molecule = new ExampleMolecule(dbPath);
    exampleMolecule = molecule;
    await molecule.initialize();
    insertRawRecord(dbPath, "active", "{malformed");

    expect(() => molecule.list(undefined, 50, "fixture-tenant")).toThrow(
      "data_json no contiene JSON válido",
    );
  });

  it("rechaza estados persistidos fuera del contrato del dominio", async () => {
    const dbPath = join(temporaryDatabaseDir, "invalid-status.db");
    const molecule = new ExampleMolecule(dbPath);
    exampleMolecule = molecule;
    await molecule.initialize();
    insertRawRecord(dbPath, "archived", "{}");

    expect(() => molecule.list(undefined, 50, "fixture-tenant")).toThrow();
  });
  it("alinea la cell example con sus tools y registra sus handlers", async () => {
    const composition = createApplicationComposition();
    const exampleEntry = composition.registry.cells.find(
      (entry) => entry.type === "example",
    );
    const exampleRegistration = composition.registrations?.find(
      (registration) => registration.type === "example",
    );

    expect(exampleEntry).toBeDefined();
    expect(exampleRegistration).toBeDefined();
    if (!exampleEntry || !exampleRegistration) return;

    expect(exampleRegistration.factory).toBeTypeOf("function");
    expect(exampleRegistration.registerTools).toBeTypeOf("function");
    expect(composition.allowedCells).toEqual(domainProfile.allowedCells);
    expect(getDefaultProfile()).toBe(DOMAIN_PROFILE_ID);
    expect(getAvailableProfiles()[DOMAIN_PROFILE_ID]).toEqual(domainProfile);
    expect(exampleEntry.tools).toEqual([
      "create_record",
      "get_record",
      "list_records",
      "update_record_status",
      "delete_record",
    ]);

    cell = new CellServer({
      composition,
      tenantId: "template-composition-test",
    });
    const client = new Client({
      name: "template-composition-test",
      version: "1.0.0",
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    clientTransport = clientSide;
    serverTransport = serverSide;
    await Promise.all([client.connect(clientSide), cell.run(serverSide)]);

    await client.callTool({
      name: "stimulate_differentiation",
      arguments: { type: "example" },
    });

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "stimulate_differentiation",
      "create_record",
      "get_record",
      "list_records",
      "update_record_status",
      "delete_record",
    ]);

    const createResult = await client.callTool({
      name: "create_record",
      arguments: {
        name: "fixture-record",
        data: { kind: "test" },
      },
    });
    const created = DomainRecordSchema.parse(
      JSON.parse(readToolText(createResult)) as unknown,
    );
    expect(created).toMatchObject({
      tenantId: "template-composition-test",
      name: "fixture-record",
      status: "active",
      data: { kind: "test" },
    });

    const getResult = await client.callTool({
      name: "get_record",
      arguments: { id: created.id },
    });
    expect(
      DomainRecordSchema.parse(JSON.parse(readToolText(getResult)) as unknown),
    ).toEqual(created);

    const listResult = await client.callTool({
      name: "list_records",
      arguments: { status: "active", limit: 10 },
    });
    const listed = z
      .array(DomainRecordSchema)
      .parse(JSON.parse(readToolText(listResult)) as unknown);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(created);

    const updateResult = await client.callTool({
      name: "update_record_status",
      arguments: { id: created.id, status: "pending" },
    });
    expect(
      DomainRecordSchema.parse(
        JSON.parse(readToolText(updateResult)) as unknown,
      ).status,
    ).toBe("pending");

    const invalidStatusResult = await client.callTool({
      name: "update_record_status",
      arguments: { id: created.id, status: "invalid" },
    });
    expect(invalidStatusResult.isError).toBe(true);

    const deleteResult = await client.callTool({
      name: "delete_record",
      arguments: { id: created.id },
    });
    expect(readToolText(deleteResult)).toBe("true");

    const missingResult = await client.callTool({
      name: "get_record",
      arguments: { id: created.id },
    });
    expect(readToolText(missingResult)).toBe("null");
  });
});

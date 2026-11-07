import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CellServer } from "../../src/cells/CellServer.js";
import type {
  CellComposition,
  CellRuntimeContext,
} from "../../src/cells/CellComposition.js";
import type { IMolecule } from "../../src/molecules/interfaces/IMolecule.js";
import { MoleculeError } from "../../src/errors.js";
import { z } from "zod";

class FixtureMolecule implements IMolecule {
  readonly name = "fixture";
  readonly version = "1.0.0";
  initializeCount = 0;
  disposeCount = 0;

  async initialize(): Promise<void> {
    this.initializeCount += 1;
  }

  async dispose(): Promise<void> {
    this.disposeCount += 1;
  }
}

class FailingMolecule extends FixtureMolecule {
  override async initialize(): Promise<void> {
    this.initializeCount += 1;
    throw new MoleculeError(this.name, "initialize falló");
  }
}

class RetryingDisposeMolecule extends FixtureMolecule {
  failuresRemaining = 1;

  override async dispose(): Promise<void> {
    this.disposeCount += 1;
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new MoleculeError(this.name, "dispose falló");
    }
  }
}

describe("CellServer - composición inyectable", () => {
  let previousDatabaseDir: string | undefined;
  let temporaryDatabaseDir: string;
  let cell: CellServer | undefined;
  let clientTransport: InMemoryTransport | undefined;
  let serverTransport: InMemoryTransport | undefined;

  beforeEach(() => {
    previousDatabaseDir = process.env.DATABASE_DIR;
    temporaryDatabaseDir = mkdtempSync(
      join(tmpdir(), "biocore-cell-composition-"),
    );
    process.env.DATABASE_DIR = temporaryDatabaseDir;
  });

  afterEach(async () => {
    await cell?.dispose();
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
    clientTransport = undefined;
    serverTransport = undefined;
  });

  it("inyecta el registry, registra la cell y alinea su tool con el handler", async () => {
    const fixture = new FixtureMolecule();
    let factoryContext: CellRuntimeContext | undefined;
    let registrarContext: CellRuntimeContext | undefined;
    const composition: CellComposition = {
      registry: {
        cells: [
          {
            type: "undifferentiated",
            description: "Estado inicial",
            tools: [],
          },
          {
            type: "example",
            description: "Cell de ejemplo",
            tools: ["example_tool"],
          },
        ],
      },
      registrations: [
        {
          type: "example",
          factory: (context) => {
            factoryContext = context;
            return [{ key: "fixture", molecule: fixture }];
          },
          registerTools: (server, context) => {
            registrarContext = context;
            server.registerTool(
              "example_tool",
              {
                description: "Tool de prueba de la cell de ejemplo",
                inputSchema: { value: z.string() },
              },
              async ({ value }) => ({
                content: [
                  {
                    type: "text",
                    text: `${context.tenantId}:${String(context.values["source"])}:${value}:${context.getResource<FixtureMolecule>("fixture")?.name}`,
                  },
                ],
              }),
            );
          },
        },
      ],
    };

    const exampleEntry = composition.registry.cells.find(
      (entry) => entry.type === "example",
    );
    expect(exampleEntry?.tools).toEqual(["example_tool"]);

    cell = new CellServer({
      composition,
      tenantId: "composition-test",
      context: { source: "fixture" },
      allowedCells: ["example"],
    });
    const client = new Client({
      name: "cell-composition-test",
      version: "1.0.0",
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    clientTransport = clientSide;
    serverTransport = serverSide;
    await Promise.all([client.connect(clientSide), cell.run(serverSide)]);

    const initialTools = await client.listTools();
    expect(initialTools.tools.map((tool) => tool.name)).toEqual([
      "stimulate_differentiation",
    ]);

    await client.callTool({
      name: "stimulate_differentiation",
      arguments: { type: "example" },
    });

    const activeTools = await client.listTools();
    expect(activeTools.tools.map((tool) => tool.name)).toContain(
      "example_tool",
    );
    expect(factoryContext?.tenantId).toBe("composition-test");
    expect(registrarContext?.values["source"]).toBe("fixture");
    expect(fixture.initializeCount).toBe(1);

    const result = await client.callTool({
      name: "example_tool",
      arguments: { value: "example-value" },
    });
    expect("content" in result).toBe(true);
    if (!("content" in result)) return;
    expect(result.content).toEqual([
      {
        type: "text",
        text: "composition-test:fixture:example-value:fixture",
      },
    ]);
  });

  it("reemplaza las tools al remutar y activa la herencia", async () => {
    const exampleFixture = new FixtureMolecule();
    const parentFixture = new FixtureMolecule();
    const otherFixture = new FixtureMolecule();
    const composition: CellComposition = {
      registry: {
        cells: [
          { type: "undifferentiated", description: "Inicial", tools: [] },
          { type: "example", description: "Ejemplo", tools: ["example_tool"] },
          { type: "base", description: "Base", tools: ["base_tool"] },
          {
            type: "other",
            description: "Otro",
            parent: "base",
            tools: ["other_tool"],
          },
        ],
      },
      registrations: [
        {
          type: "base",
          factory: () => [{ key: "base", molecule: parentFixture }],
          registerTools: (server) => {
            server.registerTool(
              "base_tool",
              { description: "Base", inputSchema: {} },
              async () => ({ content: [{ type: "text", text: "base" }] }),
            );
          },
        },
        {
          type: "example",
          factory: () => [{ key: "example", molecule: exampleFixture }],
          registerTools: (server) => {
            server.registerTool(
              "example_tool",
              { description: "Example", inputSchema: {} },
              async () => ({
                content: [{ type: "text", text: "example" }],
              }),
            );
          },
        },
        {
          type: "other",
          factory: () => [{ key: "other", molecule: otherFixture }],
          registerTools: (server) => {
            server.registerTool(
              "other_tool",
              { description: "Other", inputSchema: {} },
              async () => ({
                content: [{ type: "text", text: "other" }],
              }),
            );
          },
        },
      ],
    };

    cell = new CellServer({
      composition,
      tenantId: "remutation-test",
      allowedCells: ["example", "other"],
    });
    const client = new Client({ name: "remutation-test", version: "1.0.0" });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    clientTransport = clientSide;
    serverTransport = serverSide;
    await Promise.all([client.connect(clientSide), cell.run(serverSide)]);

    const stimulate = (type: string) =>
      client.callTool({
        name: "stimulate_differentiation",
        arguments: { type },
      });

    await stimulate("example");
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      "stimulate_differentiation",
      "example_tool",
    ]);

    await stimulate("other");
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      "stimulate_differentiation",
      "base_tool",
      "other_tool",
    ]);
    expect(exampleFixture.disposeCount).toBe(1);
    expect(parentFixture.disposeCount).toBe(0);

    await stimulate("example");
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      "stimulate_differentiation",
      "example_tool",
    ]);
    expect(parentFixture.disposeCount).toBe(1);
    expect(otherFixture.disposeCount).toBe(1);
  });

  it("libera recursos y tools cuando initialize falla", async () => {
    const fixture = new FailingMolecule();
    const composition: CellComposition = {
      registry: {
        cells: [
          { type: "undifferentiated", description: "Inicial", tools: [] },
          { type: "failing", description: "Falla", tools: [] },
        ],
      },
      registrations: [
        {
          type: "failing",
          factory: () => [{ key: "failing", molecule: fixture }],
          registerTools: () => undefined,
        },
      ],
    };

    cell = new CellServer({
      composition,
      tenantId: "initialize-failure-test",
      allowedCells: ["failing"],
    });
    const client = new Client({
      name: "initialize-failure-test",
      version: "1.0.0",
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    clientTransport = clientSide;
    serverTransport = serverSide;
    await Promise.all([client.connect(clientSide), cell.run(serverSide)]);

    const result = await client.callTool({
      name: "stimulate_differentiation",
      arguments: { type: "failing" },
    });
    expect(result.isError).toBe(true);
    expect(fixture.disposeCount).toBe(1);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      "stimulate_differentiation",
    ]);
  });

  it("retira las tools activas cuando factory falla", async () => {
    const composition: CellComposition = {
      registry: {
        cells: [
          { type: "undifferentiated", description: "Inicial", tools: [] },
          { type: "factory-failure", description: "Falla", tools: [] },
        ],
      },
      registrations: [
        {
          type: "factory-failure",
          factory: () => {
            throw new MoleculeError("factory", "factory falló");
          },
          registerTools: () => undefined,
        },
      ],
    };

    cell = new CellServer({
      composition,
      tenantId: "factory-failure-test",
      allowedCells: ["factory-failure"],
    });
    const client = new Client({
      name: "factory-failure-test",
      version: "1.0.0",
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    clientTransport = clientSide;
    serverTransport = serverSide;
    await Promise.all([client.connect(clientSide), cell.run(serverSide)]);

    const result = await client.callTool({
      name: "stimulate_differentiation",
      arguments: { type: "factory-failure" },
    });
    expect(result.isError).toBe(true);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      "stimulate_differentiation",
    ]);
  });

  it("revierte un recurso rastreado si la factory falla después de adquirirlo", async () => {
    const fixture = new FixtureMolecule();
    const resource = { key: "tracked", molecule: fixture };
    const composition: CellComposition = {
      registry: {
        cells: [
          { type: "undifferentiated", description: "Inicial", tools: [] },
          { type: "tracked-failure", description: "Falla", tools: [] },
        ],
      },
      registrations: [
        {
          type: "tracked-failure",
          factory: (context) => {
            context.trackResource(resource);
            throw new MoleculeError("factory", "falló después de adquirir");
          },
          registerTools: () => undefined,
        },
      ],
    };

    cell = new CellServer({
      composition,
      tenantId: "tracked-factory-failure-test",
      allowedCells: ["tracked-failure"],
    });
    const client = new Client({
      name: "tracked-factory-failure-test",
      version: "1.0.0",
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    clientTransport = clientSide;
    serverTransport = serverSide;
    await Promise.all([client.connect(clientSide), cell.run(serverSide)]);

    const result = await client.callTool({
      name: "stimulate_differentiation",
      arguments: { type: "tracked-failure" },
    });

    expect(result.isError).toBe(true);
    expect(fixture.initializeCount).toBe(0);
    expect(fixture.disposeCount).toBe(1);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      "stimulate_differentiation",
    ]);
  });
  it("rechaza recursos duplicados y libera los creados durante la mutación", async () => {
    const first = new FixtureMolecule();
    const second = new FixtureMolecule();
    const composition: CellComposition = {
      registry: {
        cells: [
          { type: "undifferentiated", description: "Inicial", tools: [] },
          { type: "duplicate", description: "Duplicada", tools: [] },
        ],
      },
      registrations: [
        {
          type: "duplicate",
          factory: () => [
            { key: "same", molecule: first },
            { key: "same", molecule: second },
          ],
          registerTools: () => undefined,
        },
      ],
    };

    cell = new CellServer({
      composition,
      tenantId: "duplicate-resource-test",
      allowedCells: ["duplicate"],
    });
    const client = new Client({
      name: "duplicate-resource-test",
      version: "1.0.0",
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    clientTransport = clientSide;
    serverTransport = serverSide;
    await Promise.all([client.connect(clientSide), cell.run(serverSide)]);

    const result = await client.callTool({
      name: "stimulate_differentiation",
      arguments: { type: "duplicate" },
    });
    expect(result.isError).toBe(true);
    expect(first.disposeCount).toBe(1);
    expect(second.disposeCount).toBe(1);
  });

  it("mantiene pendiente un dispose fallido y expone diagnóstico al reintentarlo", async () => {
    const fixture = new RetryingDisposeMolecule();
    const composition: CellComposition = {
      registry: {
        cells: [
          { type: "undifferentiated", description: "Inicial", tools: [] },
          { type: "retry-dispose", description: "Retry", tools: [] },
        ],
      },
      registrations: [
        {
          type: "retry-dispose",
          factory: () => [{ key: "retry", molecule: fixture }],
          registerTools: () => undefined,
        },
      ],
    };

    cell = new CellServer({
      composition,
      tenantId: "retry-dispose-test",
      allowedCells: ["retry-dispose"],
    });
    const client = new Client({ name: "retry-dispose-test", version: "1.0.0" });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    clientTransport = clientSide;
    serverTransport = serverSide;
    await Promise.all([client.connect(clientSide), cell.run(serverSide)]);
    await client.callTool({
      name: "stimulate_differentiation",
      arguments: { type: "retry-dispose" },
    });

    await expect(cell.dispose()).rejects.toMatchObject({
      message: "No se pudieron liberar todos los recursos de la célula.",
      context: { pendingCleanup: ["fixture: dispose falló"] },
    });
    expect(fixture.disposeCount).toBe(1);
    await expect(cell.dispose()).resolves.toBeUndefined();
    expect(fixture.disposeCount).toBe(2);
    await cell.dispose();
  });
  it("libera los recursos de la mutación y no los dispone dos veces", async () => {
    const fixture = new FixtureMolecule();
    const composition: CellComposition = {
      registry: {
        cells: [
          {
            type: "undifferentiated",
            description: "Estado inicial",
            tools: [],
          },
          { type: "example", description: "Cell de ejemplo", tools: [] },
        ],
      },
      registrations: [
        {
          type: "example",
          factory: () => [{ key: "fixture", molecule: fixture }],
          registerTools: () => undefined,
        },
      ],
    };

    cell = new CellServer({
      composition,
      tenantId: "dispose-test",
      allowedCells: ["example"],
    });
    const client = new Client({ name: "cell-dispose-test", version: "1.0.0" });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    clientTransport = clientSide;
    serverTransport = serverSide;
    await Promise.all([client.connect(clientSide), cell.run(serverSide)]);

    await client.callTool({
      name: "stimulate_differentiation",
      arguments: { type: "example" },
    });
    await cell.dispose();
    await cell.dispose();

    expect(fixture.disposeCount).toBe(1);
  });

  it("conserva el constructor legacy de allowedCells y tenantId", async () => {
    cell = new CellServer(["undifferentiated"], "legacy-test");

    expect(cell.currentType).toBe("undifferentiated");
    await cell.dispose();
  });
});

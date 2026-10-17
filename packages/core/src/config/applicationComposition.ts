import { createRequire } from "node:module";
import { z } from "zod";
import { mergeRegistry } from "./mergeRegistry.js";
import type { Registry } from "./mergeRegistry.js";
import { ToolExecutionError } from "../errors.js";
import { ExampleMolecule } from "../molecules/ExampleMolecule.js";
import { domainProfile } from "./domain-profile.js";
import type {
  CellComposition,
  CellRuntimeContext,
} from "../cells/CellComposition.js";

const require = createRequire(import.meta.url);
const coreRegistry = require("./registry.json") as Registry;
const domainRegistry = require("./domain-registry.json") as Registry;

const applicationRegistry = mergeRegistry(coreRegistry, domainRegistry);
const STATUS_SCHEMA = z.enum(["active", "inactive", "pending"]);

function getExampleMolecule(context: CellRuntimeContext): ExampleMolecule {
  const molecule = context.getResource<ExampleMolecule>("example");
  if (!molecule) {
    throw new ToolExecutionError(
      "example",
      "La molécula de ejemplo no está inicializada.",
    );
  }
  return molecule;
}

/**
 * Composition root del template.
 * El registry y los handlers de dominio se ensamblan aquí, fuera de @bio/core.
 */
export function createApplicationComposition(): CellComposition {
  return {
    registry: applicationRegistry,
    allowedCells: domainProfile.allowedCells,
    registrations: [
      {
        type: "example",
        factory: (context) => {
          const resource = {
            key: "example",
            molecule: new ExampleMolecule(context.tenantDbPath),
          };
          context.trackResource(resource);
          return [resource];
        },
        registerTools: (server, context) => {
          server.registerTool(
            "create_record",
            {
              description: "Crea un registro del dominio",
              inputSchema: {
                name: z.string().min(1),
                data: z.record(z.unknown()).optional(),
              },
            },
            async ({ name, data }) => ({
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    getExampleMolecule(context).create(
                      name,
                      data ?? {},
                      context.tenantId,
                    ),
                  ),
                },
              ],
            }),
          );

          server.registerTool(
            "get_record",
            {
              description: "Obtiene un registro del dominio por ID",
              inputSchema: {
                id: z.number().int().positive(),
              },
            },
            async ({ id }) => ({
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    getExampleMolecule(context).getById(id, context.tenantId),
                  ),
                },
              ],
            }),
          );

          server.registerTool(
            "list_records",
            {
              description: "Lista registros del dominio",
              inputSchema: {
                status: STATUS_SCHEMA.optional(),
                limit: z.number().int().positive().max(100).optional(),
              },
            },
            async ({ status, limit }) => ({
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    getExampleMolecule(context).list(
                      status,
                      limit,
                      context.tenantId,
                    ),
                  ),
                },
              ],
            }),
          );

          server.registerTool(
            "update_record_status",
            {
              description: "Actualiza el estado de un registro",
              inputSchema: {
                id: z.number().int().positive(),
                status: STATUS_SCHEMA,
              },
            },
            async ({ id, status }) => ({
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    getExampleMolecule(context).updateStatus(
                      id,
                      status,
                      context.tenantId,
                    ),
                  ),
                },
              ],
            }),
          );

          server.registerTool(
            "delete_record",
            {
              description: "Elimina un registro del dominio",
              inputSchema: {
                id: z.number().int().positive(),
              },
            },
            async ({ id }) => ({
              content: [
                {
                  type: "text",
                  text: String(
                    getExampleMolecule(context).delete(id, context.tenantId),
                  ),
                },
              ],
            }),
          );
        },
      },
    ],
  };
}

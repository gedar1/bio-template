import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IMolecule } from "../molecules/interfaces/IMolecule.js";
import type { Registry } from "../config/mergeRegistry.js";

/** Recursos creados por una cell durante una mutación.*/
export interface CellResource {
  readonly key: string;
  readonly molecule: IMolecule;
}

/** Contexto disponible para factories y registrars de una cell. */
export interface CellRuntimeContext {
  readonly tenantId: string;
  readonly tenantDbPath: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly resources: ReadonlyMap<string, IMolecule>;
  getResource<T extends IMolecule>(key: string): T | undefined;
  /** Registra un recurso inmediatamente para poder revertir una factory fallida. */
  trackResource(resource: CellResource): void;
}

/** Factory que crea los recursos de un tipo de cell. */
export type CellFactory = (
  context: CellRuntimeContext,
) => CellResource[] | Promise<CellResource[]>;

/** Registrar MCP que expone las tools de un tipo de cell.
 * El server conserva la API MCP existente y rastrea cada RegisteredTool para retirarla al mutar.
 */
export type CellToolRegistrar = (
  server: McpServer,
  context: CellRuntimeContext,
) => void | Promise<void>;

/** Extensión de composición para un tipo del registry. */
export interface CellRegistration {
  readonly type: string;
  readonly factory: CellFactory;
  readonly registerTools: CellToolRegistrar;
}

/** Registry y extensiones que una aplicación inyecta en CellServer. */
export interface CellComposition {
  readonly registry: Registry;
  /** Células permitidas por el perfil de la aplicación cuando no hay override de entorno. */
  readonly allowedCells?: readonly string[];
  readonly registrations?: readonly CellRegistration[];
}

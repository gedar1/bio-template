/**
 * ReflexOrchestrator — Orquestación de cadenas de ejecución refleja
 *
 * Responsabilidad: resolver orden de ejecución topológico, ejecutar nodos secuencialmente,
 * propagar outputs entre pasos, validar compatibilidad de tipos y registrar métricas
 * completas con Pino.
 *
 * No contiene lógica de negocio; actúa como intermediario entre células y moléculas.
 */

import { createLogger } from "../config/logger.js";
import type { ILogger } from "../config/ILogger.js";
import type { TenantDatabaseManager } from "../infrastructure/TenantDatabaseManager.js";
import type {
  ExecutionChainNode,
  ExecutionDependency,
} from "../server/types/semantic.js";
import { BioCoreError } from "../errors.js";

/**
 * Contexto de ejecución que se propaga durante la cadena de reflexes.
 * Incluye el estado compartido de outputs entre pasos.
 */
export interface ExecutionContext {
  readonly tenantId: string;
  readonly userMessage: string;
  readonly sessionId?: string;
}

/**
 * Resultado tipado de la ejecución de una cadena.
 */
export interface ExecutionResult {
  status: "success" | "failed";
  outputs: Map<number, unknown>; // nodeId → resultado del paso
  duration_ms: number;
  error?: Error;
}

/**
 * Contrato para orquestación de reflexes con validación topológica.
 */
export interface IReflexOrchestrator {
  readonly name: "reflex-orchestrator";

  /**
   * Resuelve el orden topológico de una cadena de reflexes basado en dependencias.
   * Valida ciclos y retorna la cadena ordenada.
   */
  resolveOrder(
    reflexes: ExecutionChainNode[],
    dependencies: Map<number, number[]>,
  ): Promise<ExecutionChainNode[]>;

  /**
   * Ejecuta una cadena de reflexes secuencialmente, propagando outputs.
   * Delega a Cortex si algún paso falla (fallback).
   */
  execute(
    chain: ExecutionChainNode[],
    context: ExecutionContext,
  ): Promise<ExecutionResult>;

  /**
   * Valida la cadena: sin ciclos, IDs válidos, dependencias correctas.
   */
  validate(chain: ExecutionChainNode[]): Promise<boolean>;
}

/**
 * Error específico de orquestación de reflexes.
 */
export class ReflexOrchestratorError extends BioCoreError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, "REFLEX_ORCHESTRATOR_ERROR", context);
    this.name = "ReflexOrchestratorError";
  }
}

/**
 * ReflexOrchestrator — Implementación de IReflexOrchestrator.
 *
 * Responsabilidades:
 * 1. Leer reflexes_atomic + reflex_dependencies de BD
 * 2. Construir grafo de dependencias (Map<source, [targets]>)
 * 3. Topological sort con Kahn's algorithm
 * 4. Ejecutar nodos secuencialmente, encadenando outputs
 * 5. Logging completo (INFO, DEBUG, WARN, ERROR)
 * 6. Validar sin ciclos, IDs válidos, referencias correctas
 */
export class ReflexOrchestrator implements IReflexOrchestrator {
  readonly name = "reflex-orchestrator";
  private readonly log: ILogger;
  private readonly tenantId: string;
  private readonly db: TenantDatabaseManager;

  constructor(log: ILogger, tenantId: string, db: TenantDatabaseManager) {
    this.log = log.child({ component: "ReflexOrchestrator" });
    this.tenantId = tenantId;
    this.db = db;

    this.log.info("ReflexOrchestrator initialized", { tenantId });
  }

  /**
   * Resuelve el orden topológico de una cadena de reflexes.
   * Lee BD, valida ciclos, retorna cadena ordenada por dependencias.
   */
  async resolveOrder(
    reflexes: ExecutionChainNode[],
    dependencies: Map<number, number[]>,
  ): Promise<ExecutionChainNode[]> {
    this.log.info("Resolving execution order", {
      reflexCount: reflexes.length,
      depCount: dependencies.size,
    });

    // Validar ciclos
    if (
      this.hasCycles(
        reflexes.map((r) => r.id),
        dependencies,
      )
    ) {
      this.log.warn(
        "Cycles detected in dependency graph, returning original order",
      );
      return reflexes;
    }

    // Topological sort
    const sortedIds = this.topologicalSort(
      reflexes.map((r) => r.id),
      dependencies,
    );

    this.log.debug("Topological sort completed", { sortedIds });

    // Mapear IDs de vuelta a nodos, actualizar execution_order
    const nodeLookup = new Map(reflexes.map((r) => [r.id, r]));
    const result = sortedIds
      .map((id) => {
        const node = nodeLookup.get(id);
        if (!node) return null;
        return { ...node };
      })
      .filter((n): n is ExecutionChainNode => n !== null)
      .map((n, i) => ({ ...n, execution_order: i + 1 }));

    this.log.info("Execution order resolved", { orderedCount: result.length });

    return result;
  }

  /**
   * Ejecuta una cadena de reflexes secuencialmente.
   * Propaga outputs del paso N al paso N+1 vía chainOutputTo.
   * Si falla → retorna status "failed", no escala (caller decide).
   */
  async execute(
    chain: ExecutionChainNode[],
    context: ExecutionContext,
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const outputs = new Map<number, unknown>();

    this.log.info("Execution started", {
      tenantId: context.tenantId,
      chainLength: chain.length,
      sessionId: context.sessionId,
    });

    try {
      // Ejecutar cada nodo en orden
      for (const node of chain) {
        this.log.debug("Executing step", {
          nodeId: node.id,
          order: node.execution_order,
        });

        try {
          // TODO: Implementar ejecución real
          // Por ahora, placeholder que simula ejecución exitosa
          const output = {
            nodeId: node.id,
            taskSummary: node.task_summary,
            placeholder: true,
          };

          outputs.set(node.id, output);

          this.log.info("Step completed", {
            nodeId: node.id,
            outputKeys: Object.keys(output),
          });
        } catch (stepError: any) {
          this.log.error("Step failed", {
            nodeId: node.id,
            error: stepError.message,
            order: node.execution_order,
          });

          return {
            status: "failed",
            outputs,
            duration_ms: Date.now() - startTime,
            error: stepError,
          };
        }
      }

      const duration = Date.now() - startTime;
      this.log.info("Execution completed successfully", {
        durationMs: duration,
        outputCount: outputs.size,
      });

      return {
        status: "success",
        outputs,
        duration_ms: duration,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.log.error("Orchestrator execution failed", {
        error: error.message,
        durationMs: duration,
        tenantId: context.tenantId,
      });

      return {
        status: "failed",
        outputs,
        duration_ms: duration,
        error,
      };
    }
  }

  /**
   * Valida una cadena de reflexes:
   * - Sin ciclos
   * - IDs válidos y únicos
   * - Referencias de depends_on correctas
   */
  async validate(chain: ExecutionChainNode[]): Promise<boolean> {
    this.log.debug("Validating chain", { chainLength: chain.length });

    if (chain.length === 0) {
      return true; // Cadena vacía es válida
    }

    // Validar IDs únicos
    const ids = new Set<number>();
    for (const node of chain) {
      if (ids.has(node.id)) {
        this.log.warn("Duplicate node ID in chain", { nodeId: node.id });
        return false;
      }
      ids.add(node.id);
    }

    // Validar depends_on referencias
    for (const node of chain) {
      if (node.depends_on !== null && node.depends_on !== undefined) {
        if (!ids.has(node.depends_on)) {
          this.log.warn("depends_on references non-existent node", {
            nodeId: node.id,
            dependsOn: node.depends_on,
          });
          return false;
        }
      }
    }

    // Validar sin ciclos
    const depMap = this.buildDependencyMap(chain);
    if (this.hasCycles(Array.from(ids), depMap)) {
      this.log.warn("Cyclic dependencies detected in chain");
      return false;
    }

    this.log.debug("Chain validation passed");
    return true;
  }

  /**
   * Topological sort usando Kahn's algorithm.
   * Retorna lista de IDs ordenados topológicamente.
   * Si hay ciclos, retorna orden original (fallback).
   */
  private topologicalSort(
    nodeIds: number[],
    depMap: Map<number, number[]>,
  ): number[] {
    this.log.debug("Starting topological sort", { nodeCount: nodeIds.length });

    // Construir in-degree para cada nodo
    const inDegree = new Map<number, number>();
    for (const id of nodeIds) {
      inDegree.set(id, 0);
    }

    // Contar in-degrees (cuántas aristas apuntan a cada nodo)
    for (const [, targets] of depMap) {
      for (const target of targets) {
        if (inDegree.has(target)) {
          inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
        }
      }
    }

    // Cola de nodos sin dependencias
    const queue: number[] = [];
    for (const id of nodeIds) {
      if ((inDegree.get(id) ?? 0) === 0) {
        queue.push(id);
      }
    }

    const sorted: number[] = [];

    // Procesar nodos
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      sorted.push(nodeId);

      this.log.debug("Processing node in topological sort", { nodeId });

      // Reducir in-degree de dependientes
      const targets = depMap.get(nodeId) ?? [];
      for (const target of targets) {
        inDegree.set(target, (inDegree.get(target) ?? 0) - 1);
        if (inDegree.get(target) === 0) {
          queue.push(target);
        }
      }
    }

    if (sorted.length !== nodeIds.length) {
      this.log.warn(
        "Topological sort detected cycles, not all nodes processed",
        {
          sortedCount: sorted.length,
          totalCount: nodeIds.length,
        },
      );
      return nodeIds; // Fallback: orden original
    }

    this.log.debug("Topological sort completed", { sortedIds: sorted });
    return sorted;
  }

  /**
   * Detecta ciclos en el grafo de dependencias usando DFS.
   */
  private hasCycles(nodeIds: number[], depMap: Map<number, number[]>): boolean {
    const visited = new Set<number>();
    const recursionStack = new Set<number>();

    const dfs = (nodeId: number): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);

      const targets = depMap.get(nodeId) ?? [];
      for (const target of targets) {
        if (!visited.has(target)) {
          if (dfs(target)) return true;
        } else if (recursionStack.has(target)) {
          this.log.warn("Cycle detected: node depends on itself or ancestor", {
            nodeId,
            target,
          });
          return true;
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of nodeIds) {
      if (!visited.has(nodeId)) {
        if (dfs(nodeId)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Construye mapa de dependencias a partir de ejecutionChainNode.
   * Map<sourceId, [targetIds]> basado en depends_on.
   */
  private buildDependencyMap(
    chain: ExecutionChainNode[],
  ): Map<number, number[]> {
    const depMap = new Map<number, number[]>();

    for (const node of chain) {
      if (!depMap.has(node.id)) {
        depMap.set(node.id, []);
      }

      if (node.depends_on !== null && node.depends_on !== undefined) {
        // depends_on apunta al antecesor, entonces:
        // source = depends_on, target = node.id
        const source = node.depends_on;
        if (!depMap.has(source)) {
          depMap.set(source, []);
        }
        const targets = depMap.get(source)!;
        if (!targets.includes(node.id)) {
          targets.push(node.id);
        }
      }
    }

    return depMap;
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export default ReflexOrchestrator;

/**
 * ExecutionChainRunner — Ejecutor de cadenas multi-paso detectadas por Jev
 *
 * Responsabilidad pura:
 * - Toma una cadena de herramientas (["scrape_url", "database_insert"])
 * - Ejecuta secuencialmente pasando output al siguiente paso
 * - Retorna resultado final + metadata de ejecución
 *
 * NO contiene:
 * - Instancias de moléculas (vienen inyectadas desde CellServer)
 * - Lógica de routing o tenant (responsabilidad de capas superiores)
 * - Persistencia de reflexes (responsabilidad de ReflexMolecule)
 *
 * PASO 8-9 Integration:
 * - PASO 8: Ejecución secuencial
 * - PASO 9: Persistencia a biocore.db (en CellServer.executeDetectedChain)
 */

export interface ExecutionContext {
  readonly chainId: string;
  readonly userMessage: string;
  readonly tenantId: string;
  steps: ExecutionStep[];
  currentStepIndex: number;
  intermediateOutputs: Record<string, unknown>;
}

export interface ExecutionStep {
  readonly toolName: string;
  readonly inputs: Record<string, unknown>;
  success: boolean;
  output?: unknown;
  error?: string;
  executionTimeMs: number;
}

export interface ChainExecutionResult {
  readonly chainId: string;
  success: boolean;
  readonly steps: ExecutionStep[];
  executionTimeMs: number;
  finalOutput?: unknown;
  error?: string;
}

/**
 * Interfaz inyectable para acceder a moléculas desde ExecutionChainRunner
 */
export interface MoleculeAccessor {
  callTool(toolName: string, inputs: Record<string, unknown>): Promise<unknown>;
}

/**
 * ExecutionChainRunner — Ejecuta cadenas de herramientas
 */
export class ExecutionChainRunner {
  private readonly moleculeAccessor: MoleculeAccessor;

  constructor(moleculeAccessor: MoleculeAccessor) {
    this.moleculeAccessor = moleculeAccessor;
  }

  /**
   * Ejecuta una cadena de herramientas secuencialmente
   * @param chain - Array de nombres de herramientas
   * @param context - Contexto con metadata de ejecución
   * @returns Resultado final con pasos ejecutados
   */
  async executeChain(
    chain: string[],
    context: ExecutionContext,
  ): Promise<ChainExecutionResult> {
    const startTime = Date.now();
    const result: ChainExecutionResult = {
      chainId: context.chainId,
      success: false,
      steps: [],
      executionTimeMs: 0,
    };

    for (let i = 0; i < chain.length; i++) {
      const toolName = chain[i];
      const stepStartTime = Date.now();

      const step: ExecutionStep = {
        toolName,
        inputs: this.buildStepInputs(toolName, context),
        success: false,
        executionTimeMs: 0,
      };

      try {
        // Ejecutar herramienta
        const output = await this.moleculeAccessor.callTool(
          toolName,
          step.inputs,
        );

        step.success = true;
        step.output = output;
        step.executionTimeMs = Date.now() - stepStartTime;

        // Guardar output para siguiente paso
        context.intermediateOutputs[toolName] = output;
        result.finalOutput = output;
      } catch (error: unknown) {
        step.success = false;
        step.error = error instanceof Error ? error.message : String(error);
        step.executionTimeMs = Date.now() - stepStartTime;
        result.error = step.error;
        break; // Detener si un paso falla
      }

      result.steps.push(step);
      context.currentStepIndex = i + 1;
    }

    result.success = result.steps.every((s) => s.success);
    result.executionTimeMs = Date.now() - startTime;

    return result;
  }

  /**
   * Construye inputs para el paso actual basado en el output anterior
   */
  private buildStepInputs(
    toolName: string,
    context: ExecutionContext,
  ): Record<string, unknown> {
    const inputs: Record<string, unknown> = {};

    // Herramientas de scraping: extraer URL del mensaje
    if (toolName === "scrape_url") {
      const urlMatch = context.userMessage.match(
        /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/,
      );
      inputs.url = urlMatch ? `https://${urlMatch[0]}` : "https://google.com";
    }

    // Herramientas de BD: usar output anterior si existe
    if (toolName === "database_insert" || toolName === "database_update") {
      const prevOutput = Object.values(context.intermediateOutputs).pop();
      inputs.data = prevOutput || { content: context.userMessage };
      inputs.table = "jev_chain_results";
    }

    if (toolName === "database_find" || toolName === "database_query") {
      inputs.table = "jev_chain_results";
      inputs.filter = {};
    }

    // Herramientas de filesystem: extraer path del mensaje
    if (toolName === "read_file" || toolName === "write_file") {
      const pathMatch = context.userMessage.match(/['"`]([^'"`]+\.\w+)/);
      inputs.path = pathMatch ? pathMatch[1] : "/tmp/jev_output.txt";
    }

    // Herramientas de git: usar rama actual
    if (toolName === "git_commit" || toolName === "git_push") {
      inputs.message = `PASO 8: Jev chain execution - ${context.chainId}`;
    }

    // Herramientas de email: extraer destinatario del mensaje
    if (toolName === "send_email") {
      const emailMatch = context.userMessage.match(
        /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/,
      );
      inputs.to = emailMatch ? emailMatch[0] : "noreply@biocore.dev";
      inputs.subject = `PASO 8: Chain ${context.chainId}`;
      inputs.body = JSON.stringify(context.intermediateOutputs, null, 2);
    }

    return inputs;
  }

  /**
   * Obtiene resultado formateado de la ejecución
   */
  getChainResult(result: ChainExecutionResult): ChainExecutionResult {
    return result;
  }
}

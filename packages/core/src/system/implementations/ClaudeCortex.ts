import Anthropic from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { BaseOrchestrator } from "../BaseOrchestrator.js";
import { createLogger } from "../../config/logger.js";
import { formatToolsForAnthropic } from "../../atoms/index.js";

dotenv.config();

const log = createLogger("ClaudeCortex");

/**
 * ClaudeCortex - Ejemplo de implementación de Cortex usando Anthropic.
 */
export class ClaudeCortex extends BaseOrchestrator {
  readonly anthropic: Anthropic;

  constructor() {
    super("ANTHROPIC-SESSION");
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY || "",
    });
  }

  private async getAnthropicTools(): Promise<Anthropic.Tool[]> {
    const unified = await this.getUnifiedTools();
    return formatToolsForAnthropic(unified) as Anthropic.Tool[];
  }

  public async chat(userMessage: string): Promise<void> {
    log.info({ message: userMessage }, "Mensaje recibido");
    this.history.create(this.sessionId, {
      role: "user",
      content: userMessage,
      timestamp: Date.now(),
    });

    try {
      let processing = true;
      while (processing) {
        const response = await this.anthropic.messages.create({
          model: "claude-3-5-sonnet-latest",
          max_tokens: 1024,
          messages: this.history.toMessages(this.sessionId).map((m) => ({
            role: m.role === "user" ? "user" : "assistant",
            content: m.content,
          })),
          tools: await this.getAnthropicTools(),
        });

        const textBlock = response.content.find(
          (c) => c.type === "text",
        ) as Anthropic.TextBlock;
        if (textBlock) {
          this.history.create(this.sessionId, {
            role: "assistant",
            content: textBlock.text,
            timestamp: Date.now(),
          });
          log.info(
            { response: textBlock.text.substring(0, 100) },
            "Respuesta de Claude",
          );
        }

        const toolCalls = response.content.filter(
          (c) => c.type === "tool_use",
        ) as Anthropic.ToolUseBlock[];
        if (toolCalls.length > 0) {
          const results: any[] = [];
          for (const call of toolCalls) {
            log.info({ tool: call.name }, "Ejecutando herramienta");
            const out = await this.executeAction(call.name, call.input);
            results.push({
              type: "tool_result",
              tool_use_id: call.id,
              content: out,
            });
          }
          this.history.create(this.sessionId, {
            role: "user",
            content: JSON.stringify(results),
            timestamp: Date.now(),
          });
        } else {
          processing = false;
        }
      }
    } catch (error: any) {
      log.error({ error: error.message }, "Error en ClaudeCortex");
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const orchestrator = new ClaudeCortex();
  await orchestrator.init();
  console.log("🧬 [CORTEX CLAUDE] BioCore Listo.");
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ask = () => {
    rl.question("👤 [TÚ]: ", async (input) => {
      if (input.toLowerCase() === "salir") return rl.close();
      await orchestrator.chat(input);
      ask();
    });
  };
  ask();
}

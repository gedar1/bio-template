import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/generative-ai";
import type { ChatSession } from "@google/generative-ai";
import * as dotenv from "dotenv";
import { BaseOrchestrator } from "../BaseOrchestrator.js";
import { createLogger } from "../../config/logger.js";
import { formatToolsForGemini } from "../../atoms/index.js";

// Forzar UTF-8 en la salida estándar (evita caracteres corruptos en Windows)
if (process.stdout.isTTY) process.stdout.setEncoding("utf8");
if (process.stderr.isTTY) process.stderr.setEncoding("utf8");

dotenv.config();

const log = createLogger("GeminiCortex");

/**
 * GeminiCortex - Implementación de Cortex usando Google Gemini.
 * Reinicia el chat automáticamente después de mutaciones para que
 * Gemini vea las herramientas nuevas.
 */
export class GeminiCortex extends BaseOrchestrator {
  readonly genAI: GoogleGenerativeAI;

  constructor() {
    super("GEMINI-SESSION");
    this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");
  }

  private async getGeminiTools() {
    const unified = await this.getUnifiedTools();
    return formatToolsForGemini(unified);
  }

  private getModelName(): string {
    return process.env.GEMINI_MODEL || "gemini-2.5-flash";
  }

  private async createChat(): Promise<{ chat: ChatSession }> {
    const modelName = this.getModelName();
    const model = this.genAI.getGenerativeModel({
      model: modelName,
      tools: (await this.getGeminiTools()) as any,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ],
    });

    const chat = model.startChat({
      history: (() => {
        const msgs = this.history
          .toMessages(this.sessionId)
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role: m.role === "user" ? "user" : "model",
            parts: [{ text: m.content }],
          }));
        // Gemini exige que el primer mensaje sea 'user'
        const firstUser = msgs.findIndex((m) => m.role === "user");
        return firstUser > 0 ? msgs.slice(firstUser) : msgs;
      })(),
    });

    return { chat };
  }

  public async chat(userMessage: string): Promise<void> {
    log.info({ message: userMessage }, "Mensaje recibido");

    // Guardar mensaje del usuario en historial
    this.history.create(this.sessionId, {
      role: "user",
      content: userMessage,
      timestamp: Date.now(),
    });

    try {
      let { chat } = await this.createChat();
      let result = await chat.sendMessage(userMessage);
      let calls = result.response.functionCalls();
      let iterations = 0;
      const MAX_ITERATIONS = 10;

      while (calls && calls.length > 0 && iterations < MAX_ITERATIONS) {
        iterations++;
        let mutated = false;

        // Ejecutar todas las tool calls
        const results: any[] = [];
        for (const call of calls) {
          log.info(
            { tool: call.name, iteration: iterations },
            "Ejecutando herramienta",
          );
          const out = await this.executeAction(call.name, call.args);
          results.push({
            functionResponse: { name: call.name, response: { content: out } },
          });

          if (call.name === "stimulate_differentiation") {
            mutated = true;
          }
        }

        if (mutated) {
          // Después de mutar, reiniciar chat con herramientas actualizadas
          log.info(
            "Mutación detectada, reiniciando chat con herramientas nuevas",
          );

          // Guardar contexto de lo que pasó
          const mutationSummary = results
            .map(
              (r) =>
                `${r.functionResponse.name}: ${r.functionResponse.response.content}`,
            )
            .join("\n");

          this.history.create(this.sessionId, {
            role: "assistant",
            content: `Ejecuté herramientas: ${mutationSummary}`,
            timestamp: Date.now(),
          });

          // Recrear chat con herramientas nuevas
          const refreshed = await this.createChat();
          chat = refreshed.chat;

          // Pedirle al modelo que continúe con las herramientas nuevas
          const toolNames = (await this.getUnifiedTools()).map((t) => t.name);
          result = await chat.sendMessage(
            `Acabo de mutar el sistema. Herramientas disponibles ahora: ${toolNames.join(", ")}. Continúa con la tarea original del usuario.`,
          );
          // Registrar este mensaje interno en el historial
          this.history.create(this.sessionId, {
            role: "user",
            content: `Sistema mutado. Herramientas: ${toolNames.join(", ")}. Continúa la tarea.`,
            timestamp: Date.now(),
          });
        } else {
          // Sin mutación, enviar resultados normalmente
          result = await chat.sendMessage(results);
        }

        calls = result.response.functionCalls();
      }

      if (iterations >= MAX_ITERATIONS) {
        log.warn({ iterations }, "Máximo de iteraciones alcanzado");
      }

      const final = result.response.text();
      if (final) {
        log.info({ response: final.substring(0, 200) }, "Respuesta de Gemini");
        this.history.create(this.sessionId, {
          role: "assistant",
          content: final,
          timestamp: Date.now(),
        });
      }
    } catch (error: any) {
      const is429 = error.message?.includes("429") || error.status === 429;
      if (is429) {
        const retryMatch = error.message?.match(/(\d+\.?\d*)s/);
        const retryIn = retryMatch
          ? `${Math.ceil(Number.parseFloat(retryMatch[1]))} segundos`
          : "unos minutos";
        const msg = `Gemini ha alcanzado el límite de la cuenta gratuita. Por favor espera ${retryIn} e intenta de nuevo, o activa billing en https://ai.dev/rate-limit`;
        log.warn({ retryIn }, "Gemini 429 - cuota agotada");
        this.history.create(this.sessionId, {
          role: "assistant",
          content: msg,
          timestamp: Date.now(),
        });
      } else {
        log.error({ error: error.message }, "Error en GeminiCortex");
      }
    }
  }

  /**
   * Streaming Gemini puro. La lógica reflex la maneja BaseOrchestrator.chatStream().
   * Tool calls se resuelven primero, la respuesta final se envía por chunks.
   */
  protected async *streamFromLLM(userMessage: string): AsyncGenerator<string> {
    log.info({ message: userMessage }, "Stream recibido");
    this.history.create(this.sessionId, {
      role: "user",
      content: userMessage,
      timestamp: Date.now(),
    });

    try {
      let { chat } = await this.createChat();

      // Fase 1: resolver tool calls sin streaming
      let result = await chat.sendMessage(userMessage);
      let calls = result.response.functionCalls();
      let iterations = 0;
      const MAX_ITERATIONS = 10;

      while (calls && calls.length > 0 && iterations < MAX_ITERATIONS) {
        iterations++;
        let mutated = false;
        const results: any[] = [];

        for (const call of calls) {
          log.info({ tool: call.name }, "Ejecutando herramienta (stream)");
          yield `[tool:${call.name}] `;
          const out = await this.executeAction(call.name, call.args);
          results.push({
            functionResponse: { name: call.name, response: { content: out } },
          });
          if (call.name === "stimulate_differentiation") mutated = true;
        }

        if (mutated) {
          const summary = results
            .map(
              (r) =>
                `${r.functionResponse.name}: ${r.functionResponse.response.content}`,
            )
            .join("\n");
          this.history.create(this.sessionId, {
            role: "assistant",
            content: summary,
            timestamp: Date.now(),
          });
          const refreshed = await this.createChat();
          chat = refreshed.chat;
          const toolNames = (await this.getUnifiedTools()).map((t) => t.name);
          const continueMsg = `Sistema mutado. Herramientas: ${toolNames.join(", ")}. Continúa la tarea original.`;
          this.history.create(this.sessionId, {
            role: "user",
            content: continueMsg,
            timestamp: Date.now(),
          });
          result = await chat.sendMessage(continueMsg);
        } else {
          result = await chat.sendMessage(results);
        }
        calls = result.response.functionCalls();
      }

      // Fase 2: stream la respuesta final por palabras
      const finalText = result.response.text();
      if (finalText) {
        this.history.create(this.sessionId, {
          role: "assistant",
          content: finalText,
          timestamp: Date.now(),
        });
        const words = finalText.split(" ");
        for (let i = 0; i < words.length; i++) {
          yield (i > 0 ? " " : "") + words[i];
        }
      }
    } catch (error: any) {
      const is429 = error.message?.includes("429") || error.status === 429;
      if (is429) {
        const retryMatch = error.message?.match(/(\d+\.?\d*)s/);
        const retryIn = retryMatch
          ? `${Math.ceil(Number.parseFloat(retryMatch[1]))} segundos`
          : "unos minutos";
        yield `\nGemini ha alcanzado el límite de la cuenta gratuita. Espera ${retryIn} e intenta de nuevo.`;
        log.warn({ retryIn }, "Gemini 429 - cuota agotada (stream)");
      } else {
        log.error({ error: error.message }, "Error en stream");
        yield `\n[Error: ${error.message}]`;
      }
    }
  }
}

import axios from "axios";
import type { AxiosResponse } from "axios";
import * as dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { BaseOrchestrator } from "../BaseOrchestrator.js";
import { createLogger } from "../../config/logger.js";
import { formatToolsForOpenAI } from "../../atoms/index.js";

// Forzar UTF-8 en la salida estándar (evita caracteres corruptos en Windows)
if (process.stdout.isTTY) process.stdout.setEncoding("utf8");
if (process.stderr.isTTY) process.stderr.setEncoding("utf8");

dotenv.config();

const log = createLogger("NvidiaCortex");

/** Configuración por defecto del modelo NVIDIA */
const DEFAULT_MODEL = "nvidia/llama-3.3-nemotron-super-49b-v1";
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_TOP_P = 0.7;

interface NvidiaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: NvidiaToolCall[];
  tool_call_id?: string;
}

interface NvidiaToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface NvidiaChoice {
  index: number;
  message: NvidiaMessage;
  finish_reason: string | null;
}

interface NvidiaChatResponse {
  id: string;
  choices: NvidiaChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * NvidiaCortex — Implementación de Cortex usando NVIDIA NIM API.
 * Compatible con formato OpenAI (chat/completions) con soporte de tool calling.
 * Soporta modelos como google/gemma-3n-e4b-it via NVIDIA Integrate.
 */
export class NvidiaCortex extends BaseOrchestrator {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor() {
    super("NVIDIA-SESSION");
    this.apiKey = process.env.NVIDIA_API_KEY || "";
    this.baseUrl =
      process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
    this.model = process.env.NVIDIA_MODEL || DEFAULT_MODEL;

    if (!this.apiKey) {
      log.warn("NVIDIA_API_KEY no configurada — las llamadas fallarán");
    }
  }

  private async getNvidiaTools(): Promise<any[]> {
    const unified = await this.getUnifiedTools();
    return formatToolsForOpenAI(unified);
  }

  private buildMessages(): NvidiaMessage[] {
    return this.history.toMessages(this.sessionId).map((m) => {
      let role: NvidiaMessage["role"] = "assistant";
      if (m.role === "user") role = "user";
      else if (m.role === "system") role = "system";

      return { role, content: m.content };
    });
  }

  private async callNvidia(
    messages: NvidiaMessage[],
    tools?: any[],
  ): Promise<NvidiaChatResponse> {
    const payload: Record<string, unknown> = {
      model: this.model,
      messages,
      max_tokens: DEFAULT_MAX_TOKENS,
      temperature: DEFAULT_TEMPERATURE,
      top_p: DEFAULT_TOP_P,
      frequency_penalty: 0,
      presence_penalty: 0,
      stream: false,
    };

    if (tools && tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = "auto";
    }

    const response: AxiosResponse<NvidiaChatResponse> = await axios.post(
      `${this.baseUrl}/chat/completions`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: 60_000,
      },
    );

    return response.data;
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
      let iterations = 0;
      const MAX_ITERATIONS = 10;

      while (processing && iterations < MAX_ITERATIONS) {
        iterations++;

        const messages = this.buildMessages();
        const tools = await this.getNvidiaTools();
        const data = await this.callNvidia(messages, tools);

        const choice = data.choices[0];
        if (!choice) {
          log.warn("NVIDIA devolvió respuesta sin choices");
          break;
        }

        const assistantMessage = choice.message;

        // Si hay contenido de texto, guardarlo
        if (assistantMessage.content) {
          this.history.create(this.sessionId, {
            role: "assistant",
            content: assistantMessage.content,
            timestamp: Date.now(),
          });
          log.info(
            { response: assistantMessage.content.substring(0, 100) },
            "Respuesta de NVIDIA",
          );
        }

        // Si hay tool calls, ejecutarlas
        const toolCalls = assistantMessage.tool_calls;
        if (toolCalls && toolCalls.length > 0) {
          // Guardar el mensaje del asistente con tool_calls en historial
          this.history.create(this.sessionId, {
            role: "assistant",
            content: JSON.stringify(
              toolCalls.map((tc) => ({
                id: tc.id,
                name: tc.function.name,
                arguments: tc.function.arguments,
              })),
            ),
            timestamp: Date.now(),
          });

          for (const toolCall of toolCalls) {
            const toolName = toolCall.function.name;
            let toolArgs: Record<string, unknown> = {};

            try {
              toolArgs = JSON.parse(toolCall.function.arguments);
            } catch {
              log.warn(
                { raw: toolCall.function.arguments },
                "Args inválidos de NVIDIA",
              );
            }

            log.info(
              { tool: toolName, iteration: iterations },
              "Ejecutando herramienta",
            );
            const output = await this.executeAction(toolName, toolArgs);

            // Guardar resultado como mensaje tool
            this.history.create(this.sessionId, {
              role: "user",
              content: JSON.stringify({
                type: "tool_result",
                tool_call_id: toolCall.id,
                name: toolName,
                content: output,
              }),
              timestamp: Date.now(),
            });
          }
        } else {
          // Sin tool calls → respuesta final
          processing = false;
        }
      }

      if (iterations >= MAX_ITERATIONS) {
        log.warn({ iterations }, "Máximo de iteraciones alcanzado");
      }
    } catch (error: any) {
      const status = error.response?.status;
      if (status === 429) {
        const msg =
          "NVIDIA API ha alcanzado el límite de rate. Intenta de nuevo en unos segundos.";
        log.warn("NVIDIA 429 - rate limit");
        this.history.create(this.sessionId, {
          role: "assistant",
          content: msg,
          timestamp: Date.now(),
        });
      } else if (status === 401 || status === 403) {
        log.error("NVIDIA API key inválida o sin permisos");
        this.history.create(this.sessionId, {
          role: "assistant",
          content:
            "Error de autenticación con NVIDIA API. Verifica tu NVIDIA_API_KEY.",
          timestamp: Date.now(),
        });
      } else {
        log.error({ error: error.message, status }, "Error en NvidiaCortex");
      }
    }
  }

  /**
   * Streaming desde NVIDIA NIM. Usa Server-Sent Events (SSE) compatible con OpenAI.
   * Tool calls se resuelven primero sin streaming, la respuesta final se envía por chunks.
   */
  protected async *streamFromLLM(userMessage: string): AsyncGenerator<string> {
    log.info({ message: userMessage }, "Stream recibido");
    this.history.create(this.sessionId, {
      role: "user",
      content: userMessage,
      timestamp: Date.now(),
    });

    try {
      // Fase 1: resolver tool calls sin streaming
      let iterations = 0;
      const MAX_ITERATIONS = 10;
      let hasToolCalls = true;

      while (hasToolCalls && iterations < MAX_ITERATIONS) {
        iterations++;
        const messages = this.buildMessages();
        const tools = await this.getNvidiaTools();
        const data = await this.callNvidia(messages, tools);

        const choice = data.choices[0];
        if (!choice) break;

        const toolCalls = choice.message.tool_calls;
        if (toolCalls && toolCalls.length > 0) {
          for (const toolCall of toolCalls) {
            const toolName = toolCall.function.name;
            let toolArgs: Record<string, unknown> = {};
            try {
              toolArgs = JSON.parse(toolCall.function.arguments);
            } catch {
              /* args inválidos */
            }

            log.info({ tool: toolName }, "Ejecutando herramienta (stream)");
            yield `[tool:${toolName}] `;
            const output = await this.executeAction(toolName, toolArgs);

            this.history.create(this.sessionId, {
              role: "user",
              content: JSON.stringify({
                type: "tool_result",
                tool_call_id: toolCall.id,
                name: toolName,
                content: output,
              }),
              timestamp: Date.now(),
            });
          }
        } else {
          hasToolCalls = false;

          // Fase 2: stream la respuesta final
          const finalText = choice.message.content;
          if (finalText) {
            this.history.create(this.sessionId, {
              role: "assistant",
              content: finalText,
              timestamp: Date.now(),
            });
            // Emitir por chunks SSE reales
            yield* this.streamResponse(messages);
          }
        }
      }
    } catch (error: any) {
      const status = error.response?.status;
      if (status === 429) {
        yield "\nNVIDIA API rate limit alcanzado. Intenta de nuevo en unos segundos.";
        log.warn("NVIDIA 429 (stream)");
      } else {
        log.error({ error: error.message }, "Error en stream NVIDIA");
        yield `\n[Error: ${error.message}]`;
      }
    }
  }

  /**
   * Realiza una llamada con stream: true y emite chunks SSE.
   */
  private async *streamResponse(
    messages: NvidiaMessage[],
  ): AsyncGenerator<string> {
    const payload = {
      model: this.model,
      messages,
      max_tokens: DEFAULT_MAX_TOKENS,
      temperature: DEFAULT_TEMPERATURE,
      top_p: DEFAULT_TOP_P,
      stream: true,
    };

    const response = await axios.post(
      `${this.baseUrl}/chat/completions`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        responseType: "stream",
        timeout: 60_000,
      },
    );

    let buffer = "";
    for await (const chunk of response.data) {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const jsonStr = trimmed.slice(6);
        if (jsonStr === "[DONE]") return;

        try {
          const parsed = JSON.parse(jsonStr);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // Chunk parcial, ignorar
        }
      }
    }
  }
}

// ─── CLI standalone ─────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cortex = new NvidiaCortex();
  cortex
    .init()
    .then(async () => {
      console.log("🧬 [CORTEX NVIDIA] BioCore Listo.");
      const readline = await import("node:readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const ask = () => {
        rl.question("👤 [TÚ]: ", async (input) => {
          if (input.toLowerCase() === "salir") return rl.close();
          await cortex.chat(input);
          ask();
        });
      };
      ask();
    })
    .catch(console.error);
}

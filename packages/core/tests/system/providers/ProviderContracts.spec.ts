import { describe, expect, it, vi } from "vitest";
import { resolveProviderApiKey } from "../../../src/config/llmConfig.js";
import { resolveInitialProvider } from "../../../src/config/llmTypes.js";
import { ValidationError } from "../../../src/errors.js";
import {
  AnthropicProvider,
  type AnthropicClient,
} from "../../../src/system/providers/AnthropicProvider.js";
import {
  GeminiProvider,
  type GeminiClient,
} from "../../../src/system/providers/GeminiProvider.js";
import {
  NvidiaProvider,
  type IHttpClient,
} from "../../../src/system/providers/NvidiaProvider.js";
import { normalizeLLMRequest } from "../../../src/system/providers/providerSchemas.js";
import type {
  LLMRequest,
  LLMStreamEvent,
  LLMTool,
} from "../../../src/system/providers/providerTypes.js";

const tool: LLMTool = {
  name: "lookup",
  description: "Busca un valor",
  inputSchema: {
    type: "object",
    properties: { key: { type: "string" } },
    required: ["key"],
  },
};
const request: LLMRequest = {
  messages: [{ role: "user", content: "hola" }],
  tools: [tool],
};

describe("provider contracts", () => {
  it("resolves canonical and legacy Gemini keys without exposing whitespace", () => {
    expect(
      resolveProviderApiKey("gemini", {
        GOOGLE_API_KEY: "  canonical  ",
        GOOGLE_AI_API_KEY: "legacy",
      }),
    ).toBe("canonical");
    expect(
      resolveProviderApiKey("gemini", {
        GOOGLE_API_KEY: "  ",
        GOOGLE_AI_API_KEY: " legacy ",
      }),
    ).toBe("legacy");
    expect(
      resolveProviderApiKey("gemini", { GOOGLE_API_KEY: "   " }),
    ).toBeUndefined();
    expect(resolveInitialProvider(undefined)).toBe("gemini");
    expect(resolveInitialProvider("unified")).toBe("gemini");
    expect(resolveInitialProvider("claude")).toBe("claude");
    expect(() => resolveInitialProvider("unknown")).toThrow(ValidationError);
  });

  it("normalizes defaults and preserves structured tool transcripts", () => {
    const normalized = normalizeLLMRequest({
      messages: [
        { role: "user", content: "usa lookup" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "call-1", name: "lookup", arguments: { key: "x" } },
          ],
        },
        {
          role: "tool",
          toolCallId: "call-1",
          name: "lookup",
          content: "ok",
          isError: false,
        },
      ],
      tools: [tool],
    });
    expect(normalized.maxTokens).toBe(1024);
    expect(normalized.messages[1].role).toBe("assistant");
    expect(() => normalizeLLMRequest({ ...request, maxTokens: 0 })).toThrow(
      ValidationError,
    );
    expect(() => normalizeLLMRequest({ ...request, temperature: 2.1 })).toThrow(
      ValidationError,
    );
  });

  it("maps Anthropic text and tool-use payloads with one completion", async () => {
    let payload: unknown;
    const client: AnthropicClient = {
      messages: {
        create: vi.fn(async (input: unknown) => {
          payload = input;
          return {
            content: [
              { type: "text", text: "ok" },
              {
                type: "tool_use",
                id: "a1",
                name: "lookup",
                input: { key: "x" },
              },
            ],
            usage: { input_tokens: 2, output_tokens: 3 },
            stop_reason: "tool_use",
          };
        }),
      },
    };
    const provider = new AnthropicProvider({
      env: { ANTHROPIC_API_KEY: "anthropic-key" },
      client,
      supportsStreaming: false,
    });
    const response = await provider.complete(request);
    expect(response.text).toBe("ok");
    expect(response.toolCalls[0]?.arguments).toEqual({ key: "x" });
    expect(response.usage.totalTokens).toBe(5);
    expect(payload).toMatchObject({
      max_tokens: 1024,
      tools: [{ name: "lookup" }],
    });
  });

  it("maps Gemini function calls and usage through the injected SDK", async () => {
    const sendMessage = vi.fn(async () => ({
      response: {
        candidates: [
          {
            content: {
              parts: [
                { text: "ok" },
                { functionCall: { name: "lookup", args: { key: "x" } } },
              ],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 },
      },
    }));
    const client: GeminiClient = {
      getGenerativeModel: vi.fn(() => ({
        startChat: vi.fn(() => ({ sendMessage })),
      })),
    };
    const provider = new GeminiProvider({
      env: { GOOGLE_API_KEY: "google-key" },
      client,
      supportsStreaming: false,
    });
    const response = await provider.complete(request);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(response.toolCalls[0]?.id).toMatch(/^gemini-/);
    expect(response.finishReason).toBe("stop");
  });

  it("accumulates Gemini usage across stream chunks", async () => {
    const chunks = [
      {
        candidates: [{ content: { parts: [{ text: "a" }] } }],
        usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3 },
      },
      {
        candidates: [
          {
            content: { parts: [{ text: "b" }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 5 },
      },
    ];
    const client: GeminiClient = {
      getGenerativeModel: vi.fn(() => ({
        startChat: vi.fn(() => ({
          sendMessageStream: vi.fn(async () => ({
            stream: (async function* () {
              for (const chunk of chunks) yield chunk;
            })(),
          })),
        })),
      })),
    };
    const provider = new GeminiProvider({
      env: { GOOGLE_API_KEY: "google-key" },
      client,
    });
    const events: LLMStreamEvent[] = [];
    for await (const event of provider.stream(request)) events.push(event);
    const completed = events.find((event) => event.type === "completed");
    expect(completed && completed.type === "completed").toBe(true);
    if (completed?.type === "completed") {
      expect(completed.response.usage).toEqual({
        inputTokens: 6,
        outputTokens: 8,
        totalTokens: 14,
      });
    }
  });

  it("classifies NVIDIA client errors and rejects empty SSE choices", async () => {
    const http: IHttpClient = {
      post: vi.fn(async () => ({
        status: 400,
        data: { error: "invalid request" },
      })),
    };
    const provider = new NvidiaProvider({
      env: { NVIDIA_API_KEY: "nvidia-key" },
      httpClient: http,
    });
    await expect(provider.complete(request)).rejects.toMatchObject({
      category: "malformed_response",
      status: 400,
    });

    const streamHttp: IHttpClient = {
      post: vi.fn(async () => ({
        status: 200,
        data: (async function* () {
          yield `data: ${JSON.stringify({ choices: [] })}\\n\\n`;
          yield "data: [DONE]\\n\\n";
        })(),
      })),
    };
    const streamProvider = new NvidiaProvider({
      env: { NVIDIA_API_KEY: "nvidia-key" },
      httpClient: streamHttp,
    });
    const consume = async () => {
      for await (const _event of streamProvider.stream(request)) {
        // consume until the malformed chunk is observed
      }
    };
    await expect(consume()).rejects.toMatchObject({
      category: "malformed_response",
    });
  });

  it("parses NVIDIA SSE with interleaved tool arguments and one completed event", async () => {
    const partialArguments = JSON.stringify({ key: "x" }).slice(0, -1);
    const chunks = [
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "n1", function: { name: "lookup", arguments: partialArguments } }] } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "}" } }] } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 3, completion_tokens: 4 } })}\n\n`,
      "data: [DONE]\n\n",
    ];
    const http: IHttpClient = {
      post: vi.fn(async () => ({
        status: 200,
        data: (async function* () {
          for (const chunk of chunks) yield chunk;
        })(),
      })),
    };
    const provider = new NvidiaProvider({
      env: { NVIDIA_API_KEY: "nvidia-key" },
      httpClient: http,
    });
    const events: LLMStreamEvent[] = [];
    for await (const event of provider.stream(request)) events.push(event);
    expect(events.filter((event) => event.type === "completed")).toHaveLength(
      1,
    );
    const completed = events.find((event) => event.type === "completed");
    expect(
      completed && completed.type === "completed"
        ? completed.response.toolCalls[0]?.arguments
        : undefined,
    ).toEqual({ key: "x" });
  });
});

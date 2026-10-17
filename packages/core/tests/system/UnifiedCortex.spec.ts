import { describe, expect, it, vi } from "vitest";
import { UnifiedCortex } from "../../src/system/implementations/UnifiedCortex.js";
import type { ILLMProvider } from "../../src/system/providers/ILLMProvider.js";
import type {
  LLMRequest,
  LLMResponse,
  LLMStreamEvent,
} from "../../src/system/providers/providerTypes.js";
import { ProviderError } from "../../src/errors.js";
import type { IReflexExecutor } from "../../src/system/strategies/IReflexExecutor.js";

function reflexExecutor(): IReflexExecutor {
  return {
    toolVersionMap: new Map(),
    initialize: async () => undefined,
    trackInput: () => undefined,
    recordStep: () => undefined,
    queryReflex: async () => null,
    saveReflex: async () => undefined,
    executeReflex: async () => [],
    buildToolVersionMap: () => undefined,
    getSchemaVersions: () => ({}),
    checkSchemaVersions: () => ({ compatible: true, mismatches: [] }),
  };
}

function response(
  text: string,
  toolCalls: LLMResponse["toolCalls"] = [],
): LLMResponse {
  return {
    text,
    toolCalls,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: toolCalls.length ? "tool_use" : "stop",
  };
}

class MockProvider implements ILLMProvider {
  readonly name = "gemini" as const;
  readonly model = "mock";
  readonly requests: LLMRequest[] = [];
  completeCalls = 0;
  streamCalls = 0;

  async complete(request: LLMRequest): Promise<LLMResponse> {
    this.requests.push(request);
    this.completeCalls += 1;
    if (this.completeCalls === 1) {
      return response("", [{ id: "call-1", name: "do", arguments: {} }]);
    }
    return response("final");
  }

  async *stream(_request: LLMRequest): AsyncGenerator<LLMStreamEvent> {
    this.streamCalls += 1;
    yield { type: "text_delta", text: "streamed" };
    yield { type: "completed", response: response("streamed") };
  }
}

class FailingProvider implements ILLMProvider {
  readonly name = "gemini" as const;
  readonly model = "mock";
  async complete(): Promise<LLMResponse> {
    throw new ProviderError("gemini", "timeout", "transport timeout", {
      retryable: true,
    });
  }
  async *stream(): AsyncGenerator<LLMStreamEvent> {
    throw new ProviderError("gemini", "timeout", "transport timeout", {
      retryable: true,
    });
  }
}

class FallbackProvider implements ILLMProvider {
  readonly name = "claude" as const;
  readonly model = "mock";
  async complete(): Promise<LLMResponse> {
    return response("fallback");
  }
  async *stream(): AsyncGenerator<LLMStreamEvent> {
    yield { type: "completed", response: response("fallback") };
  }
}

describe("UnifiedCortex coordination", () => {
  it("records structured assistant/tool messages and continues with the same provider", async () => {
    const provider = new MockProvider();
    const cortex = new UnifiedCortex({
      primaryProvider: "gemini",
      providers: new Map([["gemini", provider]]),
      singleProvider: true,
      reflexExecutor: reflexExecutor(),
    });
    vi.spyOn(cortex, "executeAction").mockResolvedValue("ok");

    await cortex.chat("ejecuta");

    expect(provider.completeCalls).toBe(2);
    expect(
      provider.requests[1].messages.map((message) => message.role),
    ).toEqual(["system", "user", "assistant", "tool"]);
    expect(provider.requests[1].messages[3]).toMatchObject({
      role: "tool",
      toolCallId: "call-1",
      content: "ok",
      isError: false,
    });
    expect(cortex.getHistory().at(-1)?.content).toBe("final");
  });

  it("consumes a stream once and publishes only final text", async () => {
    const provider = new MockProvider();
    const cortex = new UnifiedCortex({
      primaryProvider: "gemini",
      providers: new Map([["gemini", provider]]),
      singleProvider: true,
      reflexExecutor: reflexExecutor(),
    });

    const chunks: string[] = [];
    for await (const chunk of cortex.chatStream("hola")) chunks.push(chunk);

    expect(provider.streamCalls).toBe(1);
    expect(chunks).toEqual(["streamed"]);
  });

  it("evaluates reflex input once for a streamed conversation", async () => {
    const executor = reflexExecutor();
    const trackInput = vi.spyOn(executor, "trackInput");
    const queryReflex = vi.spyOn(executor, "queryReflex");
    const provider = new MockProvider();
    const cortex = new UnifiedCortex({
      primaryProvider: "gemini",
      providers: new Map([["gemini", provider]]),
      singleProvider: true,
      reflexExecutor: executor,
    });

    for await (const _chunk of cortex.chatStream("hola")) {
      // consume the complete stream
    }

    expect(trackInput).toHaveBeenCalledOnce();
    expect(queryReflex).toHaveBeenCalledOnce();
  });

  it("merges hot-reload updates queued during an active session", async () => {
    let release: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider: ILLMProvider = {
      name: "gemini",
      model: "mock",
      complete: async () => {
        await blocked;
        return response("done");
      },
      async *stream() {
        yield { type: "completed", response: response("done") };
      },
    };
    const cortex = new UnifiedCortex({
      primaryProvider: "gemini",
      fallbackOrder: ["claude", "nvidia"],
      providers: new Map([["gemini", provider]]),
      reflexExecutor: reflexExecutor(),
    });
    const task = cortex.chat("reload");
    await vi.waitFor(() => expect(cortex.isSessionActive()).toBe(true));
    cortex.reconfigure({ primaryProvider: "claude" });
    cortex.reconfigure({ fallbackOrder: ["nvidia"] });
    release();
    await task;

    expect(cortex.getProviderConfig()).toEqual({
      primaryProvider: "claude",
      fallbackOrder: ["nvidia"],
    });
  });

  it("falls back before effects and keeps the attempt list for total failure", async () => {
    const cortex = new UnifiedCortex({
      primaryProvider: "gemini",
      fallbackOrder: ["claude"],
      providers: new Map([
        ["gemini", new FailingProvider()],
        ["claude", new FallbackProvider()],
      ]),
      reflexExecutor: reflexExecutor(),
    });

    await cortex.chat("fallback");
    expect(cortex.getHistory().at(-1)?.content).toBe("fallback");
    expect(cortex.geminiBreaker.getFailureCount()).toBe(1);
  });
});

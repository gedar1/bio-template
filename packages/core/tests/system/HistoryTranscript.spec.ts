import { describe, expect, it, vi } from "vitest";
import {
  DefaultHistoryManager,
  LegacyHistoryManagerAdapter,
} from "../../src/system/strategies/DefaultHistoryManager.js";
import { HistoryMolecule } from "../../src/molecules/HistoryMolecule.js";

const entry = (role: "user" | "assistant", content: string) => ({
  role,
  content,
  timestamp: Date.now(),
});

describe("DefaultHistoryManager transcript", () => {
  it("keeps assistant tool calls and results in structured order", async () => {
    const manager = new DefaultHistoryManager();
    manager.createSession("s", "system");
    manager.addMessage("s", entry("user", "hazlo"));
    manager.addStructuredMessage("s", {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "call-1", name: "do", arguments: {} }],
    });
    manager.addStructuredMessage("s", {
      role: "tool",
      toolCallId: "call-1",
      name: "do",
      content: "resultado",
      isError: false,
    });
    manager.addStructuredMessage("s", {
      role: "assistant",
      content: "terminado",
      toolCalls: [],
    });

    expect(
      manager.structured.snapshot("s").map((message) => message.role),
    ).toEqual(["system", "user", "assistant", "tool", "assistant"]);
    expect(manager.getHistory("s").at(-1)?.content).toBe("terminado");
  });

  it("compresses complete groups and degrades when the summarizer fails", async () => {
    const manager = new DefaultHistoryManager();
    manager.createSession("s", "system");
    for (let index = 0; index < 21; index += 1) {
      manager.addMessage("s", entry("user", `u-${index}`));
      manager.addStructuredMessage("s", {
        role: "assistant",
        content: `a-${index}`,
        toolCalls: [],
      });
    }
    manager.setSummarizer(
      vi.fn(async () => {
        throw new Error("summarizer unavailable");
      }),
    );

    await expect(manager.compress("s")).resolves.toBe(true);
    const messages = manager.structured.snapshot("s");
    expect(messages.filter((message) => message.role === "system").length).toBe(
      2,
    );
    expect(messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "a-20",
    });
  });

  it("keeps a structured transcript when adapting a legacy history manager", () => {
    const molecule = new HistoryMolecule();
    const legacy = new LegacyHistoryManagerAdapter({
      createSession: (sessionId, systemMessage) => {
        molecule.create(sessionId, {
          role: "system",
          content: systemMessage,
          timestamp: Date.now(),
        });
      },
      getHistory: (sessionId) => molecule.toMessages(sessionId),
      addMessage: (sessionId, historyEntry) => {
        molecule.create(sessionId, historyEntry);
      },
      setSummarizer: () => undefined,
      compress: async () => false,
      size: (sessionId) => molecule.size(sessionId),
    });

    legacy.createSession("legacy", "system");
    legacy.addMessage("legacy", entry("user", "ejecuta"));
    legacy.addStructuredMessage("legacy", {
      role: "assistant",
      content: null,
      toolCalls: [{ id: "call-1", name: "do", arguments: { value: 1 } }],
    });
    legacy.addStructuredMessage("legacy", {
      role: "tool",
      toolCallId: "call-1",
      name: "do",
      content: "ok",
      isError: false,
    });

    expect(legacy.structured.snapshot("legacy")).toMatchObject([
      { role: "system" },
      { role: "user", content: "ejecuta" },
      {
        role: "assistant",
        toolCalls: [{ id: "call-1", name: "do", arguments: { value: 1 } }],
      },
      { role: "tool", toolCallId: "call-1", name: "do" },
    ]);
  });
});

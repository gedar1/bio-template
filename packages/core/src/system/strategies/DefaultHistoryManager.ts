import { HistoryMolecule } from "../../molecules/HistoryMolecule.js";
import { createLogger } from "../../config/logger.js";
import type { ILogger } from "../../config/ILogger.js";
import type { HistoryEntry } from "../../molecules/HistoryMolecule.js";
import type { IHistoryManager } from "./IHistoryManager.js";
import type { IStructuredConversation } from "./IStructuredConversation.js";
import type { LLMMessage } from "../providers/providerTypes.js";

const MAX_PROJECTION_LENGTH = 500;
const MAX_HISTORY_UNITS = 20;
const KEEP_LAST_UNITS = 10;

type SessionMessages = Map<string, LLMMessage[]>;

function projectionFor(message: LLMMessage): HistoryEntry {
  const content =
    message.role === "tool"
      ? `[tool:${message.name}${message.isError ? ":error" : ""}] ${message.content}`
      : message.role === "assistant" && message.toolCalls.length > 0
        ? `${message.content ?? ""}${message.content ? " " : ""}[tool_calls:${message.toolCalls.map((call) => call.name).join(",")}]`
        : message.content;
  return {
    role: message.role === "tool" ? "assistant" : message.role,
    content: (content ?? "").slice(0, MAX_PROJECTION_LENGTH),
    timestamp: Date.now(),
  };
}

function cloneMessages(messages: readonly LLMMessage[]): LLMMessage[] {
  return messages.map((message) => {
    if (message.role === "assistant") {
      return {
        role: "assistant",
        content: message.content,
        toolCalls: message.toolCalls.map((call) => ({
          id: call.id,
          name: call.name,
          arguments: { ...call.arguments },
        })),
      };
    }
    if (message.role === "tool") return { ...message };
    return { ...message };
  });
}

function entryToMessage(entry: HistoryEntry): LLMMessage {
  if (entry.role === "assistant") {
    return { role: "assistant", content: entry.content, toolCalls: [] };
  }
  return { role: entry.role, content: entry.content };
}

function groupedMessages(messages: readonly LLMMessage[]): LLMMessage[][] {
  const groups: LLMMessage[][] = [];
  let index = 0;
  while (index < messages.length) {
    const message = messages[index];
    if (message.role !== "user") {
      groups.push([message]);
      index += 1;
      continue;
    }

    const group: LLMMessage[] = [message];
    index += 1;
    const assistant = messages[index];
    if (assistant?.role === "assistant") {
      group.push(assistant);
      index += 1;
      if (assistant.toolCalls.length > 0) {
        const ids = new Set(assistant.toolCalls.map((call) => call.id));
        while (index < messages.length) {
          const candidate = messages[index];
          if (candidate.role !== "tool") break;
          if (!ids.has(candidate.toolCallId)) break;
          group.push(candidate);
          ids.delete(candidate.toolCallId);
          index += 1;
        }
        const finalAssistant = messages[index];
        if (ids.size === 0 && finalAssistant?.role === "assistant") {
          group.push(finalAssistant);
          index += 1;
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

function isCompleteGroup(group: readonly LLMMessage[]): boolean {
  const assistant = group.find((message) => message.role === "assistant");
  if (!assistant || assistant.role !== "assistant") return true;
  if (assistant.toolCalls.length === 0) return true;
  const results = new Set(
    group
      .filter(
        (message): message is Extract<LLMMessage, { role: "tool" }> =>
          message.role === "tool",
      )
      .map((message) => message.toolCallId),
  );
  return assistant.toolCalls.every((call) => results.has(call.id));
}

function summaryMessage(content: string): LLMMessage {
  return { role: "system", content: `[Contexto comprimido] ${content}` };
}

class StructuredConversation implements IStructuredConversation {
  private readonly sessions: SessionMessages = new Map();
  private readonly project: (
    sessionId: string,
    messages: readonly LLMMessage[],
    projections: readonly HistoryEntry[],
  ) => void;
  private readonly projections: Map<string, HistoryEntry[]> = new Map();

  constructor(
    project: (
      sessionId: string,
      messages: readonly LLMMessage[],
      projections: readonly HistoryEntry[],
    ) => void,
  ) {
    this.project = project;
  }

  append(
    sessionId: string,
    message: LLMMessage,
    projection?: HistoryEntry,
  ): void {
    const messages = this.sessions.get(sessionId) ?? [];
    messages.push(message);
    this.sessions.set(sessionId, messages);
    const entries = this.projections.get(sessionId) ?? [];
    entries.push(projection ?? projectionFor(message));
    this.projections.set(sessionId, entries);
    this.project(sessionId, messages, entries);
  }

  snapshot(sessionId: string): readonly LLMMessage[] {
    return cloneMessages(this.sessions.get(sessionId) ?? []);
  }

  replace(
    sessionId: string,
    messages: readonly LLMMessage[],
    projections: readonly HistoryEntry[] = messages.map(projectionFor),
  ): void {
    this.sessions.set(sessionId, cloneMessages(messages));
    this.projections.set(sessionId, [...projections]);
    this.project(sessionId, messages, projections);
  }

  async compress(
    sessionId: string,
    summarize?: (messages: readonly LLMMessage[]) => Promise<string>,
  ): Promise<boolean> {
    const current = this.sessions.get(sessionId);
    if (!current) return false;
    const systems = current.filter((message) => message.role === "system");
    const nonSystems = current.filter((message) => message.role !== "system");
    const groups = groupedMessages(nonSystems);
    if (groups.length <= MAX_HISTORY_UNITS) return false;

    const oldGroups = groups.slice(
      0,
      Math.max(0, groups.length - KEEP_LAST_UNITS),
    );
    const recentGroups = groups.slice(-KEEP_LAST_UNITS);
    const compressibleOldGroups = oldGroups.filter(isCompleteGroup);
    const retainedIncompleteGroups = oldGroups.filter(
      (group) => !isCompleteGroup(group),
    );
    if (compressibleOldGroups.length === 0) return false;

    let summary: string;
    if (summarize) {
      summary = await summarize(compressibleOldGroups.flat());
    } else {
      summary = compressibleOldGroups
        .flat()
        .map((message) => `${message.role}: ${projectionFor(message).content}`)
        .join("\n")
        .slice(0, MAX_PROJECTION_LENGTH * 4);
    }
    const next = [
      ...systems,
      summaryMessage(summary),
      ...retainedIncompleteGroups.flat(),
      ...recentGroups.flat(),
    ];
    this.sessions.set(sessionId, next);
    const nextEntries = next.map(projectionFor);
    this.projections.set(sessionId, nextEntries);
    this.project(sessionId, next, nextEntries);
    return true;
  }
}

export class DefaultHistoryManager implements IHistoryManager {
  private readonly history: HistoryMolecule;
  private readonly log: ILogger;
  private summarizer?: (messages: readonly LLMMessage[]) => Promise<string>;
  readonly structured: IStructuredConversation;

  constructor(history?: HistoryMolecule, logger?: ILogger) {
    this.history = history ?? new HistoryMolecule();
    this.log = logger ?? createLogger("HistoryManager");
    this.structured = new StructuredConversation(
      (sessionId, _messages, projections) => {
        this.history.update(sessionId, [...projections]);
      },
    );
  }

  get molecule(): HistoryMolecule {
    return this.history;
  }

  createSession(sessionId: string, systemMessage: string): void {
    this.structured.append(sessionId, {
      role: "system",
      content: systemMessage,
    });
  }

  getHistory(sessionId: string): Array<{ role: string; content: string }> {
    return this.history.toMessages(sessionId);
  }

  addMessage(sessionId: string, entry: HistoryEntry): void {
    this.structured.append(sessionId, entryToMessage(entry), entry);
  }

  addStructuredMessage(
    sessionId: string,
    message: LLMMessage,
    projection?: HistoryEntry,
  ): void {
    this.structured.append(sessionId, message, projection);
  }

  setSummarizer(
    fn: (messages: readonly LLMMessage[]) => Promise<string>,
  ): void {
    this.summarizer = fn;
  }

  async compress(sessionId: string): Promise<boolean> {
    if (!this.summarizer) return this.structured.compress(sessionId);
    try {
      return await this.structured.compress(sessionId, this.summarizer);
    } catch (error: unknown) {
      this.log.warn("Summarizer falló; se usa compresión estructurada", {
        error: error instanceof Error ? error.message : "unknown",
      });
      return this.structured.compress(sessionId);
    }
  }

  size(sessionId: string): number {
    return this.history.size(sessionId);
  }
}

export class LegacyHistoryManagerAdapter implements IHistoryManager {
  private readonly transcript: StructuredConversation;
  readonly structured: IStructuredConversation;
  private readonly legacy: {
    createSession(sessionId: string, systemMessage: string): void;
    getHistory(sessionId: string): Array<{ role: string; content: string }>;
    addMessage(sessionId: string, entry: HistoryEntry): void;
    setSummarizer(fn: (messages: HistoryEntry[]) => Promise<string>): void;
    compress(sessionId: string): Promise<boolean>;
    size(sessionId: string): number;
  };

  constructor(legacy: LegacyHistoryManagerAdapter["legacy"]) {
    this.legacy = legacy;
    this.transcript = new StructuredConversation(() => undefined);
    this.structured = this.transcript;
  }

  createSession(sessionId: string, systemMessage: string): void {
    this.legacy.createSession(sessionId, systemMessage);
    this.transcript.append(sessionId, {
      role: "system",
      content: systemMessage,
    });
  }
  getHistory(sessionId: string): Array<{ role: string; content: string }> {
    return this.legacy.getHistory(sessionId);
  }
  addMessage(sessionId: string, entry: HistoryEntry): void {
    this.transcript.append(sessionId, entryToMessage(entry), entry);
    this.legacy.addMessage(sessionId, entry);
  }
  addStructuredMessage(
    sessionId: string,
    message: LLMMessage,
    projection?: HistoryEntry,
  ): void {
    const entry = projection ?? projectionFor(message);
    this.transcript.append(sessionId, message, entry);
    this.legacy.addMessage(sessionId, entry);
  }
  setSummarizer(
    fn: (messages: readonly LLMMessage[]) => Promise<string>,
  ): void {
    this.legacy.setSummarizer((messages) =>
      fn(
        messages.map((message) =>
          entryToMessage({
            role: message.role as "system" | "user" | "assistant",
            content: message.content,
            timestamp: Date.now(),
          }),
        ),
      ),
    );
  }
  async compress(sessionId: string): Promise<boolean> {
    const hasToolTranscript = this.transcript
      .snapshot(sessionId)
      .some(
        (message) =>
          message.role === "tool" ||
          (message.role === "assistant" && message.toolCalls.length > 0),
      );
    if (hasToolTranscript) return false;

    const compressed = await this.legacy.compress(sessionId);
    if (compressed) {
      const entries = this.legacy.getHistory(sessionId);
      const messages = entries.map((entry) =>
        entryToMessage({
          role: entry.role as "system" | "user" | "assistant",
          content: entry.content,
          timestamp: Date.now(),
        }),
      );
      this.transcript.replace(sessionId, messages, entries as HistoryEntry[]);
    }
    return compressed;
  }
  size(sessionId: string): number {
    return this.legacy.size(sessionId);
  }
}

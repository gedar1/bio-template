import type { HistoryEntry } from "../../molecules/HistoryMolecule.js";
import type { IStructuredConversation } from "./IStructuredConversation.js";
import type { LLMMessage } from "../providers/providerTypes.js";

export interface IHistoryManager {
  readonly structured: IStructuredConversation;
  createSession(sessionId: string, systemMessage: string): void;
  getHistory(sessionId: string): Array<{ role: string; content: string }>;
  addMessage(sessionId: string, entry: HistoryEntry): void;
  addStructuredMessage(
    sessionId: string,
    message: LLMMessage,
    projection?: HistoryEntry,
  ): void;
  setSummarizer(fn: (messages: readonly LLMMessage[]) => Promise<string>): void;
  compress(sessionId: string): Promise<boolean>;
  size(sessionId: string): number;
}

import type { HistoryEntry } from "../../molecules/HistoryMolecule.js";
import type { LLMMessage } from "../providers/providerTypes.js";

export interface IStructuredConversation {
  append(sessionId: string, message: LLMMessage, projection?: HistoryEntry): void;
  snapshot(sessionId: string): readonly LLMMessage[];
  compress(
    sessionId: string,
    summarize?: (messages: readonly LLMMessage[]) => Promise<string>,
  ): Promise<boolean>;
}

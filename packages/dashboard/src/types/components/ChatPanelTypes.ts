export interface ChatPanelProps {
  tenantId: string;
}

export type ResponseSource = "reflex" | "llm" | "unknown";

export interface ChatMessage {
  role: string;
  content: string;
  source?: ResponseSource;
  reflexSequence?: string[];
  failedStep?: number;
}

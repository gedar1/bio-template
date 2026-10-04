import { useState, useRef, useEffect } from "react";
import { Brain, Zap } from "lucide-react";
import { postChatStream } from "../../hooks/useApi";
import { StepIndicator } from "../StepIndicator";
import { QuickTemplates, type TemplateExecutionResult } from "./QuickTemplates";
import type {
  ChatPanelProps,
  ChatMessage,
  ResponseSource,
} from "./ChatPanel.types";

const REFLEX_PATTERNS = [
  "tarea completada via reflex",
  "reflex ejecutado",
  "ejecutado via reflex",
  "reflex mode",
  "(0 tokens)",
  "⚡ reflex",
  "sequence:",
];

const REFLEX_RESPONSE_THRESHOLD_MS = 2000;

/** Known step keywords used to detect reflex sequences from response text */
const STEP_KEYWORDS: Record<string, string> = {
  scrape: "scrape_url",
  scrapea: "scrape_url",
  "scrape result": "scrape_url",
  links: "extract_links",
  "db insert": "db_insert",
  db_insert: "db_insert",
  "guardado en": "db_insert",
  "db query": "db_query",
  db_query: "db_query",
  "db find": "db_find",
  db_find: "db_find",
  "db update": "db_update",
  db_update: "db_update",
  "db delete": "db_delete",
  db_delete: "db_delete",
  "read file": "read_file",
  "write file": "write_file",
  "list files": "list_files",
  email: "send_email",
  whatsapp: "send_whatsapp",
  "git commit": "git_commit",
  "git push": "git_push",
  "git pull": "git_pull",
  "git status": "git_status",
  "git add": "git_add",
  "git log": "git_log",
  "http get": "http_get",
  "http post": "http_post",
  download: "http_download",
  cli: "execute_cli",
  "system info": "system_info",
  broadcast: "ws_broadcast",
};

/**
 * Attempts to extract a reflex sequence from the response content.
 * Looks for explicit sequence notation (arrow-separated) or infers from keywords.
 */
function extractReflexSequence(content: string): string[] | undefined {
  // Pattern 1: Explicit sequence like "mutate:sensory->scrape_url->mutate:memory->db_insert"
  const arrowRegex =
    /(?:sequence|secuencia|pasos?|steps?)[\s:]*([a-z_:]+(?:\s*->\s*[a-z_:]+)+)/i;
  const arrowMatch = arrowRegex.exec(content);
  if (arrowMatch) {
    return arrowMatch[1].split(/\s*->\s*/).filter(Boolean);
  }

  // Pattern 2: Bracketed sequence like "[mutate:sensory, scrape_url, db_insert]"
  const bracketRegex = /\[([a-z_:]+(?:\s*,\s*[a-z_:]+)+)\]/i;
  const bracketMatch = bracketRegex.exec(content);
  if (bracketMatch) {
    return bracketMatch[1].split(/\s*,\s*/).filter(Boolean);
  }

  // Pattern 3: Infer from content keywords (detect mutation + action)
  const lower = content.toLowerCase();
  const detected: string[] = [];
  const seen = new Set<string>();

  // Detect mutations first
  const mutationTypes = [
    "sensory",
    "memory",
    "filesystem",
    "communication",
    "versioncontrol",
    "http",
    "system",
    "monitor",
    "realtime",
  ];
  for (const type of mutationTypes) {
    if (lower.includes(type) && !seen.has(`mutate:${type}`)) {
      detected.push(`mutate:${type}`);
      seen.add(`mutate:${type}`);
    }
  }

  // Detect action steps
  for (const [keyword, step] of Object.entries(STEP_KEYWORDS)) {
    if (lower.includes(keyword) && !seen.has(step)) {
      detected.push(step);
      seen.add(step);
    }
  }

  return detected.length >= 2 ? detected : undefined;
}

/**
 * Extracts the failed step index from response content.
 * Looks for [failedStep:N] marker.
 */
function extractFailedStep(content: string): number | undefined {
  const match = /\[failedStep:(\d+)\]/.exec(content);
  if (match) return parseInt(match[1], 10);
  return undefined;
}

function detectSource(
  content: string,
  hadStreamingChunks: boolean,
  responseTimeMs: number,
): ResponseSource {
  const lower = content.toLowerCase();
  const matchesReflexPattern = REFLEX_PATTERNS.some((p) => lower.includes(p));

  if (matchesReflexPattern) return "reflex";
  if (!hadStreamingChunks && responseTimeMs < REFLEX_RESPONSE_THRESHOLD_MS)
    return "reflex";
  if (hadStreamingChunks) return "llm";
  return "unknown";
}

export function ChatPanel({ tenantId }: Readonly<ChatPanelProps>) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const chunkCountRef = useRef(0);
  const startTimeRef = useRef(0);

  useEffect(() => {
    setMessages([]);
    setStreamingText("");
  }, [tenantId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  const sendMessage = async (msg: string) => {
    if (!msg.trim() || sending) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    setSending(true);
    setStreamingText("");
    chunkCountRef.current = 0;
    startTimeRef.current = Date.now();

    try {
      const fullResponse = await postChatStream(msg, tenantId, (chunk) => {
        chunkCountRef.current++;
        setStreamingText((prev) => prev + chunk);
      });

      const responseTimeMs = Date.now() - startTimeRef.current;
      const hadStreamingChunks = chunkCountRef.current > 1;

      setStreamingText("");
      if (fullResponse) {
        const source = detectSource(
          fullResponse,
          hadStreamingChunks,
          responseTimeMs,
        );
        const reflexSequence =
          source === "reflex" ? extractReflexSequence(fullResponse) : undefined;
        const failedStep = extractFailedStep(fullResponse);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: fullResponse,
            source,
            reflexSequence,
            failedStep,
          },
        ]);
      }
    } catch (err: unknown) {
      setStreamingText("");
      const message = err instanceof Error ? err.message : "Unknown error";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${message}` },
      ]);
    } finally {
      setSending(false);
    }
  };

  const send = async () => {
    if (!input.trim()) return;
    const msg = input.trim();
    await sendMessage(msg);
  };

  return (
    <div className="bg-gray-800 flex flex-col h-full">
      <div className="p-3 border-b border-gray-700">
        <h3 className="text-gray-300 text-sm font-medium">
          Chat con BioCore
          <span className="text-gray-500 ml-2 text-xs">tenant: {tenantId}</span>
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <div className="text-gray-500 text-3xl mb-3">
              <Brain size={32} className="mx-auto text-gray-500" />
            </div>
            <div className="text-gray-400 text-sm mb-2">
              Describe lo que quieres automatizar en lenguaje natural.
            </div>
            <div className="text-gray-500 text-xs space-y-1">
              <p>Ejemplos:</p>
              <p className="text-gray-400">
                "Scrapea https://example.com y guárdalo en la BD"
              </p>
              <p className="text-gray-400">
                "Cada 2 horas verifica si mi API está activa"
              </p>
              <p className="text-gray-400">"Haz un backup de la tabla users"</p>
            </div>
            <p className="text-gray-600 text-xs mt-3">
              El sistema aprende de cada ejecución exitosa y la repite sin LLM.
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div className="max-w-[80%]">
              {m.role === "assistant" && m.source && m.source !== "unknown" && (
                <SourceBadge source={m.source} />
              )}
              {m.role === "assistant" &&
                m.source === "reflex" &&
                m.reflexSequence &&
                m.reflexSequence.length > 0 && (
                  <StepIndicator
                    steps={m.reflexSequence}
                    mode="reflex"
                    failedStep={m.failedStep}
                  />
                )}
              <div
                className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-200"
                }`}
              >
                {m.content
                  .replace(/^sequence:[^\n]+\n?/, "")
                  .replace(/\[failedStep:\d+\]/g, "")}
              </div>
            </div>
          </div>
        ))}
        {streamingText && (
          <div className="flex justify-start">
            <div className="max-w-[80%] bg-gray-700 text-gray-200 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">
              {streamingText}
              <span className="animate-pulse">▊</span>
            </div>
          </div>
        )}
        {sending && !streamingText && (
          <div className="flex justify-start">
            <div className="bg-gray-700 text-gray-400 rounded-lg px-3 py-2 text-sm animate-pulse">
              Conectando...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="p-3 border-t border-gray-700 flex gap-2">
        <QuickTemplates
          onTemplateResult={(result: TemplateExecutionResult) => {
            const argsStr = Object.entries(result.args)
              .filter(([, v]) => String(v).trim())
              .map(([k, v]) => `${k}: ${v}`)
              .join(", ");
            setMessages((prev) => [
              ...prev,
              {
                role: "user",
                content: `📋 ${result.templateName}${argsStr ? ` (${argsStr})` : ""}`,
              },
            ]);
            const content = result.success
              ? result.results.join("\n")
              : `Error: ${result.error}`;
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content,
                source: "reflex" as ResponseSource,
                reflexSequence: result.steps,
              },
            ]);
          }}
          disabled={sending}
          tenantId={tenantId}
        />
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Escribe un mensaje..."
          className="flex-1 bg-gray-900 text-white rounded-lg px-3 py-2 text-sm border border-gray-600 focus:border-blue-500 focus:outline-none"
          disabled={sending}
        />
        <button
          onClick={send}
          disabled={sending || !input.trim()}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Enviar
        </button>
      </div>
    </div>
  );
}

// ─── Sub-Components ─────────────────────────────────────────────────────────

function SourceBadge({ source }: Readonly<{ source: ResponseSource }>) {
  if (source === "reflex") {
    return (
      <span className="inline-flex items-center gap-1 mb-1 px-2 py-0.5 rounded text-xs font-medium bg-green-600/20 text-green-400 border border-green-700/50">
        <Zap size={12} /> Reflex (0 tokens)
      </span>
    );
  }

  if (source === "llm") {
    return (
      <span className="inline-flex items-center gap-1 mb-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-600/20 text-blue-400 border border-blue-700/50">
        <Brain size={12} /> LLM
      </span>
    );
  }

  return null;
}

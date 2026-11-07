import React, { useEffect, useRef, useState, type SubmitEvent } from "react";
import type {
  ExecutionChatProps,
  ExecutionEvent,
  ExecutionRun,
} from "./ExecutionChat.types";
import {
  createRun,
  isTerminalStage,
  reduceExecutionEvent,
} from "./executionReducer";
import { postChat, refreshApi } from "../../hooks/useApi";
import { RunCard } from "./components";
import { IS_STUDIO_MODE } from "../../utils/deploymentMode";
import { BRAND_NAME } from "../../utils/brand";
import Icon from "../../assets/svg_spiners/Icon";
import BloubAttentif from "../../assets/bloub-galet-attentif-ambre-anime.svg?react";

/**
 * Chat de ejecuciones. Cada mensaje del usuario se envía a POST /api/chat
 * del backend y la respuesta real se muestra en la tarjeta de la ejecución.
 */
export const ExecutionChat: React.FC<ExecutionChatProps> = ({ tenantId }) => {
  const [runs, setRuns] = useState<ExecutionRun[]>([]);
  const [input, setInput] = useState("");
  const cancelledRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  // Al desmontar (o cambiar tenant con `key`) se cancelan las ejecuciones en curso
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [runs]);

  const lastRun = runs.at(-1);
  const busy = lastRun !== undefined && !isTerminalStage(lastRun.stage);

  /** Envía el prompt al backend y refleja el resultado real en la ejecución. */
  const startRun = (prompt: string) => {
    const id = crypto.randomUUID();
    setRuns((prev) => [...prev, createRun(id, prompt)]);

    const emit = (event: ExecutionEvent) => {
      if (cancelledRef.current) return;
      setRuns((prev) =>
        prev.map((run) =>
          run.id === id ? reduceExecutionEvent(run, event) : run,
        ),
      );
    };

    void (async () => {
      try {
        const result = await postChat(prompt, tenantId);
        refreshApi("/api/tools", "/api/reflex", "/api/mutations");
        if (result?.error) throw new Error(String(result.error));
        if (typeof result?.response !== "string") {
          throw new Error("Respuesta inválida del backend");
        }
        emit({ type: "done", summary: result.response });
      } catch (err: unknown) {
        emit({
          type: "error",
          message: err instanceof Error ? err.message : "Error desconocido",
        });
      }
    })();
  };

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = input.trim();
    if (!prompt || busy) return;
    setInput("");
    startRun(prompt);
  };

  return (
    <>
      {open ? (
        <button
          className="absolute bottom-4 right-4 -scale-x-100"
          onClick={() => setOpen(!open)}
        >
          <span className="dot">
            <Icon width={48} height={48}>
              <BloubAttentif id="header_char" className="shrink-0" />
            </Icon>
          </span>
        </button>
      ) : (
        <section
          id="chat-section"
          className="flex h-full flex-col rounded-lg border border-gray-700 bg-gray-900"
        >
          <header className="flex items-center gap-3 border-b border-gray-700 px-4 py-3">
            <button onClick={() => setOpen(!open)}>
              <span className="dot">
                <Icon width={48} height={48}>
                  <BloubAttentif id="header_char" className="shrink-0" />
                </Icon>
              </span>
            </button>

            <div className="flex flex-col">
              <h2 className="text-sm font-semibold text-gray-100">Asistente</h2>
              <p className="text-xs text-gray-500">
                {IS_STUDIO_MODE ? `Tenant: ${tenantId}` : BRAND_NAME}
              </p>
            </div>
          </header>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
            {runs.length === 0 && (
              <p className="text-sm text-gray-500">
                Escribe una instrucción, por ejemplo: "scrapea la web y guarda
                en la bd".
              </p>
            )}
            {runs.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                onRetry={
                  run.stage === "error" && !busy
                    ? () => startRun(run.prompt)
                    : undefined
                }
              />
            ))}
            <div ref={bottomRef} />
          </div>

          <form
            onSubmit={handleSubmit}
            className="flex gap-2 border-t border-gray-700 p-3"
          >
            <label htmlFor="execution-chat-input" className="sr-only">
              Instrucción
            </label>
            <input
              id="execution-chat-input"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escribe una instrucción…"
              disabled={busy}
              className="flex-1 rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || input.trim() === ""}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Enviar
            </button>
          </form>
        </section>
      )}
    </>
  );
};

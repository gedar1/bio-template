import { useState, useEffect, useCallback } from "react";

const BASE = "";

/**
 * Obtiene el API key del localStorage (configurado por el admin en la UI).
 * Si no hay key configurada, retorna undefined (modo desarrollo sin auth).
 */
function getApiKey(): string | undefined {
  try {
    return localStorage.getItem("biocore-api-key") || undefined;
  } catch {
    return undefined;
  }
}

/** Construye headers con autenticación si hay API key configurada */
function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const apiKey = getApiKey();
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  return headers;
}

/** Agrega apiKey como query param (para SSE/EventSource que no soporta headers custom) */
function withApiKeyParam(url: string): string {
  const apiKey = getApiKey();
  if (!apiKey) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}apiKey=${encodeURIComponent(apiKey)}`;
}

export { getApiKey, authHeaders, withApiKeyParam };

export function useApi<T>(endpoint: string, intervalMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}${endpoint}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    fetchData();
    if (intervalMs) {
      const id = setInterval(fetchData, intervalMs);
      return () => clearInterval(id);
    }
  }, [fetchData, intervalMs]);

  return { data, error, loading, refetch: fetchData };
}

/**
 * Hook for POST requests. Returns a submit function and state.
 * Useful for tool invocations, mutation triggers, broadcasts, etc.
 */
export function usePost<TRequest, TResponse>(endpoint: string) {
  const [data, setData] = useState<TResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = useCallback(
    async (body: TRequest): Promise<TResponse | null> => {
      setLoading(true);
      setError(null);
      setData(null);

      try {
        const res = await fetch(`${BASE}${endpoint}`, {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(body),
        });

        const json = await res.json();

        if (!res.ok) {
          const errMsg = json.error ?? `HTTP ${res.status}`;
          setError(errMsg);
          return null;
        }

        setData(json);
        return json;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Request failed";
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [endpoint],
  );

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  return { data, error, loading, submit, reset };
}

export async function postChat(message: string, tenantId: string = "default") {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ message, tenantId }),
  });
  return res.json();
}

/**
 * Stream de chat via SSE. Llama onChunk por cada fragmento de texto.
 * Retorna la respuesta completa al finalizar.
 */
export async function postChatStream(
  message: string,
  tenantId: string = "default",
  onChunk: (chunk: string) => void,
): Promise<string> {
  const res = await fetch(`${BASE}/api/chat/stream`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ message, tenantId }),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No readable stream");

  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value, { stream: true });
    const lines = text.split("\n");

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.done) continue;
          if (data.error) throw new Error(data.error);
          if (data.chunk) {
            fullText += data.chunk;
            onChunk(data.chunk);
          }
        } catch (e: any) {
          if (e.message !== "done") throw e;
        }
      }
    }
  }

  return fullText;
}

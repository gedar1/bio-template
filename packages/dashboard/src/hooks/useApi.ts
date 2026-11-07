import { useState, useEffect, useCallback, useReducer, useRef } from "react";

const BASE = "";
const MAX_BACKOFF_MS = 60_000;

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

// ─── Caché compartida por clave ─────────────────────────────────────────────
// Cada clave (una URL con tenantId en la query, o un prefijo como "platform:")
// tiene una sola entrada. Los componentes que piden la misma clave comparten datos,
// una petición en vuelo y un temporizador. El intervalo efectivo es el menor de los
// suscriptores activos.

type Listener = () => void;
type Fetcher = () => Promise<unknown>;

interface CacheEntry {
  data: unknown;
  error: string | null;
  loading: boolean;
  failures: number;
  fetcher: Fetcher | null;
  listeners: Set<Listener>;
  intervals: Map<symbol, number>;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: Promise<void> | null;
}

const cache = new Map<string, CacheEntry>();

/** Sube al limpiar la caché: las respuestas en vuelo de una generación anterior se descartan. */
let generation = 0;

function getEntry(key: string): CacheEntry {
  let entry = cache.get(key);
  if (!entry) {
    entry = {
      data: null,
      error: null,
      loading: true,
      failures: 0,
      fetcher: null,
      listeners: new Set(),
      intervals: new Map(),
      timer: null,
      inFlight: null,
    };
    cache.set(key, entry);
  }
  return entry;
}

function notify(entry: CacheEntry): void {
  for (const listener of entry.listeners) listener();
}

function isVisible(): boolean {
  return typeof document === "undefined" || !document.hidden;
}

/** Reprograma el siguiente refresco con el menor intervalo y backoff por errores. */
function scheduleNext(key: string, entry: CacheEntry): void {
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  if (entry.intervals.size === 0) return;

  const base = Math.min(...entry.intervals.values());
  const cap = Math.max(base, MAX_BACKOFF_MS);
  const delay = Math.min(base * 2 ** entry.failures, cap);

  entry.timer = setTimeout(() => {
    entry.timer = null;
    // Con la pestaña oculta no se pide nada: al volver a verla se refresca (ver onVisible).
    if (isVisible()) void loadEntry(key);
  }, delay);
}

/** Ejecuta el fetcher de la entrada y actualiza sus datos. Reutiliza la petición en vuelo. */
function loadEntry(key: string): Promise<void> {
  const entry = getEntry(key);
  if (entry.inFlight) return entry.inFlight;
  const fetcher = entry.fetcher;
  if (!fetcher) return Promise.resolve();

  const gen = generation;
  entry.inFlight = (async () => {
    let ok = false;
    let data: unknown = null;
    let error: string | null = null;
    try {
      data = await fetcher();
      ok = true;
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : String(err);
    }

    // La caché se limpió mientras esta petición estaba en vuelo: no se escribe nada.
    if (gen !== generation) return;

    entry.inFlight = null;
    entry.loading = false;
    if (ok) {
      entry.data = data;
      entry.error = null;
      entry.failures = 0;
    } else {
      entry.error = error;
      entry.failures += 1;
    }
    notify(entry);
    scheduleNext(key, entry);
  })();
  return entry.inFlight;
}

// Al volver a ver la pestaña se refrescan las entradas que tienen suscriptores con intervalo.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    for (const [key, entry] of cache) {
      if (entry.intervals.size > 0) void loadEntry(key);
    }
  });
}

/**
 * Vacía la caché. Llamar al cerrar sesión para que un cliente no vea datos de otro.
 * Las entradas sin suscriptores se eliminan; las que tienen suscriptores se reinician.
 */
export function clearApiCache(): void {
  generation += 1;
  for (const [key, entry] of cache) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    entry.inFlight = null;
    if (entry.listeners.size === 0) {
      cache.delete(key);
      continue;
    }
    entry.data = null;
    entry.error = null;
    entry.failures = 0;
    entry.loading = true;
    notify(entry);
  }
}

/**
 * Refresca las claves que empiezan con alguno de los prefijos. Úsalo después de una
 * acción que cambia esos datos (por ejemplo, un mensaje del chat puede mutar la célula).
 */
export function refreshApi(...prefixes: string[]): void {
  for (const [key, entry] of cache) {
    if (entry.listeners.size === 0) continue;
    if (prefixes.some((p) => key.startsWith(p))) void loadEntry(key);
  }
}

/**
 * Lee un recurso con caché compartida.
 *
 * - `key` null desactiva la consulta; la última respuesta se conserva.
 * - `fetcher` obtiene el dato. Debe ser equivalente para una misma clave.
 * - `intervalMs` refresca la clave en ese intervalo. Si varios componentes piden la
 *   misma clave, se usa el intervalo más corto y solo hay un temporizador.
 * - Sin intervalo, la clave se pide al montar el componente y no se refresca sola.
 */
export function useCachedResource<T>(
  key: string | null,
  fetcher: (() => Promise<T>) | null,
  intervalMs?: number,
) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [subscriber] = useState(() => Symbol("cached"));
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!key) return;
    const entry = getEntry(key);
    entry.fetcher = () =>
      fetcherRef.current ? fetcherRef.current() : Promise.resolve(null);
    const listener: Listener = () => rerender();
    entry.listeners.add(listener);
    if (intervalMs) entry.intervals.set(subscriber, intervalMs);

    // Se pide al montar. Si ya hay una petición en vuelo, se reutiliza.
    void loadEntry(key);
    scheduleNext(key, entry);

    return () => {
      entry.listeners.delete(listener);
      entry.intervals.delete(subscriber);
      scheduleNext(key, entry);
    };
  }, [key, intervalMs, subscriber]);

  const entry = key ? getEntry(key) : null;
  const refetch = useCallback(
    () => (key ? loadEntry(key) : Promise.resolve()),
    [key],
  );

  return {
    data: (entry?.data ?? null) as T | null,
    error: entry?.error ?? null,
    loading: entry?.loading ?? false,
    refetch,
  };
}

/** GET a un endpoint del backend con la autenticación de tenant. */
async function apiGet<T>(endpoint: string): Promise<T> {
  const res = await fetch(`${BASE}${endpoint}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Lee un endpoint del backend con caché compartida. La clave es el endpoint, así que
 * la query (por ejemplo `tenantId`) forma parte de la clave.
 */
export function useApi<T>(endpoint: string | null, intervalMs?: number) {
  return useCachedResource<T>(
    endpoint,
    endpoint ? () => apiGet<T>(endpoint) : null,
    intervalMs,
  );
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

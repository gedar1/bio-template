import { useState, useEffect, useCallback } from "react";

/** localStorage key for the platform JWT token */
const PLATFORM_TOKEN_KEY = "platform_token";

/** Base URL for all platform API requests */
const PLATFORM_API_BASE = "/api/platform/";

/**
 * Retrieves the stored platform JWT token from localStorage.
 * Returns null if no token is stored or localStorage is unavailable.
 */
export function getPlatformToken(): string | null {
  try {
    return localStorage.getItem(PLATFORM_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Stores a platform JWT token in localStorage.
 */
export function setPlatformToken(token: string): void {
  try {
    localStorage.setItem(PLATFORM_TOKEN_KEY, token);
  } catch {
    // localStorage unavailable
  }
}

/**
 * Clears the stored platform JWT token, triggering re-auth via PlatformAuthGate.
 * Dispatches a StorageEvent so same-tab listeners can react to the removal.
 */
export function clearPlatformToken(): void {
  try {
    localStorage.removeItem(PLATFORM_TOKEN_KEY);
    // StorageEvent only fires cross-tab by default; dispatch manually for same-tab
    globalThis.dispatchEvent(
      new StorageEvent("storage", {
        key: PLATFORM_TOKEN_KEY,
        newValue: null,
        storageArea: localStorage,
      }),
    );
  } catch {
    // localStorage unavailable
  }
}

/**
 * Builds headers with Bearer token for platform API requests.
 */
function platformHeaders(
  extra?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const token = getPlatformToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * React hook for fetching data from platform API endpoints.
 * Attaches JWT token and handles 401 re-auth by clearing the stored token.
 *
 * Requirements: 2.1, 2.5
 */
export function usePlatformApi<T>(endpoint: string, intervalMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const url = `${PLATFORM_API_BASE}${endpoint.replace(/^\//, "")}`;
      const res = await fetch(url, {
        headers: platformHeaders(),
      });

      // On 401, clear token so PlatformAuthGate triggers re-auth
      if (res.status === 401) {
        clearPlatformToken();
        setError("Session expired. Please log in again.");
        return;
      }

      if (!res.ok) {
        const json = await res.json().catch(() => null);
        const msg = json?.error?.message ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }

      const json = await res.json();
      // Support API envelope format { data, error, meta }
      setData(json.data ?? json);
      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Request failed";
      setError(message);
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
 * Performs a one-off platform API fetch (non-hook utility).
 * Attaches JWT token and handles 401 re-auth by clearing the stored token.
 *
 * Requirements: 2.1, 2.5
 */
export async function platformFetch<T>(
  endpoint: string,
  options?: RequestInit,
): Promise<{ data: T | null; error: string | null; status: number }> {
  try {
    const url = `${PLATFORM_API_BASE}${endpoint.replace(/^\//, "")}`;
    const res = await fetch(url, {
      ...options,
      headers: platformHeaders({
        "Content-Type": "application/json",
        ...(options?.headers as Record<string, string>),
      }),
    });

    // On 401, clear token so PlatformAuthGate triggers re-auth
    if (res.status === 401) {
      clearPlatformToken();
      return {
        data: null,
        error: "Session expired. Please log in again.",
        status: 401,
      };
    }

    const json = await res.json();

    if (!res.ok) {
      const msg = json?.error?.message ?? `HTTP ${res.status}`;
      return { data: null, error: msg, status: res.status };
    }

    // Support API envelope format { data, error, meta }
    const result = json.data ?? json;
    return { data: result as T, error: null, status: res.status };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return { data: null, error: message, status: 0 };
  }
}

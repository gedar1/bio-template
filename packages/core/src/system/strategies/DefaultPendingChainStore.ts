/**
 * Implementación en memoria de IPendingChainStore.
 * Estado por sesión, con expiración. Se pierde al reiniciar el proceso.
 */

import type {
  IPendingChainStore,
  PendingChainRequest,
} from "./IPendingChainStore.js";

/** Tiempo de vida por defecto de una ejecución pendiente: 24 horas. */
const PENDING_CHAIN_TTL_MS = 24 * 60 * 60 * 1000;

export class DefaultPendingChainStore implements IPendingChainStore {
  private readonly entries = new Map<string, PendingChainRequest>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    ttlMs: number = PENDING_CHAIN_TTL_MS,
    now: () => number = Date.now,
  ) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  set(sessionId: string, chainId: string): void {
    this.entries.set(sessionId, {
      chainId,
      expiresAt: this.now() + this.ttlMs,
    });
  }

  get(sessionId: string): PendingChainRequest | null {
    const entry = this.entries.get(sessionId);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(sessionId);
      return null;
    }
    return entry;
  }

  clear(sessionId: string): void {
    this.entries.delete(sessionId);
  }
}

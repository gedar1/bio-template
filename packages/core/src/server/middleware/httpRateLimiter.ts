import type { IncomingMessage } from "node:http";
import { createLogger } from "../../config/logger.js";

const log = createLogger("HttpRateLimiter");

interface RateBucket {
  count: number;
  resetAt: number;
}

export interface HttpRateLimiterConfig {
  /** Requests permitidos por ventana (default: 60) */
  maxRequests: number;
  /** Ventana en ms (default: 60000 = 1 minuto) */
  windowMs: number;
  /** Requests permitidos para /api/chat/stream por ventana (default: 10) */
  maxChatRequests: number;
  /** Ventana para chat en ms (default: 60000) */
  chatWindowMs: number;
}

const DEFAULT_CONFIG: HttpRateLimiterConfig = {
  maxRequests: 300,
  windowMs: 60_000,
  maxChatRequests: 10,
  chatWindowMs: 60_000,
};

/**
 * Rate limiter HTTP por IP con ventanas separadas para endpoints generales y chat.
 * Protege contra:
 * - DDoS a endpoints de la API
 * - Agotamiento de créditos LLM via spam al chat
 * - Abuso de endpoints de acción (mutations, broadcast)
 */
export class HttpRateLimiter {
  private readonly config: HttpRateLimiterConfig;
  private readonly generalBuckets: Map<string, RateBucket> = new Map();
  private readonly chatBuckets: Map<string, RateBucket> = new Map();
  private readonly cleanupInterval: ReturnType<typeof setInterval>;

  constructor(config: Partial<HttpRateLimiterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Limpiar buckets expirados cada 5 minutos
    this.cleanupInterval = setInterval(() => this.cleanup(), 300_000);
  }

  /**
   * Verifica si un request está permitido.
   * @returns null si permitido, o un objeto de error si bloqueado
   */
  check(req: IncomingMessage): { error: string; retryAfterMs: number } | null {
    const ip = this.getClientIp(req);
    const url = req.url || "/";
    const isChat = url.includes("/api/chat");

    if (isChat) {
      return this.checkBucket(
        ip,
        this.chatBuckets,
        this.config.maxChatRequests,
        this.config.chatWindowMs,
        "chat",
      );
    }

    return this.checkBucket(
      ip,
      this.generalBuckets,
      this.config.maxRequests,
      this.config.windowMs,
      "general",
    );
  }

  private checkBucket(
    ip: string,
    buckets: Map<string, RateBucket>,
    maxRequests: number,
    windowMs: number,
    type: string,
  ): { error: string; retryAfterMs: number } | null {
    const now = Date.now();
    const bucket = buckets.get(ip);

    if (!bucket || now >= bucket.resetAt) {
      // Nueva ventana
      buckets.set(ip, { count: 1, resetAt: now + windowMs });
      return null;
    }

    if (bucket.count >= maxRequests) {
      const retryAfterMs = bucket.resetAt - now;
      log.warn(
        { ip, type, count: bucket.count, max: maxRequests, retryAfterMs },
        "Rate limit HTTP excedido",
      );
      return {
        error: `Rate limit exceeded. Max ${maxRequests} requests per ${windowMs / 1000}s. Retry after ${Math.ceil(retryAfterMs / 1000)}s`,
        retryAfterMs,
      };
    }

    bucket.count++;
    return null;
  }

  /**
   * Extrae la IP del cliente del request.
   * Soporta X-Forwarded-For para proxies reversos.
   */
  private getClientIp(req: IncomingMessage): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) {
      const first = Array.isArray(forwarded)
        ? forwarded[0]
        : forwarded.split(",")[0];
      return first.trim();
    }
    return req.socket.remoteAddress || "unknown";
  }

  /**
   * Limpia buckets expirados para evitar memory leaks.
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [ip, bucket] of this.generalBuckets) {
      if (now >= bucket.resetAt) this.generalBuckets.delete(ip);
    }
    for (const [ip, bucket] of this.chatBuckets) {
      if (now >= bucket.resetAt) this.chatBuckets.delete(ip);
    }
  }

  /**
   * Detiene el cleanup interval (para shutdown graceful).
   */
  dispose(): void {
    clearInterval(this.cleanupInterval);
  }
}

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { createLogger } from "../config/logger.js";
import { BioCoreError } from "../errors.js";
import { HttpRateLimiter } from "./middleware/httpRateLimiter.js";
import { checkAuth } from "./middleware/apiAuth.js";

export type SSEHandler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * Custom route handler for path prefixes.
 * Returns true if the request was handled, false to fall through to default handling.
 */
export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<boolean>;

const log = createLogger("HealthServer");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export interface HealthStatus {
  status: "ok" | "degraded" | "down";
  uptime: number;
  timestamp: number;
  version: string;
  checks: Record<string, boolean>;
}

/**
 * Servidor HTTP para health checks, métricas y API del dashboard.
 */
export class HealthServer {
  private httpServer: ReturnType<typeof createServer> | null = null;
  readonly startTime = Date.now();
  readonly customChecks: Map<string, () => Promise<boolean>> = new Map();
  readonly dataProviders: Map<string, (arg?: any) => Promise<any>> = new Map();
  private readonly sseHandlers: Map<string, SSEHandler> = new Map();
  private readonly routeHandlers: Map<string, RouteHandler> = new Map();
  private readonly rateLimiter = new HttpRateLimiter();
  private streamHandler:
    | ((
        tenantId: string,
        message: string,
        signal?: AbortSignal,
      ) => AsyncGenerator<string>)
    | null = null;

  registerCheck(name: string, fn: () => Promise<boolean>): void {
    this.customChecks.set(name, fn);
  }

  /** Registra un proveedor de datos para el dashboard */
  registerData(endpoint: string, fn: (arg?: any) => Promise<any>): void {
    this.dataProviders.set(endpoint, fn);
  }

  /** Registra el handler de streaming para chat */
  registerStreamHandler(
    fn: (
      tenantId: string,
      message: string,
      signal?: AbortSignal,
    ) => AsyncGenerator<string>,
  ): void {
    this.streamHandler = fn;
  }

  /** Registra un handler SSE para un endpoint específico */
  registerSSEHandler(endpoint: string, handler: SSEHandler): void {
    this.sseHandlers.set(endpoint, handler);
  }

  /**
   * Registra un handler de ruta personalizado para un prefijo de path.
   * El handler tiene control total sobre req/res (status codes, methods, etc).
   * Returns true if handled, false to fall through.
   */
  registerRouteHandler(pathPrefix: string, handler: RouteHandler): void {
    this.routeHandlers.set(pathPrefix, handler);
  }

  async getHealth(): Promise<HealthStatus> {
    const checks: Record<string, boolean> = {};
    for (const [name, fn] of this.customChecks) {
      try {
        checks[name] = await fn();
      } catch {
        checks[name] = false;
      }
    }
    const allOk = Object.values(checks).every(Boolean);
    const anyOk = Object.values(checks).some(Boolean);
    const hasChecks = Object.keys(checks).length > 0;

    return {
      status: !hasChecks ? "ok" : allOk ? "ok" : anyOk ? "degraded" : "down",
      uptime: Math.round((Date.now() - this.startTime) / 1000),
      timestamp: Date.now(),
      version: "1.0.0",
      checks,
    };
  }

  start(port: number = 3000): void {
    const server = createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        // CORS para el dashboard
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        // Rate limiting — excluye /health (necesario para healthchecks)
        const url = req.url || "/";
        if (url !== "/health") {
          const rateLimitResult = this.rateLimiter.check(req);
          if (rateLimitResult) {
            res.setHeader(
              "Retry-After",
              String(Math.ceil(rateLimitResult.retryAfterMs / 1000)),
            );
            this.json(res, 429, { error: rateLimitResult.error });
            return;
          }
        }

        // Autenticación — si API_SECRET está configurado en .env
        const authResult = checkAuth(req);
        if (authResult) {
          this.json(res, authResult.status, { error: authResult.error });
          return;
        }

        // Custom route handlers (e.g., Platform API)
        for (const [prefix, handler] of this.routeHandlers) {
          if (url.startsWith(prefix)) {
            try {
              const handled = await handler(req, res);
              if (handled) return;
            } catch (error: any) {
              if (!res.headersSent) {
                this.json(res, 500, { error: error.message });
              }
              return;
            }
          }
        }

        if (url === "/health" && req.method === "GET") {
          const health = await this.getHealth();
          const code = health.status === "down" ? 503 : 200;
          this.json(res, code, health);
          return;
        }

        // Data endpoints dinámicos: /api/{nombre} (GET con query params)
        if (url.startsWith("/api/") && req.method === "GET") {
          const name = url.slice(5).split("?")[0];

          // Check for SSE handlers first
          const sseHandler = this.sseHandlers.get(name);
          if (sseHandler) {
            const accept = req.headers.accept || "";
            if (accept.includes("text/event-stream")) {
              sseHandler(req, res);
              return;
            }
          }

          const params = this.parseQuery(url);
          const provider = this.dataProviders.get(name);
          if (provider) {
            try {
              // Inject Authorization header for platform/tenant auth
              if (req.headers.authorization) {
                params._authHeader = req.headers.authorization;
              }
              const data = await provider(params);
              // Unwrap PlatformResponse if present
              if (data && typeof data === "object" && "_statusCode" in data) {
                this.json(res, data._statusCode, data.body);
              } else {
                this.json(res, 200, data);
              }
            } catch (error: any) {
              const payload =
                error instanceof BioCoreError
                  ? error.toJSON()
                  : { error: error.message };
              this.json(res, 500, payload);
            }
            return;
          }
        }

        // Data endpoints dinámicos: /api/{nombre} (POST con body JSON)
        if (url.startsWith("/api/") && req.method === "POST") {
          const name = url.slice(5).split("?")[0];

          // SSE streaming tiene su propio handler
          if (name === "chat/stream" && this.streamHandler) {
            // handled below
          } else {
            const provider = this.dataProviders.get(name);
            if (provider) {
              try {
                const body = await this.readBody(req);
                const parsed = body ? JSON.parse(body) : {};
                // Inject Authorization header for platform/tenant auth
                if (req.headers.authorization) {
                  parsed._authHeader = req.headers.authorization;
                }
                const data = await provider(parsed);
                // Unwrap PlatformResponse if present
                if (data && typeof data === "object" && "_statusCode" in data) {
                  this.json(res, data._statusCode, data.body);
                } else {
                  this.json(res, 200, data);
                }
              } catch (error: any) {
                const payload =
                  error instanceof BioCoreError
                    ? error.toJSON()
                    : { error: error.message };
                this.json(res, 500, payload);
              }
              return;
            }
          }
        }

        // POST /api/chat/stream — SSE streaming
        if (
          url === "/api/chat/stream" &&
          req.method === "POST" &&
          this.streamHandler
        ) {
          try {
            const body = await this.readBody(req);
            const parsed = JSON.parse(body);
            if (!parsed.message) {
              this.json(res, 400, { error: "message requerido" });
              return;
            }
            const tenantId = parsed.tenantId || "default";

            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
              "Access-Control-Allow-Origin": "*",
            });

            const controller = new AbortController();
            const abort = () => controller.abort();
            req.once("close", abort);
            const stream = this.streamHandler(
              tenantId,
              parsed.message,
              controller.signal,
            );
            try {
              for await (const chunk of stream) {
                res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
              }
              if (!controller.signal.aborted) {
                res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
              }
              res.end();
            } finally {
              req.off("close", abort);
            }
          } catch (error: any) {
            // A disconnected SSE client has already closed its writable side;
            // abort is propagated to TenantManager/provider and nothing else is sent.
            if (res.destroyed || res.writableEnded) return;
            if (res.headersSent) {
              res.write(
                `data: ${JSON.stringify({ error: error.message })}\n\n`,
              );
              res.end();
            } else {
              this.json(res, 500, { error: error.message });
            }
          }
          return;
        }

        // Servir dashboard estático (producción)
        const dashboardPath = process.env.DASHBOARD_PATH;
        if (dashboardPath) {
          const filePath =
            url === "/"
              ? join(dashboardPath, "index.html")
              : join(dashboardPath, url);
          if (existsSync(filePath) && statSync(filePath).isFile()) {
            const ext = extname(filePath);
            const mime = MIME_TYPES[ext] || "application/octet-stream";
            res.writeHead(200, { "Content-Type": mime });
            createReadStream(filePath).pipe(res);
            return;
          }
          // SPA fallback: rutas que no son archivos van a index.html
          const indexPath = join(dashboardPath, "index.html");
          if (
            existsSync(indexPath) &&
            !url.startsWith("/api") &&
            !url.startsWith("/health")
          ) {
            res.writeHead(200, { "Content-Type": "text/html" });
            createReadStream(indexPath).pipe(res);
            return;
          }
        }

        this.json(res, 404, { error: "Not found" });
      },
    );

    server.listen(port, () => {
      log.info({ port }, "Health server activo");
    });
    this.httpServer = server;
  }

  stop(): Promise<void> {
    this.rateLimiter.dispose();
    return new Promise((resolve) => {
      if (this.httpServer) {
        this.httpServer.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private json(res: ServerResponse, code: number, data: any): void {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => resolve(body));
      req.on("error", reject);
    });
  }

  private parseQuery(url: string): Record<string, string> {
    const idx = url.indexOf("?");
    if (idx === -1) return {};
    const params: Record<string, string> = {};
    const search = url.slice(idx + 1);
    for (const pair of search.split("&")) {
      const [key, val] = pair.split("=");
      if (key) params[decodeURIComponent(key)] = decodeURIComponent(val || "");
    }
    return params;
  }
}

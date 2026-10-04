import { HTTPMolecule } from "../molecules/HTTPMolecule.js";
import { createLogger } from "../config/logger.js";

const log = createLogger("MonitorTask");

export interface MonitorTarget {
  url: string;
  name?: string;
  expectedStatus?: number;
  timeoutMs?: number;
}

export interface CheckResult {
  url: string;
  name: string;
  status: "ok" | "degraded" | "down";
  statusCode: number | null;
  responseTimeMs: number;
  error: string | null;
  timestamp: number;
}

/**
 * Ejecuta health checks directos sin LLM.
 * Solo escala al LLM cuando detecta problemas.
 */
export class MonitorTask {
  private http: HTTPMolecule;
  private targets: MonitorTarget[];
  private lastResults: Map<string, CheckResult> = new Map();
  private onAlert?: (results: CheckResult[], analysis: string) => Promise<void>;
  private chatFn?: (message: string) => Promise<string>;

  constructor(
    targets: MonitorTarget[],
    options?: {
      onAlert?: (results: CheckResult[], analysis: string) => Promise<void>;
      chatFn?: (message: string) => Promise<string>;
    }
  ) {
    this.http = new HTTPMolecule(undefined, 10000);
    this.targets = targets;
    this.onAlert = options?.onAlert;
    this.chatFn = options?.chatFn;
  }

  /**
   * Ejecuta checks directos a todos los targets.
   * Retorna resumen sin consumir tokens del LLM.
   * Solo llama al LLM si hay problemas.
   */
  async run(): Promise<string> {
    const results: CheckResult[] = [];

    for (const target of this.targets) {
      const result = await this.checkTarget(target);
      results.push(result);
      this.lastResults.set(target.url, result);
    }

    const problems = results.filter(r => r.status !== "ok");
    const allOk = problems.length === 0;

    // Resumen sin LLM
    const summary = results
      .map(r => `${r.status === "ok" ? "✅" : "❌"} ${r.name} (${r.statusCode || "N/A"}) ${r.responseTimeMs}ms`)
      .join(" | ");

    if (allOk) {
      log.info({ targets: results.length }, "Todos los targets OK");
      return `OK: ${summary}`;
    }

    // Solo si hay problemas, escalar al LLM para análisis
    log.warn({ problems: problems.length }, "Problemas detectados, escalando al LLM");

    if (this.chatFn) {
      const problemDetail = problems
        .map(p => `- ${p.name} (${p.url}): status=${p.statusCode}, error=${p.error}, responseTime=${p.responseTimeMs}ms`)
        .join("\n");

      const analysis = await this.chatFn(
        `Analiza estos problemas de monitoreo y dime si son críticos o falsa alarma. Sé breve (máximo 2 oraciones):\n${problemDetail}`
      );

      if (this.onAlert) {
        await this.onAlert(problems, analysis);
      }

      return `ALERTA: ${problems.length} problema(s). LLM: ${analysis}`;
    }

    return `ALERTA: ${summary}`;
  }

  private async checkTarget(target: MonitorTarget): Promise<CheckResult> {
    const name = target.name || target.url;
    const start = performance.now();

    try {
      const response = await this.http.client.get(target.url, {
        timeout: target.timeoutMs || 10000,
        validateStatus: () => true, // No lanzar error por status codes
      });

      const responseTimeMs = Math.round(performance.now() - start);
      const expectedStatus = target.expectedStatus || 200;
      const isOk = response.status === expectedStatus;

      return {
        url: target.url,
        name,
        status: isOk ? "ok" : response.status >= 500 ? "down" : "degraded",
        statusCode: response.status,
        responseTimeMs,
        error: isOk ? null : `Expected ${expectedStatus}, got ${response.status}`,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      const responseTimeMs = Math.round(performance.now() - start);
      return {
        url: target.url,
        name,
        status: "down",
        statusCode: null,
        responseTimeMs,
        error: error.message,
        timestamp: Date.now(),
      };
    }
  }

  /** Resultados del último check */
  getLastResults(): CheckResult[] {
    return Array.from(this.lastResults.values());
  }

  /** Actualiza los targets a monitorear */
  setTargets(targets: MonitorTarget[]): void {
    this.targets = targets;
  }
}

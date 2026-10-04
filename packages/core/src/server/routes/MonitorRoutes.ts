import { HealthServer } from "../HealthServer.js";
import { MonitorTask } from "../MonitorTask.js";
import type { MonitorTarget } from "../MonitorTask.js";
import { Scheduler } from "../../infrastructure/Scheduler.js";
import { GmailMolecule } from "../../molecules/GmailMolecule.js";
import type { TenantManager } from "../TenantManager.js";
import { createLogger } from "../../config/logger.js";

const log = createLogger("MonitorRoutes");

/**
 * Rutas de monitoreo: registrar targets HTTP y consultar su estado.
 * Envía alertas por email cuando se detectan problemas.
 */
export function setupMonitorRoutes(
  health: HealthServer,
  scheduler: Scheduler,
  tenantManager: TenantManager,
): void {
  const monitors: Map<string, MonitorTask> = new Map();

  health.registerData("monitor/add", async (body?: any) => {
    if (!body?.taskId || !body?.targets || !body?.intervalMs) {
      return {
        error:
          "taskId, targets (array de {url, name?}) e intervalMs requeridos",
      };
    }

    const tenantId = body.tenantId || "default";
    const targets: MonitorTarget[] = body.targets;

    const monitor = new MonitorTask(targets, {
      chatFn: async (message: string) => {
        const alertTenantId = `${tenantId}-alert`;
        return await tenantManager.chat(alertTenantId, message);
      },
      onAlert: async (problems, analysis) => {
        const problemSummary = problems
          .map((p) => {
            const detail = p.error || "status " + p.statusCode;
            return `<li><b>${p.name}</b> (${p.url}): ${p.status.toUpperCase()} — ${detail} (${p.responseTimeMs}ms)</li>`;
          })
          .join("\n");

        const emailTo = process.env.ALERT_EMAIL || process.env.GMAIL_USER || "";
        if (!emailTo) {
          log.warn(
            "No hay email de alerta configurado (ALERT_EMAIL o GMAIL_USER)",
          );
          return;
        }

        try {
          const gmail = new GmailMolecule();
          await gmail.connect();
          await gmail.sendEmail({
            to: emailTo,
            subject: `🚨 ALERTA BioCore: ${problems.length} problema(s) detectado(s)`,
            body: `
              <div style="font-family: Arial, sans-serif; max-width: 600px;">
                <h2 style="color: #dc2626;">🚨 Alerta de Monitoreo</h2>
                <p><b>Problemas detectados:</b></p>
                <ul>${problemSummary}</ul>
                <p><b>Análisis del LLM:</b></p>
                <p style="background: #fef3c7; padding: 12px; border-radius: 8px;">${analysis}</p>
                <hr>
                <small style="color: #6b7280;">BioCore Monitor — ${new Date().toLocaleString()}</small>
              </div>
            `,
            isHTML: true,
          });
          log.info(
            { problems: problems.length, emailTo },
            "Alerta enviada por email",
          );
        } catch (error: any) {
          log.error({ error: error.message }, "Error enviando email de alerta");
        }
      },
    });

    monitors.set(body.taskId, monitor);

    scheduler.register(
      body.taskId,
      body.name || `Monitor: ${targets.map((t) => t.name || t.url).join(", ")}`,
      body.intervalMs,
      async () => monitor.run(),
      body.startImmediately || false,
    );

    return { registered: true, taskId: body.taskId, targets: targets.length };
  });

  health.registerData("monitor/status", async (body?: any) => {
    const taskId = body?.taskId;
    if (taskId) {
      const monitor = monitors.get(taskId);
      return { results: monitor?.getLastResults() || [] };
    }
    const all: Record<string, any> = {};
    for (const [id, monitor] of monitors) {
      all[id] = monitor.getLastResults();
    }
    return { monitors: all };
  });
}

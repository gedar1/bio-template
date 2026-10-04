import { HealthServer } from "../HealthServer.js";
import type { TenantManager } from "../TenantManager.js";
import { summarizeToolResult } from "../../atoms/toolResultFormatter.js";
import { resolveRequestAuth } from "../middleware/tenantAuth.js";
import type { TenantAuthService } from "../services/TenantAuthService.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Resolves the effective tenant_id for a request.
 *
 * Priority:
 * 1. If _authHeader is present and resolves to a tenant_jwt, use that tenant_id.
 * 2. Otherwise, fall back to body.tenantId (backward compat with API_SECRET auth).
 * 3. Default to "default" if nothing is specified.
 */
function resolveTenantId(
  params: Record<string, unknown>,
  tenantAuthService?: TenantAuthService,
): string {
  const authHeader = params._authHeader as string | undefined;

  if (authHeader && tenantAuthService) {
    const ctx = resolveRequestAuth(authHeader, tenantAuthService);
    if (!("error" in ctx) && ctx.auth_type === "tenant_jwt") {
      return ctx.tenant_id;
    }
  }

  // Fallback to body param (backward compat with API_SECRET or Platform JWT)
  return (params.tenantId as string) || "default";
}

/**
 * Rutas del dashboard: tools, perf, history, tenants.
 * Proveen datos de observabilidad sobre el estado del sistema.
 */
export function setupDashboardRoutes(
  health: HealthServer,
  tenantManager: TenantManager,
  tenantAuthService?: TenantAuthService,
): void {
  health.registerData("tools", async (body?: any) => {
    const tenantId = resolveTenantId(body || {}, tenantAuthService);
    try {
      const tenant = await tenantManager.getTenant(tenantId);
      return await tenant.cortex.getUnifiedTools();
    } catch {
      return [];
    }
  });

  health.registerData("perf", async (body?: any) => {
    const tenantId = resolveTenantId(body || {}, tenantAuthService);
    try {
      const tenant = await tenantManager.getTenant(tenantId);
      return tenant.cortex.getPerfSummary();
    } catch {
      return {};
    }
  });

  health.registerData("history", async (body?: any) => {
    const tenantId = resolveTenantId(body || {}, tenantAuthService);
    try {
      const tenant = await tenantManager.getTenant(tenantId);
      const messages = tenant.cortex.getHistory();
      return {
        tenantId,
        sessionId: tenant.cortex.getSessionId(),
        messages,
        count: messages.length,
      };
    } catch {
      return { tenantId, messages: [], count: 0 };
    }
  });

  health.registerData("tenants", async () => {
    return { tenants: tenantManager.listTenants(), total: tenantManager.size };
  });

  health.registerData("chat", async (body?: any) => {
    if (!body?.message) return { error: "message requerido" };
    const tenantId = resolveTenantId(body || {}, tenantAuthService);
    try {
      const response = await tenantManager.chat(tenantId, body.message);
      return { tenantId, response };
    } catch (error: any) {
      return { tenantId, error: error.message };
    }
  });

  // ─── Perfil del tenant ──────────────────────────────────────────────────
  health.registerData("tenant-profile", async (body?: any) => {
    const tenantId = resolveTenantId(body || {}, tenantAuthService);
    // Leer perfil directamente del env/config sin crear tenant (evita disparar LLM)
    const profile = process.env.TENANT_PROFILE || "dev";
    const availableProfiles = tenantManager.getAvailableProfilesList();
    const profileInfo = availableProfiles[profile] || null;

    return {
      tenantId,
      profile,
      profileInfo,
      availableProfiles,
    };
  });

  // ─── Endpoints de restaurante (consulta directa, sin LLM) ────────────────
  health.registerData("orders/active", async (body?: any) => {
    const tenantId = resolveTenantId(body || {}, tenantAuthService);
    return { tenantId, orders: [] };
  });

  health.registerData("orders/summary", async (body?: any) => {
    const tenantId = resolveTenantId(body || {}, tenantAuthService);
    return { tenantId, totalOrders: 0, totalRevenue: 0, avgOrderValue: 0 };
  });

  health.registerData("inventory/alerts", async (body?: any) => {
    const tenantId = resolveTenantId(body || {}, tenantAuthService);
    return { tenantId, alerts: [] };
  });

  // ─── Ejecución directa de template (sin LLM) ───────────────────────────
  health.registerData("template/execute", async (body?: any) => {
    if (!body?.steps || !Array.isArray(body.steps)) {
      return { error: "steps requerido (array de acciones)" };
    }

    const tenantId = resolveTenantId(body || {}, tenantAuthService);
    const steps: string[] = body.steps;
    const args: Record<string, unknown> = body.args || {};
    const templateName: string = body.templateName || "Template";

    try {
      const tenant = await tenantManager.getTenant(tenantId);
      const results: string[] = [];

      for (const step of steps) {
        if (step.startsWith("mutate:")) {
          const cellType = step.replace("mutate:", "");
          await tenant.cortex.executeAction("stimulate_differentiation", {
            type: cellType,
          });
          // No agregar mutaciones al resultado visible
        } else if (step === "__monitor_add") {
          // Step especial: registrar monitor recurrente
          const monitorArgs = args[step] || args;
          const taskId = (monitorArgs as any).taskId || `monitor-${Date.now()}`;
          const url = (monitorArgs as any).url;
          const intervalMinutes = Number((monitorArgs as any).intervalMs) || 5;
          const intervalMs = intervalMinutes * 60000;

          if (!url) {
            results.push("❌ URL requerida para crear monitor");
          } else {
            const monitorProvider = health.dataProviders.get("monitor/add");
            if (monitorProvider) {
              await monitorProvider({
                taskId,
                targets: [url],
                intervalMs,
                tenantId,
              });
              results.push(
                `🔔 Monitor "${taskId}" creado — verificando ${url} cada ${intervalMinutes} min`,
              );
            } else {
              results.push("❌ MonitorRoutes no disponible");
            }
          }
        } else {
          const toolArgs = args[step] || args || {};
          const result = await tenant.cortex.executeAction(step, toolArgs);
          results.push(
            summarizeToolResult(
              step,
              result,
              toolArgs as Record<string, unknown>,
            ),
          );
        }
      }

      return {
        tenantId,
        templateName,
        success: true,
        results,
        stepsExecuted: steps.length,
        usedLLM: false,
      };
    } catch (error: any) {
      return {
        tenantId,
        templateName,
        success: false,
        error: error.message,
        usedLLM: false,
      };
    }
  });
}

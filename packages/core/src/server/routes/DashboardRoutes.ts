import { getDefaultProfile } from "../../config/profileRegistry.js";
import { HealthServer } from "../HealthServer.js";
import type { TenantManager } from "../TenantManager.js";
import { summarizeToolResult } from "../../atoms/toolResultFormatter.js";
import { resolveRequestAuth } from "../middleware/tenantAuth.js";
import {
  resolveTenantAccess,
  resolvePlatformAccess,
} from "../middleware/requestAccess.js";
import type { TenantAuthService } from "../services/TenantAuthService.js";
import {
  getDeploymentMode,
  getSingleTenantId,
} from "../../config/deploymentMode.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Resolves the effective tenant_id for a request.
 *
 * In "single" deployment mode there is only one tenant: it always resolves to
 * TENANT_ID and ignores any tenantId sent by the client.
 *
 * Priority (studio):
 * 1. If _authHeader is present and resolves to a tenant_jwt, use that tenant_id.
 * 2. Otherwise, fall back to body.tenantId (backward compat with API_SECRET auth).
 * 3. Default to "default" if nothing is specified.
 */
function resolveTenantId(
  params: Record<string, unknown>,
  tenantAuthService?: TenantAuthService,
): string {
  if (getDeploymentMode() === "single") {
    return getSingleTenantId();
  }

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

  // El historial de chat es privado: solo el propio tenant (JWT de tenant) puede leerlo.
  // No se usa body.tenantId ni tokens de plataforma/API_SECRET, para que un admin
  // o un token compartido no lean conversaciones de otros clientes.
  health.registerData("history", async (body?: any) => {
    const authHeader = body?._authHeader as string | undefined;
    const ctx =
      authHeader && tenantAuthService
        ? resolveRequestAuth(authHeader, tenantAuthService)
        : null;

    if (!ctx || "error" in ctx || ctx.auth_type !== "tenant_jwt") {
      return {
        error: "Historial privado: requiere token de tenant",
        code: "ACCESS_DENIED",
        messages: [],
        count: 0,
      };
    }

    const tenantId = ctx.tenant_id;
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

  // Lista de clientes: solo en modo studio y solo para super admin de plataforma
  // o para la API key del despliegue (api_secret). Nunca sin credenciales.
  health.registerData("tenants", async (body?: any) => {
    if (getDeploymentMode() === "single") {
      return { tenants: [], total: 0 };
    }

    const access = resolvePlatformAccess(body || {});
    if (!access.ok) {
      return {
        error: "Lista de clientes requiere credenciales de plataforma",
        code: access.code,
        tenants: [],
        total: 0,
      };
    }

    return { tenants: tenantManager.listTenants(), total: tenantManager.size };
  });

  health.registerData("chat", async (body?: any) => {
    const access = resolveTenantAccess(body || {}, tenantAuthService);
    if (!access.ok) return { error: access.error, code: access.code };
    if (!body?.message) return { error: "message requerido" };
    const tenantId = access.tenantId;
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
    const profile = process.env.TENANT_PROFILE || getDefaultProfile();
    const availableProfiles = tenantManager.getAvailableProfilesList();
    const profileInfo = availableProfiles[profile] || null;

    return {
      tenantId,
      profile,
      profileInfo,
      availableProfiles,
    };
  });

  // ─── Ejecución directa de template (sin LLM) ───────────────────────────
  health.registerData("template/execute", async (body?: any) => {
    const access = resolveTenantAccess(body || {}, tenantAuthService);
    if (!access.ok) return { error: access.error, code: access.code };
    if (!body?.steps || !Array.isArray(body.steps)) {
      return { error: "steps requerido (array de acciones)" };
    }

    const tenantId = access.tenantId;
    const steps: string[] = body.steps;
    const args: Record<string, unknown> = body.args || {};
    const templateName: string = body.templateName || "Template";

    try {
      const tenant = await tenantManager.getTenant(tenantId);
      const results: string[] = [];

      for (const step of steps) {
        if (step.startsWith("mutate:")) {
          const cellType = step.replace("mutate:", "");
          // Sequential on purpose: each mutation must complete before the next step runs.
          // eslint-disable-next-line no-await-in-loop
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

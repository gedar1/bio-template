import { HealthServer } from "../HealthServer.js";
import { Scheduler } from "../../infrastructure/Scheduler.js";
import type { TenantManager } from "../TenantManager.js";
import { createLogger } from "../../config/logger.js";
import { resolveRequestAuth } from "../middleware/tenantAuth.js";
import type { TenantAuthService } from "../services/TenantAuthService.js";

const log = createLogger("SchedulerRoutes");

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
 * Rutas del scheduler: listar, disparar, agregar, eliminar, pausar, reanudar y consultar actividad.
 */
export function setupSchedulerRoutes(
  health: HealthServer,
  scheduler: Scheduler,
  tenantManager: TenantManager,
  tenantAuthService?: TenantAuthService,
): void {
  health.registerData("scheduler", async () => {
    return { tasks: scheduler.list(), total: scheduler.size };
  });

  health.registerData("scheduler/trigger", async (body?: any) => {
    if (!body?.taskId) return { error: "taskId requerido" };
    const ok = await scheduler.trigger(body.taskId);
    return { triggered: ok, taskId: body.taskId };
  });

  health.registerData("scheduler/add", async (body?: any) => {
    if (!body?.taskId || !body?.message || !body?.intervalMs) {
      return { error: "taskId, message e intervalMs requeridos" };
    }
    const tenantId = resolveTenantId(body || {}, tenantAuthService);
    scheduler.register(
      body.taskId,
      body.name || body.taskId,
      body.intervalMs,
      async () => {
        log.info(
          { taskId: body.taskId, tenantId },
          "Ejecutando tarea programada",
        );
        return await tenantManager.chat(tenantId, body.message);
      },
      body.startImmediately || false,
    );
    return { registered: true, taskId: body.taskId };
  });

  health.registerData("scheduler/remove", async (body?: any) => {
    if (!body?.taskId) return { error: "taskId requerido" };
    return { removed: scheduler.unregister(body.taskId) };
  });

  health.registerData("scheduler/pause", async (body?: any) => {
    if (!body?.taskId) return { error: "taskId requerido" };
    return { paused: scheduler.pause(body.taskId) };
  });

  health.registerData("scheduler/resume", async (body?: any) => {
    if (!body?.taskId) return { error: "taskId requerido" };
    return { resumed: scheduler.resume(body.taskId) };
  });

  health.registerData("scheduler/activity", async (body?: any) => {
    const limit = body?.limit || 20;
    const taskId = body?.taskId;
    if (taskId) {
      return { activity: scheduler.getActivityByTask(taskId, limit) };
    }
    return { activity: scheduler.getActivity(limit) };
  });
}

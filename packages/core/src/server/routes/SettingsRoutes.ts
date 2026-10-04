import { HealthServer } from "../HealthServer.js";
import { SettingsManager } from "../SettingsManager.js";
import { checkRole } from "../middleware/roleMiddleware.js";
import { createLogger } from "../../config/logger.js";

const log = createLogger("SettingsRoutes");

/**
 * Rutas de settings: GET y PATCH para administración del sistema.
 *
 * GET  /api/settings → retorna configuración completa
 * POST /api/settings → aplica un patch parcial (hot-reload settings)
 *
 * Ambos endpoints requieren rol "admin".
 */
export function setupSettingsRoutes(
  health: HealthServer,
  settingsManager: SettingsManager,
): void {
  health.registerData("settings", async (body?: Record<string, unknown>) => {
    // ─── Auth: requiere rol admin ─────────────────────────────────────────
    const roleError = checkRole("admin");
    if (roleError) {
      return { ...roleError, statusCode: 403 };
    }

    // ─── Dispatch: GET (sin body) vs PATCH (con body) ─────────────────────
    const isPatch = body && Object.keys(body).length > 0 && hasPatchKeys(body);

    if (!isPatch) {
      // GET /api/settings — retorna configuración completa
      try {
        const settings = settingsManager.getSettings();
        return settings;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Unknown internal error";
        log.error({ error: message }, "Error obteniendo settings");
        return { error: "Internal server error", statusCode: 500 };
      }
    }

    // PATCH /api/settings — aplica cambios parciales
    try {
      const updatedSettings = await settingsManager.applySettings(body as any);
      return updatedSettings;
    } catch (error: unknown) {
      return handlePatchError(error);
    }
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Determina si el body contiene keys válidas para un patch de settings.
 * Evita interpretar query params de GET como un patch.
 */
function hasPatchKeys(body: Record<string, unknown>): boolean {
  const patchKeys = new Set([
    "llm",
    "templates",
    "business",
    "tenant",
    "port",
    "databaseType",
  ]);
  return Object.keys(body).some((key) => patchKeys.has(key));
}

/**
 * Mapea errores del SettingsManager a respuestas HTTP con código apropiado.
 *
 * - error.requiresRestart === true → HTTP 400
 * - error.reverted === true → HTTP 409
 * - error.details (Zod errors) → HTTP 422
 * - Otros → HTTP 500
 */
function handlePatchError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    const message = typeof error === "string" ? error : "Unknown error";
    log.error({ error: message }, "Error inesperado en PATCH settings");
    return { error: "Internal server error", statusCode: 500 };
  }

  const err = error as Error & {
    requiresRestart?: boolean;
    setting?: string;
    reverted?: boolean;
    provider?: string;
    details?: unknown[];
  };

  // Setting requires restart → 400
  if (err.requiresRestart) {
    log.warn(
      { setting: err.setting },
      "Intento de modificar setting restart-required",
    );
    return {
      error: "Setting requires restart",
      setting: err.setting,
      statusCode: 400,
    };
  }

  // Provider unreachable, reverted → 409
  if (err.reverted) {
    log.warn({ provider: err.provider }, "Provider unreachable, reverted");
    return {
      error: "Provider unreachable",
      provider: err.provider,
      reverted: true,
      statusCode: 409,
    };
  }

  // Zod validation errors → 422
  if (err.details) {
    log.warn({ details: err.details }, "Validation failed on settings patch");
    return {
      error: "Validation failed",
      details: err.details,
      statusCode: 422,
    };
  }

  // Unknown error → 500
  log.error({ error: err.message }, "Error inesperado en PATCH settings");
  return { error: "Internal server error", statusCode: 500 };
}

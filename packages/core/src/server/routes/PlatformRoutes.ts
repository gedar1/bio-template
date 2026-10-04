import { createLogger } from "../../config/logger.js";
import type { HealthServer } from "../HealthServer.js";
import {
  validatePlatformToken,
  issuePlatformToken,
  isPlatformEnabled,
  PlatformLoginSchema,
} from "../middleware/platformAuth.js";
import { successEnvelope, errorEnvelope } from "../utils/apiEnvelope.js";
import {
  CreateTenantSchema,
  TenantProfileSchema,
  TenantStatusSchema,
} from "../services/TenantRegistryService.js";
import type {
  TenantRegistryService,
  TenantListFilter,
} from "../services/TenantRegistryService.js";
import type { AuditLogger } from "../services/AuditLogger.js";
import type { UsageMetricsCollector } from "../services/UsageMetricsCollector.js";
import type { HealthStatusCalculator } from "../services/HealthStatusCalculator.js";
import type { AlertService } from "../services/AlertService.js";
import type { TenantAuthService } from "../services/TenantAuthService.js";

const log = createLogger("PlatformRoutes");

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Response wrapper that carries HTTP status code for HealthServer integration.
 * Task 11.4 will wire this to produce correct HTTP status codes.
 */
export interface PlatformResponse {
  _statusCode: number;
  body: unknown;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function platformResponse(statusCode: number, body: unknown): PlatformResponse {
  return { _statusCode: statusCode, body };
}

/**
 * Validates the Authorization header for protected endpoints.
 * Returns null if valid, or a PlatformResponse error if invalid.
 */
function requireAuth(params: Record<string, unknown>): PlatformResponse | null {
  const authHeader = params._authHeader as string | undefined;

  const result = validatePlatformToken(authHeader);
  if ("error" in result) {
    return platformResponse(
      result.status,
      errorEnvelope(
        result.status === 403 ? "AUTH_INSUFFICIENT_ROLE" : "AUTH_INVALID_TOKEN",
        result.error,
      ),
    );
  }

  return null;
}

/**
 * Extracts actor identifier from the auth header for audit logging.
 */
function getActor(params: Record<string, unknown>): string {
  const authHeader = params._authHeader as string | undefined;
  const result = validatePlatformToken(authHeader);
  if ("payload" in result) {
    return result.payload.sub;
  }
  return "unknown";
}
// ─── Handler: Create Tenant ───────────────────────────────────────────────────

async function handleCreateTenant(
  params: Record<string, unknown>,
  registry: TenantRegistryService,
  auditLogger: AuditLogger,
  tenantAuthService?: TenantAuthService,
): Promise<PlatformResponse> {
  const authError = requireAuth(params);
  if (authError) return authError;

  const parseResult = CreateTenantSchema.safeParse(params);
  if (!parseResult.success) {
    const profileIssue = parseResult.error.issues.find((i) =>
      i.path.includes("profile"),
    );
    const message = profileIssue
      ? `Invalid profile. Available profiles: ${TenantProfileSchema.options.join(", ")}`
      : "Invalid tenant creation input";

    return platformResponse(
      422,
      errorEnvelope("VALIDATION_ERROR", message, {
        ...(profileIssue && {
          available_profiles: TenantProfileSchema.options,
        }),
        issues: parseResult.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      }),
    );
  }

  if (registry.exists(parseResult.data.tenant_id)) {
    return platformResponse(
      409,
      errorEnvelope(
        "TENANT_ALREADY_EXISTS",
        `Tenant with ID '${parseResult.data.tenant_id}' already exists in the registry.`,
        { tenant_id: parseResult.data.tenant_id },
      ),
    );
  }

  try {
    const record = registry.create(parseResult.data);

    // Generate API key for the new tenant (one-time display)
    let apiKey: string | undefined;
    if (tenantAuthService) {
      const { raw, hash } = await tenantAuthService.generateApiKey();
      registry.setApiKeyHash(record.tenant_id, hash);
      apiKey = raw;
    }

    const actor = getActor(params);
    auditLogger.log("tenant.create", actor, record.tenant_id, {
      display_name: record.display_name,
      profile: record.profile,
      token_limit: record.token_limit,
    });

    return platformResponse(
      201,
      successEnvelope({ ...record, api_key: apiKey }),
    );
  } catch (error: any) {
    if (error.message?.includes("already exists")) {
      return platformResponse(
        409,
        errorEnvelope("TENANT_ALREADY_EXISTS", error.message, {
          tenant_id: parseResult.data.tenant_id,
        }),
      );
    }
    log.error({ error }, "Failed to create tenant");
    return platformResponse(
      500,
      errorEnvelope("INTERNAL_ERROR", "Failed to create tenant"),
    );
  }
}

// ─── Handler: List or Detail Tenants ──────────────────────────────────────────

function handleListOrDetailTenants(
  params: Record<string, unknown>,
  registry: TenantRegistryService,
): PlatformResponse {
  const authError = requireAuth(params);
  if (authError) return authError;

  // If 'id' query param is provided, return tenant detail
  const idParam = typeof params.id === "string" ? params.id : undefined;
  if (idParam) {
    const tenant = registry.getById(idParam);
    if (!tenant) {
      return platformResponse(
        404,
        errorEnvelope(
          "TENANT_NOT_FOUND",
          `Tenant with ID '${idParam}' does not exist in the registry.`,
          { tenant_id: idParam },
        ),
      );
    }
    // Include has_api_key flag — never expose the hash itself
    const hasApiKey = registry.getApiKeyHash(idParam) !== null;
    return platformResponse(
      200,
      successEnvelope({ ...tenant, has_api_key: hasApiKey }),
    );
  }

  // Build filter from query params
  return handleTenantListWithFilters(params, registry);
}

// ─── Handler: Tenant List with Filters ────────────────────────────────────────

function handleTenantListWithFilters(
  params: Record<string, unknown>,
  registry: TenantRegistryService,
): PlatformResponse {
  const filter: TenantListFilter = {};

  if (params.profile) {
    const profileResult = TenantProfileSchema.safeParse(params.profile);
    if (!profileResult.success) {
      return platformResponse(
        422,
        errorEnvelope(
          "VALIDATION_ERROR",
          `Invalid profile filter. Available profiles: ${TenantProfileSchema.options.join(", ")}`,
          { available_profiles: TenantProfileSchema.options },
        ),
      );
    }
    filter.profile = profileResult.data;
  }

  if (params.status) {
    const statusResult = TenantStatusSchema.safeParse(params.status);
    if (!statusResult.success) {
      return platformResponse(
        422,
        errorEnvelope(
          "VALIDATION_ERROR",
          `Invalid status filter. Available statuses: ${TenantStatusSchema.options.join(", ")}`,
          { available_statuses: TenantStatusSchema.options },
        ),
      );
    }
    filter.status = statusResult.data;
  }

  const tenants = registry.list(filter);
  return platformResponse(200, successEnvelope(tenants));
}
// ─── Handler: Deactivate Tenant ───────────────────────────────────────────────

function handleDeactivateTenant(
  params: Record<string, unknown>,
  registry: TenantRegistryService,
  auditLogger: AuditLogger,
): PlatformResponse {
  const authError = requireAuth(params);
  if (authError) return authError;

  const tenantId = params.tenant_id as string | undefined;
  if (!tenantId) {
    return platformResponse(
      422,
      errorEnvelope("VALIDATION_ERROR", "Missing tenant_id parameter"),
    );
  }

  const existing = registry.getById(tenantId);
  if (!existing) {
    return platformResponse(
      404,
      errorEnvelope(
        "TENANT_NOT_FOUND",
        `Tenant with ID '${tenantId}' does not exist in the registry.`,
        { tenant_id: tenantId },
      ),
    );
  }

  try {
    const record = registry.updateStatus(tenantId, "inactive");

    const actor = getActor(params);
    auditLogger.log("tenant.deactivate", actor, tenantId, {
      previous_status: existing.status,
      new_status: "inactive",
    });

    return platformResponse(200, successEnvelope(record));
  } catch (error: any) {
    log.error({ error }, "Failed to deactivate tenant");
    return platformResponse(
      500,
      errorEnvelope("INTERNAL_ERROR", "Failed to deactivate tenant"),
    );
  }
}

// ─── Handler: Reactivate Tenant ───────────────────────────────────────────────

function handleReactivateTenant(
  params: Record<string, unknown>,
  registry: TenantRegistryService,
  auditLogger: AuditLogger,
): PlatformResponse {
  const authError = requireAuth(params);
  if (authError) return authError;

  const tenantId = params.tenant_id as string | undefined;
  if (!tenantId) {
    return platformResponse(
      422,
      errorEnvelope("VALIDATION_ERROR", "Missing tenant_id parameter"),
    );
  }

  const existing = registry.getById(tenantId);
  if (!existing) {
    return platformResponse(
      404,
      errorEnvelope(
        "TENANT_NOT_FOUND",
        `Tenant with ID '${tenantId}' does not exist in the registry.`,
        { tenant_id: tenantId },
      ),
    );
  }

  try {
    const record = registry.updateStatus(tenantId, "active");

    const actor = getActor(params);
    auditLogger.log("tenant.reactivate", actor, tenantId, {
      previous_status: existing.status,
      new_status: "active",
    });

    return platformResponse(200, successEnvelope(record));
  } catch (error: any) {
    log.error({ error }, "Failed to reactivate tenant");
    return platformResponse(
      500,
      errorEnvelope("INTERNAL_ERROR", "Failed to reactivate tenant"),
    );
  }
}

// ─── Handler: Regenerate API Key ──────────────────────────────────────────────

async function handleRegenerateKey(
  params: Record<string, unknown>,
  registry: TenantRegistryService,
  auditLogger: AuditLogger,
  tenantAuthService?: TenantAuthService,
): Promise<PlatformResponse> {
  const authError = requireAuth(params);
  if (authError) return authError;

  if (!tenantAuthService) {
    return platformResponse(
      503,
      errorEnvelope(
        "PLATFORM_DISABLED",
        "Tenant auth service is not configured.",
      ),
    );
  }

  const tenantId = params.tenant_id as string | undefined;
  if (!tenantId) {
    return platformResponse(
      422,
      errorEnvelope("VALIDATION_ERROR", "Missing tenant_id parameter"),
    );
  }

  const existing = registry.getById(tenantId);
  if (!existing) {
    return platformResponse(
      404,
      errorEnvelope(
        "TENANT_NOT_FOUND",
        `Tenant with ID '${tenantId}' does not exist in the registry.`,
        { tenant_id: tenantId },
      ),
    );
  }

  try {
    const { raw: newRaw } = await tenantAuthService.regenerateApiKey(tenantId);

    const actor = getActor(params);
    auditLogger.log("tenant.regenerate_key", actor, tenantId, {
      display_name: existing.display_name,
    });

    return platformResponse(
      200,
      successEnvelope({ tenant_id: tenantId, api_key: newRaw }),
    );
  } catch (error: any) {
    log.error({ error }, "Failed to regenerate API key");
    return platformResponse(
      500,
      errorEnvelope("INTERNAL_ERROR", "Failed to regenerate API key"),
    );
  }
}

// ─── Handler: Update Tenant Profile ───────────────────────────────────────────

function handleUpdateProfile(
  params: Record<string, unknown>,
  registry: TenantRegistryService,
  auditLogger: AuditLogger,
): PlatformResponse {
  const authError = requireAuth(params);
  if (authError) return authError;

  const tenantId = params.tenant_id as string | undefined;
  if (!tenantId) {
    return platformResponse(
      422,
      errorEnvelope("VALIDATION_ERROR", "Missing tenant_id parameter"),
    );
  }

  const existing = registry.getById(tenantId);
  if (!existing) {
    return platformResponse(
      404,
      errorEnvelope(
        "TENANT_NOT_FOUND",
        `Tenant with ID '${tenantId}' does not exist in the registry.`,
        { tenant_id: tenantId },
      ),
    );
  }

  const profileResult = TenantProfileSchema.safeParse(params.profile);
  if (!profileResult.success) {
    return platformResponse(
      422,
      errorEnvelope(
        "VALIDATION_ERROR",
        `Invalid profile. Available profiles: ${TenantProfileSchema.options.join(", ")}`,
        { available_profiles: TenantProfileSchema.options },
      ),
    );
  }

  try {
    const { record, previousProfile } = registry.updateProfile(
      tenantId,
      profileResult.data,
    );

    const actor = getActor(params);
    auditLogger.log("tenant.profile_change", actor, tenantId, {
      previous_profile: previousProfile,
      new_profile: profileResult.data,
    });

    return platformResponse(200, successEnvelope(record));
  } catch (error: any) {
    log.error({ error }, "Failed to update tenant profile");
    return platformResponse(
      500,
      errorEnvelope("INTERNAL_ERROR", "Failed to update tenant profile"),
    );
  }
}

// ─── Handler: Update Tenant Token Limits ──────────────────────────────────────

function handleUpdateLimits(
  params: Record<string, unknown>,
  registry: TenantRegistryService,
  auditLogger: AuditLogger,
): PlatformResponse {
  const authError = requireAuth(params);
  if (authError) return authError;

  const tenantId = params.tenant_id as string | undefined;
  if (!tenantId) {
    return platformResponse(
      422,
      errorEnvelope("VALIDATION_ERROR", "Missing tenant_id parameter"),
    );
  }

  const existing = registry.getById(tenantId);
  if (!existing) {
    return platformResponse(
      404,
      errorEnvelope(
        "TENANT_NOT_FOUND",
        `Tenant with ID '${tenantId}' does not exist in the registry.`,
        { tenant_id: tenantId },
      ),
    );
  }

  const tokenLimit = params.token_limit;
  if (tokenLimit === undefined || tokenLimit === null) {
    return platformResponse(
      422,
      errorEnvelope("VALIDATION_ERROR", "Missing token_limit parameter"),
    );
  }

  const limitValue = Number(tokenLimit);
  if (!Number.isFinite(limitValue) || !Number.isInteger(limitValue)) {
    return platformResponse(
      422,
      errorEnvelope("VALIDATION_ERROR", "token_limit must be an integer value"),
    );
  }

  if (limitValue < 0) {
    return platformResponse(
      422,
      errorEnvelope(
        "VALIDATION_ERROR",
        "token_limit must be a non-negative integer. Use 0 for unlimited.",
        { provided_value: limitValue },
      ),
    );
  }

  try {
    const record = registry.updateTokenLimit(tenantId, limitValue);

    const actor = getActor(params);
    auditLogger.log("tenant.update_limits", actor, tenantId, {
      previous_token_limit: existing.token_limit,
      new_token_limit: limitValue,
    });

    return platformResponse(200, successEnvelope(record));
  } catch (error: any) {
    log.error({ error }, "Failed to update tenant limits");
    return platformResponse(
      500,
      errorEnvelope("INTERNAL_ERROR", "Failed to update tenant limits"),
    );
  }
}

// ─── Handler: Metrics (Aggregated) ────────────────────────────────────────────

function handleMetrics(
  params: Record<string, unknown>,
  metricsCollector?: UsageMetricsCollector,
): PlatformResponse {
  const authError = requireAuth(params);
  if (authError) return authError;

  if (!metricsCollector) {
    return platformResponse(
      503,
      errorEnvelope(
        "PLATFORM_DISABLED",
        "Metrics collector is not configured.",
      ),
    );
  }

  try {
    // If breakdown=true, return per-tenant breakdown sorted by tokens
    const breakdown = params.breakdown;
    if (
      breakdown === true ||
      breakdown === "true" ||
      breakdown === "1" ||
      breakdown === 1
    ) {
      const breakdownData = metricsCollector.getBreakdown();
      return platformResponse(200, successEnvelope(breakdownData));
    }

    // Default: return aggregated metrics
    const aggregated = metricsCollector.getAggregated();
    return platformResponse(200, successEnvelope(aggregated));
  } catch (error: any) {
    log.error({ error }, "Failed to retrieve metrics");
    return platformResponse(
      500,
      errorEnvelope("INTERNAL_ERROR", "Failed to retrieve metrics"),
    );
  }
}

// ─── Handler: Per-Tenant Metrics ──────────────────────────────────────────────

function handleTenantMetrics(
  params: Record<string, unknown>,
  metricsCollector?: UsageMetricsCollector,
): PlatformResponse {
  const authError = requireAuth(params);
  if (authError) return authError;

  if (!metricsCollector) {
    return platformResponse(
      503,
      errorEnvelope(
        "PLATFORM_DISABLED",
        "Metrics collector is not configured.",
      ),
    );
  }

  const tenantId = params.tenant_id as string | undefined;
  if (!tenantId) {
    return platformResponse(
      422,
      errorEnvelope("VALIDATION_ERROR", "Missing tenant_id parameter"),
    );
  }

  try {
    const from = params.from as string | undefined;
    const to = params.to as string | undefined;

    // If date range provided, use getTenantMetricsInRange
    if (from && to) {
      const metrics = metricsCollector.getTenantMetricsInRange(
        tenantId,
        from,
        to,
      );
      return platformResponse(200, successEnvelope(metrics));
    }

    // Default: return all-time metrics for tenant
    const metrics = metricsCollector.getTenantMetrics(tenantId);
    return platformResponse(200, successEnvelope(metrics));
  } catch (error: any) {
    log.error({ error }, "Failed to retrieve tenant metrics");
    return platformResponse(
      500,
      errorEnvelope("INTERNAL_ERROR", "Failed to retrieve tenant metrics"),
    );
  }
}

// ─── Handler: Get Alerts ──────────────────────────────────────────────────────

function handleGetAlerts(
  params: Record<string, unknown>,
  alertService?: AlertService,
): PlatformResponse {
  const authError = requireAuth(params);
  if (authError) return authError;

  if (!alertService) {
    return platformResponse(
      503,
      errorEnvelope("PLATFORM_DISABLED", "Alert service is not configured."),
    );
  }

  try {
    const alerts = alertService.getActive();
    return platformResponse(200, successEnvelope(alerts));
  } catch (error: any) {
    log.error({ error }, "Failed to retrieve alerts");
    return platformResponse(
      500,
      errorEnvelope("INTERNAL_ERROR", "Failed to retrieve alerts"),
    );
  }
}

// ─── Handler: Acknowledge Alert ───────────────────────────────────────────────

function handleAcknowledgeAlert(
  params: Record<string, unknown>,
  alertService?: AlertService,
  auditLogger?: AuditLogger,
): PlatformResponse {
  const authError = requireAuth(params);
  if (authError) return authError;

  if (!alertService) {
    return platformResponse(
      503,
      errorEnvelope("PLATFORM_DISABLED", "Alert service is not configured."),
    );
  }

  const alertId = params.alert_id as string | undefined;
  if (!alertId) {
    return platformResponse(
      422,
      errorEnvelope("VALIDATION_ERROR", "Missing alert_id parameter"),
    );
  }

  try {
    const alert = alertService.acknowledge(alertId);

    if (!alert) {
      return platformResponse(
        404,
        errorEnvelope(
          "ALERT_NOT_FOUND",
          `Alert with ID '${alertId}' does not exist.`,
          { alert_id: alertId },
        ),
      );
    }

    // Log the acknowledgment via AuditLogger
    if (auditLogger) {
      const actor = getActor(params);
      auditLogger.log("alert.acknowledge", actor, alert.tenant_id, {
        alert_id: alertId,
        alert_type: alert.type,
        alert_severity: alert.severity,
      });
    }

    return platformResponse(200, successEnvelope(alert));
  } catch (error: any) {
    log.error({ error }, "Failed to acknowledge alert");
    return platformResponse(
      500,
      errorEnvelope("INTERNAL_ERROR", "Failed to acknowledge alert"),
    );
  }
}

// ─── Route Setup ────────────────────────────────────────────────────────────

/**
 * Registers all platform API endpoints under /api/platform/.
 *
 * Endpoints registered:
 *   POST /api/platform/auth/login               — Obtain JWT (public, requires PLATFORM_SECRET)
 *   GET  /api/platform/tenants                  — List tenants (filters: profile, status)
 *   POST /api/platform/tenants                  — Create tenant
 *   GET  /api/platform/tenants?id=x             — Get tenant detail
 *   POST /api/platform/tenants/:id/deactivate   — Deactivate tenant
 *   POST /api/platform/tenants/:id/reactivate   — Reactivate tenant
 *   POST /api/platform/tenants/regenerate-key   — Regenerate API key for tenant
 *   PUT  /api/platform/tenants/:id/profile      — Change tenant profile
 *   PUT  /api/platform/tenants/:id/limits       — Set tenant token limit
 *   GET  /api/platform/metrics                  — Aggregated metrics (with optional breakdown)
 *   GET  /api/platform/metrics/tenant           — Per-tenant metrics (requires tenant_id, optional from/to)
 *   GET  /api/platform/alerts                   — Active alerts
 *   POST /api/platform/alerts/acknowledge       — Acknowledge alert (requires alert_id)
 *
 * All endpoints except login require super_admin JWT authentication.
 * All responses use the API envelope format.
 *
 * The handler functions return PlatformResponse objects containing both the
 * HTTP status code (_statusCode) and the response body. Task 11.4 will wire
 * these into HealthServer to produce proper HTTP status codes.
 *
 * @param health - HealthServer instance for route registration
 * @param registry - TenantRegistryService for tenant CRUD
 * @param auditLogger - AuditLogger for write operation logging
 * @param metricsCollector - UsageMetricsCollector for metrics endpoints
 * @param healthCalculator - HealthStatusCalculator for tenant health
 * @param alertService - AlertService for alerts endpoints
 * @param tenantAuthService - TenantAuthService for API key generation and management
 */
export function setupPlatformRoutes(
  health: HealthServer,
  registry: TenantRegistryService,
  auditLogger: AuditLogger,
  metricsCollector?: UsageMetricsCollector,
  healthCalculator?: HealthStatusCalculator,
  alertService?: AlertService,
  tenantAuthService?: TenantAuthService,
): void {
  // ─── POST /api/platform/auth/login ──────────────────────────────────────
  // Public endpoint: validates PLATFORM_SECRET and issues JWT
  health.registerData("platform/auth/login", async (body?: any) => {
    if (!isPlatformEnabled()) {
      return platformResponse(
        503,
        errorEnvelope(
          "PLATFORM_DISABLED",
          "Platform API is not configured. Set PLATFORM_SECRET environment variable.",
        ),
      );
    }

    const parseResult = PlatformLoginSchema.safeParse(body);
    if (!parseResult.success) {
      return platformResponse(
        422,
        errorEnvelope("VALIDATION_ERROR", "Invalid login request body", {
          issues: parseResult.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        }),
      );
    }

    const { secret } = parseResult.data;
    const token = issuePlatformToken(secret);

    if (!token) {
      return platformResponse(
        401,
        errorEnvelope("AUTH_INVALID_TOKEN", "Invalid platform secret"),
      );
    }

    log.info("Platform login successful");
    return platformResponse(200, successEnvelope({ token }));
  });

  // ─── GET/POST /api/platform/tenants ─────────────────────────────────────
  // GET: lists tenants with optional profile/status filters, or detail via ?id=
  // POST: creates a new tenant
  health.registerData("platform/tenants", async (params?: any) => {
    if (!isPlatformEnabled()) {
      return platformResponse(
        503,
        errorEnvelope(
          "PLATFORM_DISABLED",
          "Platform API is not configured. Set PLATFORM_SECRET environment variable.",
        ),
      );
    }

    // Detect POST (create) vs GET (list/detail) by checking for creation fields
    const isCreateRequest =
      params &&
      typeof params.tenant_id === "string" &&
      typeof params.display_name === "string";

    if (isCreateRequest) {
      return handleCreateTenant(
        params,
        registry,
        auditLogger,
        tenantAuthService,
      );
    }

    return handleListOrDetailTenants(params || {}, registry);
  });

  // ─── POST /api/platform/tenants/:id/deactivate ────────────────────────────
  // Sets tenant status to 'inactive'
  health.registerData("platform/tenants/deactivate", async (params?: any) => {
    if (!isPlatformEnabled()) {
      return platformResponse(
        503,
        errorEnvelope(
          "PLATFORM_DISABLED",
          "Platform API is not configured. Set PLATFORM_SECRET environment variable.",
        ),
      );
    }

    return handleDeactivateTenant(params || {}, registry, auditLogger);
  });

  // ─── POST /api/platform/tenants/:id/reactivate ────────────────────────────
  // Sets tenant status back to 'active'
  health.registerData("platform/tenants/reactivate", async (params?: any) => {
    if (!isPlatformEnabled()) {
      return platformResponse(
        503,
        errorEnvelope(
          "PLATFORM_DISABLED",
          "Platform API is not configured. Set PLATFORM_SECRET environment variable.",
        ),
      );
    }

    return handleReactivateTenant(params || {}, registry, auditLogger);
  });

  // ─── POST /api/platform/tenants/regenerate-key ────────────────────────────
  // Regenerates the API key for an existing tenant (super_admin only)
  health.registerData(
    "platform/tenants/regenerate-key",
    async (params?: any) => {
      if (!isPlatformEnabled()) {
        return platformResponse(
          503,
          errorEnvelope(
            "PLATFORM_DISABLED",
            "Platform API is not configured. Set PLATFORM_SECRET environment variable.",
          ),
        );
      }

      return handleRegenerateKey(
        params || {},
        registry,
        auditLogger,
        tenantAuthService,
      );
    },
  );

  // ─── PUT /api/platform/tenants/:id/profile ────────────────────────────────
  // Updates the profile assigned to a tenant
  health.registerData("platform/tenants/profile", async (params?: any) => {
    if (!isPlatformEnabled()) {
      return platformResponse(
        503,
        errorEnvelope(
          "PLATFORM_DISABLED",
          "Platform API is not configured. Set PLATFORM_SECRET environment variable.",
        ),
      );
    }

    return handleUpdateProfile(params || {}, registry, auditLogger);
  });

  // ─── PUT /api/platform/tenants/:id/limits ─────────────────────────────────
  // Sets the token limit for a tenant
  health.registerData("platform/tenants/limits", async (params?: any) => {
    if (!isPlatformEnabled()) {
      return platformResponse(
        503,
        errorEnvelope(
          "PLATFORM_DISABLED",
          "Platform API is not configured. Set PLATFORM_SECRET environment variable.",
        ),
      );
    }

    return handleUpdateLimits(params || {}, registry, auditLogger);
  });

  // ─── GET /api/platform/metrics ────────────────────────────────────────────
  // Returns aggregated metrics with optional breakdown param, or date-range filtered
  health.registerData("platform/metrics", async (params?: any) => {
    if (!isPlatformEnabled()) {
      return platformResponse(
        503,
        errorEnvelope(
          "PLATFORM_DISABLED",
          "Platform API is not configured. Set PLATFORM_SECRET environment variable.",
        ),
      );
    }

    return handleMetrics(params || {}, metricsCollector);
  });

  // ─── GET /api/platform/metrics/tenant ─────────────────────────────────────
  // Returns per-tenant metrics, requires tenant_id param. Supports from/to date range.
  health.registerData("platform/metrics/tenant", async (params?: any) => {
    if (!isPlatformEnabled()) {
      return platformResponse(
        503,
        errorEnvelope(
          "PLATFORM_DISABLED",
          "Platform API is not configured. Set PLATFORM_SECRET environment variable.",
        ),
      );
    }

    return handleTenantMetrics(params || {}, metricsCollector);
  });

  // ─── GET /api/platform/alerts ─────────────────────────────────────────────
  // Returns active (unacknowledged) alerts
  health.registerData("platform/alerts", async (params?: any) => {
    if (!isPlatformEnabled()) {
      return platformResponse(
        503,
        errorEnvelope(
          "PLATFORM_DISABLED",
          "Platform API is not configured. Set PLATFORM_SECRET environment variable.",
        ),
      );
    }

    return handleGetAlerts(params || {}, alertService);
  });

  // ─── POST /api/platform/alerts/acknowledge ────────────────────────────────
  // Acknowledges an alert by ID
  health.registerData("platform/alerts/acknowledge", async (params?: any) => {
    if (!isPlatformEnabled()) {
      return platformResponse(
        503,
        errorEnvelope(
          "PLATFORM_DISABLED",
          "Platform API is not configured. Set PLATFORM_SECRET environment variable.",
        ),
      );
    }

    return handleAcknowledgeAlert(params || {}, alertService, auditLogger);
  });
}

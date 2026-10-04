import { createLogger } from "../config/logger.js";
import type { ILogger } from "../config/ILogger.js";
import type { HealthServer } from "./HealthServer.js";
import type { TenantManager } from "./TenantManager.js";
import type { SettingsManager } from "./SettingsManager.js";
import type { Scheduler } from "../infrastructure/Scheduler.js";
import type { PerfMonitor } from "../infrastructure/PerfMonitor.js";
import type { ReflexMolecule } from "../molecules/ReflexMolecule.js";
import type { LogBuffer } from "./LogBuffer.js";
import type { Registry } from "../config/mergeRegistry.js";
import type { TenantRegistryService } from "./services/TenantRegistryService.js";
import type { UsageMetricsCollector } from "./services/UsageMetricsCollector.js";
import type { HealthStatusCalculator } from "./services/HealthStatusCalculator.js";
import type { AlertService } from "./services/AlertService.js";
import type { AuditLogger } from "./services/AuditLogger.js";
import type { TenantAuthService } from "./services/TenantAuthService.js";
import type { LoginRateLimiter } from "./middleware/loginRateLimiter.js";

import { setupDashboardRoutes } from "./routes/DashboardRoutes.js";
import { setupSchedulerRoutes } from "./routes/SchedulerRoutes.js";
import { setupMonitorRoutes } from "./routes/MonitorRoutes.js";
import { setupRoleRoutes } from "./routes/RoleRoutes.js";
import { setupTemplateRoutes } from "./routes/TemplateRoutes.js";
import { setupReflexRoutes } from "./routes/ReflexRoutes.js";
import { setupCircuitBreakerRoutes } from "./routes/CircuitBreakerRoutes.js";
import { setupMutationRoutes } from "./routes/MutationRoutes.js";
import { setupRegistryRoutes } from "./routes/RegistryRoutes.js";
import { setupWebSocketRoutes } from "./routes/WebSocketRoutes.js";
import { setupLogRoutes } from "./routes/LogRoutes.js";
import { setupSettingsRoutes } from "./routes/SettingsRoutes.js";
import { setupPlatformRoutes } from "./routes/PlatformRoutes.js";
import { setupTenantAuthRoutes } from "./routes/TenantAuthRoutes.js";
import { TenantRegistryService as TenantRegistryServiceImpl } from "./services/TenantRegistryService.js";
import { AuditLogger as AuditLoggerImpl } from "./services/AuditLogger.js";

/**
 * Dependencias tipadas que necesita el conjunto de rutas del servidor.
 * Reemplaza las dependencias implícitas dispersas en ProductionServer por un
 * único objeto explícito. Las dependencias de plataforma son opcionales —
 * están ausentes cuando el modo plataforma está deshabilitado.
 */
export interface RouteDependencies {
  tenantManager: TenantManager;
  settingsManager: SettingsManager;
  scheduler: Scheduler;
  logBuffer: LogBuffer;
  reflexMolecule: ReflexMolecule;
  perfMonitor: PerfMonitor;
  composedRegistry: Registry;
  // ── Auth de tenant (opcional, requiere plataforma) ──
  tenantAuthService?: TenantAuthService;
  loginRateLimiter?: LoginRateLimiter;
  // ── Plataforma (opcional) ──
  platformRegistry?: TenantRegistryService;
  platformAuditLogger?: AuditLogger;
  platformMetricsCollector?: UsageMetricsCollector;
  platformHealthCalculator?: HealthStatusCalculator;
  platformAlertService?: AlertService;
}

/** Registro de una ruta: nombre para trazabilidad + función de setup. */
export interface RouteRegistration {
  name: string;
  setup: (server: HealthServer, deps: RouteDependencies) => void;
}

/**
 * Tabla central de rutas. Agregar una nueva ruta al sistema se reduce a
 * añadir una entrada aquí, sin tocar ProductionServer.
 */
const ROUTE_REGISTRATIONS: RouteRegistration[] = [
  {
    name: "Dashboard",
    setup: (s, d) =>
      setupDashboardRoutes(s, d.tenantManager, d.tenantAuthService),
  },
  {
    name: "Scheduler",
    setup: (s, d) =>
      setupSchedulerRoutes(
        s,
        d.scheduler,
        d.tenantManager,
        d.tenantAuthService,
      ),
  },
  {
    name: "Monitor",
    setup: (s, d) => setupMonitorRoutes(s, d.scheduler, d.tenantManager),
  },
  { name: "Role", setup: (s) => setupRoleRoutes(s) },
  { name: "Template", setup: (s) => setupTemplateRoutes(s) },
  {
    name: "Reflex",
    setup: (s, d) => setupReflexRoutes(s, d.reflexMolecule, d.perfMonitor),
  },
  { name: "CircuitBreaker", setup: (s) => setupCircuitBreakerRoutes(s, []) },
  {
    name: "Mutation",
    setup: (s, d) => setupMutationRoutes(s, d.tenantManager),
  },
  {
    name: "Registry",
    setup: (s, d) => setupRegistryRoutes(s, d.composedRegistry),
  },
  {
    name: "WebSocket",
    setup: (s, d) => setupWebSocketRoutes(s, d.tenantManager),
  },
  { name: "Log", setup: (s, d) => setupLogRoutes(s, d.logBuffer) },
  {
    name: "Settings",
    setup: (s, d) => setupSettingsRoutes(s, d.settingsManager),
  },
  {
    name: "TenantAuth",
    setup: (s, d) => {
      // Solo se registra cuando el auth de tenant está disponible.
      if (d.tenantAuthService && d.loginRateLimiter) {
        setupTenantAuthRoutes(
          s,
          d.tenantAuthService,
          d.loginRateLimiter,
          d.platformAuditLogger,
        );
      }
    },
  },
  {
    name: "Platform",
    setup: (s, d) => {
      // Con servicios reales si la plataforma está habilitada; en caso contrario
      // se registran rutas dummy que responden 503 vía isPlatformEnabled().
      if (d.platformRegistry && d.platformAuditLogger) {
        setupPlatformRoutes(
          s,
          d.platformRegistry,
          d.platformAuditLogger,
          d.platformMetricsCollector,
          d.platformHealthCalculator,
          d.platformAlertService,
          d.tenantAuthService,
        );
      } else {
        const dummyRegistry = new TenantRegistryServiceImpl();
        const dummyAuditLogger = new AuditLoggerImpl();
        setupPlatformRoutes(s, dummyRegistry, dummyAuditLogger);
      }
    },
  },
];

/**
 * Registra todas las rutas del sistema con manejo de errores individual.
 * Si una ruta falla al registrarse, se loggea y se continúa con las restantes.
 *
 * @returns Nombres de rutas registradas y fallidas.
 */
export function registerAllRoutes(
  server: HealthServer,
  deps: RouteDependencies,
  logger: ILogger = createLogger("RouteRegistry"),
): { registered: string[]; failed: string[] } {
  const registered: string[] = [];
  const failed: string[] = [];

  for (const route of ROUTE_REGISTRATIONS) {
    try {
      route.setup(server, deps);
      registered.push(route.name);
    } catch (err: any) {
      logger.error(`Route registration failed: ${route.name}`, {
        error: err?.message ?? String(err),
      });
      failed.push(route.name);
    }
  }

  logger.info(
    `Routes registered: ${registered.length}/${ROUTE_REGISTRATIONS.length}`,
    { registered, failed },
  );

  return { registered, failed };
}

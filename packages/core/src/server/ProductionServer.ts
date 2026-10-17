import {
  initTelemetry,
  createLogger,
  registerLogHook,
} from "../config/logger.js";
initTelemetry();

import * as dotenv from "dotenv";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { HealthServer } from "./HealthServer.js";
import { TenantManager } from "./TenantManager.js";
import { ReplServer } from "./ReplServer.js";
import { Scheduler } from "../infrastructure/Scheduler.js";
import { PerfMonitor } from "../infrastructure/PerfMonitor.js";
import { ReflexMolecule } from "../molecules/ReflexMolecule.js";
import { seedReflexes } from "../system/reflexSeed.js";
import { LogBuffer } from "./LogBuffer.js";
import { handleLogSSE } from "./routes/LogRoutes.js";
import { registerAllRoutes } from "./RouteRegistry.js";
import { SettingsManager } from "./SettingsManager.js";
import { TemplateStateStore } from "./TemplateStateStore.js";
import { UnifiedCortex } from "../system/implementations/UnifiedCortex.js";
import type { Registry } from "../config/mergeRegistry.js";
import { isPlatformEnabled } from "./middleware/platformAuth.js";
import { initializePlatformSchema } from "./services/platformSchema.js";
import { TenantRegistryService } from "./services/TenantRegistryService.js";
import { UsageMetricsCollector } from "./services/UsageMetricsCollector.js";
import { HealthStatusCalculator } from "./services/HealthStatusCalculator.js";
import { AlertService } from "./services/AlertService.js";
import { AuditLogger } from "./services/AuditLogger.js";
import { TenantAuthService } from "./services/TenantAuthService.js";
import { LoginRateLimiter } from "./middleware/loginRateLimiter.js";
import Database from "better-sqlite3";

dotenv.config();

const log = createLogger("ProductionServer");
const require = createRequire(import.meta.url);

/**
 * Entry point de producción con multi-tenancy.
 * Cada cliente (identificado por tenantId) tiene su propio Cortex aislado.
 */
async function main() {
  log.info("Iniciando BioCore en modo producción");

  // 0. Auto-seed de reflexes si la BD está vacía
  try {
    const reflexDb = new ReflexMolecule();
    await reflexDb.initialize();
    if (reflexDb.list().length === 0) {
      log.info("BD de reflexes vacía — ejecutando seed inicial...");
      const total = await seedReflexes(reflexDb);
      log.info({ total }, "Reflexes pre-cargados correctamente");
    } else {
      log.info(
        { total: reflexDb.list().length },
        "Reflexes ya presentes, omitiendo seed",
      );
    }
    await reflexDb.dispose();
  } catch (err: any) {
    log.warn(
      { error: err.message },
      "No se pudo ejecutar auto-seed de reflexes (no crítico)",
    );
  }

  // 1. Core registry — domain applications inject their composition at their entrypoint.
  const composedRegistry = require("../config/registry.json") as Registry;
  log.info(
    { totalCells: composedRegistry.cells.length },
    "Core registry loaded",
  );

  const scheduler = new Scheduler();
  const health = new HealthServer();
  const perfMonitor = new PerfMonitor();
  const logBuffer = new LogBuffer(1000);

  // Connect LogBuffer to Pino logger via onWrite hook
  // This captures all log entries and feeds them to the SSE stream
  registerLogHook((logObj: Record<string, unknown>) => {
    const PINO_LEVEL_MAP: Record<number, string> = {
      10: "debug",
      20: "debug",
      30: "info",
      40: "warn",
      50: "error",
      60: "error",
    };
    logBuffer.push({
      timestamp: (logObj.time as number) || Date.now(),
      level: (PINO_LEVEL_MAP[logObj.level as number] || "info") as
        | "debug"
        | "info"
        | "warn"
        | "error",
      component: (logObj.component as string) || "unknown",
      message: (logObj.msg as string) || "",
      metadata: undefined,
    });
  });

  // Inicializar ReflexMolecule persistente para las rutas del dashboard
  const reflexMolecule = new ReflexMolecule(
    process.env.DATABASE_PATH || "./biocore.db",
    perfMonitor,
  );
  await reflexMolecule.initialize();

  // ─── Platform Super Admin Services ──────────────────────────────────────────
  // Initialize platform services only if PLATFORM_SECRET is configured.
  // When not configured, platform routes will return 503 (handled by isPlatformEnabled() checks in PlatformRoutes).
  let platformRegistry: TenantRegistryService | undefined;
  let platformAuditLogger: AuditLogger | undefined;
  let platformMetricsCollector: UsageMetricsCollector | undefined;
  let platformHealthCalculator: HealthStatusCalculator | undefined;
  let platformAlertService: AlertService | undefined;
  let platformDb: InstanceType<typeof Database> | undefined;

  if (isPlatformEnabled()) {
    try {
      const sharedDbPath =
        process.env.DATABASE_PATH || "./data/biocore-shared.db";
      platformDb = new Database(sharedDbPath);
      platformDb.pragma("journal_mode = WAL");

      // Create platform tables if they don't exist
      initializePlatformSchema(platformDb);

      // Instantiate and initialize platform services
      platformRegistry = new TenantRegistryService();
      platformRegistry.initialize(platformDb);

      platformAuditLogger = new AuditLogger();
      platformAuditLogger.initialize(platformDb);

      platformMetricsCollector = new UsageMetricsCollector();
      platformMetricsCollector.initialize(platformDb);

      platformHealthCalculator = new HealthStatusCalculator(
        platformMetricsCollector,
      );

      platformAlertService = new AlertService();
      platformAlertService.initialize(platformDb);

      log.info("Platform Super Admin services initialized");
    } catch (err: any) {
      log.error(
        { error: err.message },
        "Failed to initialize platform services — platform endpoints will return 503",
      );
      // Clean up partially initialized services
      platformRegistry = undefined;
      platformAuditLogger = undefined;
      platformMetricsCollector = undefined;
      platformHealthCalculator = undefined;
      platformAlertService = undefined;
      if (platformDb) {
        platformDb.close();
        platformDb = undefined;
      }
    }
  } else {
    log.warn(
      "PLATFORM_SECRET not configured — Platform API endpoints disabled (503)",
    );
  }

  // TenantManager is created only after platform services so every traffic
  // Cortex receives the same registry/metrics dependencies when available.
  const tenantManager = new TenantManager({
    registry: platformRegistry,
    metrics: platformMetricsCollector,
  });
  if (platformRegistry) {
    platformRegistry.setProfileChangeCallback((tenantId) => {
      tenantManager.markForReload(tenantId);
    });
  }

  // Settings subsystem: TenantManager is authoritative for traffic config.
  const templateStateStore = new TemplateStateStore(
    process.env.DATABASE_PATH || "./data/biocore-shared.db",
  );
  const cortex = new UnifiedCortex({
    metrics: platformMetricsCollector,
    tenantLimits: platformRegistry,
  });
  const settingsManager = new SettingsManager({
    cortex,
    tenantManager,
    templateState: templateStateStore,
  });

  // ─── Tenant Auth Services ─────────────────────────────────────────────────
  // Instantiate tenant authentication services when platform is available.
  let tenantAuthService: TenantAuthService | undefined;
  const loginRateLimiter = new LoginRateLimiter();

  if (platformRegistry) {
    tenantAuthService = new TenantAuthService(platformRegistry);
    log.info("Tenant Auth services initialized");
  }

  health.start(Number(process.env.PORT) || 3000);
  health.registerCheck("system", async () => true);
  health.registerCheck("scheduler", async () => scheduler.size >= 0);

  // Registro centralizado de todas las rutas (RouteRegistry).
  // Platform y TenantAuth se registran condicionalmente según los servicios
  // disponibles; si la plataforma no está habilitada, las rutas responden 503.
  registerAllRoutes(health, {
    tenantManager,
    settingsManager,
    scheduler,
    logBuffer,
    reflexMolecule,
    perfMonitor,
    composedRegistry,
    tenantAuthService,
    loginRateLimiter,
    platformRegistry,
    platformAuditLogger,
    platformMetricsCollector,
    platformHealthCalculator,
    platformAlertService,
  });

  // Registrar SSE handler para logs/stream
  health.registerSSEHandler("logs/stream", (req, res) => {
    handleLogSSE(req, res, logBuffer);
  });

  health.registerStreamHandler((tenantId, message, signal) =>
    tenantManager.chatStream(tenantId, message, signal),
  );

  log.info("BioCore multi-tenant listo");

  const repl = new ReplServer(tenantManager, scheduler, health);
  repl.start();

  const shutdown = async (signal: string) => {
    log.info({ signal }, "Señal de cierre recibida — cerrando servidor...");
    repl.close();
    templateStateStore.close();

    // Dispose platform services
    loginRateLimiter.dispose();
    if (platformRegistry) platformRegistry.dispose();
    if (platformAuditLogger) platformAuditLogger.dispose();
    if (platformMetricsCollector) platformMetricsCollector.dispose();
    if (platformAlertService) platformAlertService.dispose();
    if (platformDb) {
      platformDb.close();
      log.info("Platform database closed");
    }

    await health.stop();
    log.info("Servidor cerrado correctamente");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    log.error({ error: err.message }, "Error fatal");
    process.exit(1);
  });
}

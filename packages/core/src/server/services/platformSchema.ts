import type Database from "better-sqlite3";
import { createLogger } from "../../config/logger.js";

const log = createLogger("PlatformSchema");

/**
 * Inicializa el esquema de base de datos para la plataforma Super Admin.
 *
 * Tablas creadas:
 *   - platform_tenants: Registro de todos los tenants de la plataforma
 *   - platform_metrics: Eventos de métricas de uso (append-only)
 *   - platform_alerts: Alertas generadas por el sistema
 *   - platform_audit: Log de auditoría de operaciones write
 *   - platform_profile_changes: Historial de cambios de perfil por tenant
 *
 * Indexes:
 *   - idx_metrics_tenant_time: Búsqueda eficiente por tenant + rango temporal
 *   - idx_metrics_time: Búsqueda eficiente por rango temporal global
 *   - idx_alerts_active: Alertas activas ordenadas por severidad y fecha
 *   - idx_audit_time: Búsqueda de auditoría por timestamp
 */
/** Perfiles aceptados en platform_tenants. Incluye 'domain' (perfil del template). */
const PLATFORM_TENANT_PROFILES = [
  "dev",
  "domain",
  "restaurant",
  "clinic",
  "ecommerce",
] as const;

/**
 * Reconstruye platform_tenants si su CHECK de profile no incluye 'domain'.
 * SQLite no permite cambiar un CHECK con ALTER, así que se crea la tabla nueva,
 * se copian las filas y se renombra. Es idempotente: si el CHECK ya tiene 'domain', no hace nada.
 */
function migratePlatformTenantsProfiles(
  db: InstanceType<typeof Database>,
): void {
  const table = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'platform_tenants'",
    )
    .get() as { sql: string } | undefined;
  if (!table || table.sql.includes("'domain'")) return;

  const profiles = PLATFORM_TENANT_PROFILES.map((p) => `'${p}'`).join(", ");

  // foreign_keys debe apagarse fuera de la transacción para poder reemplazar la tabla padre.
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE platform_tenants_new (
          tenant_id     TEXT PRIMARY KEY,
          display_name  TEXT NOT NULL,
          profile       TEXT NOT NULL CHECK(profile IN (${profiles})),
          status        TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'degraded')),
          token_limit   INTEGER NOT NULL DEFAULT 0,
          api_key_hash  TEXT,
          api_key_role  TEXT NOT NULL DEFAULT 'viewer' CHECK(api_key_role IN ('viewer', 'operator', 'admin')),
          created_at    TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
          last_activity TEXT
        )
      `);
      db.exec(`
        INSERT INTO platform_tenants_new
          (tenant_id, display_name, profile, status, token_limit, api_key_hash, api_key_role, created_at, updated_at, last_activity)
        SELECT tenant_id, display_name, profile, status, token_limit, api_key_hash, api_key_role, created_at, updated_at, last_activity
        FROM platform_tenants
      `);
      db.exec("DROP TABLE platform_tenants");
      db.exec("ALTER TABLE platform_tenants_new RENAME TO platform_tenants");
    })();

    const violations = db.pragma("foreign_key_check") as unknown[];
    if (violations.length > 0) {
      log.warn("Claves foráneas rotas tras reconstruir platform_tenants", {
        violations: violations.length,
      });
    }
    log.info("Migration: platform_tenants acepta el perfil 'domain'");
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

/**
 * Registra el tenant del despliegue en platform_tenants si no existe.
 * Las métricas referencian platform_tenants, así que sin esta fila fallan con FOREIGN KEY.
 */
export function ensureTenantRecord(
  db: InstanceType<typeof Database>,
  tenantId: string,
  profile: string,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO platform_tenants (tenant_id, display_name, profile, status, token_limit)
     VALUES (?, ?, ?, 'active', 0)`,
  ).run(tenantId, tenantId, profile);
}

export function initializePlatformSchema(
  db: InstanceType<typeof Database>,
): void {
  // ─── Tenant Registry ────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_tenants (
      tenant_id     TEXT PRIMARY KEY,
      display_name  TEXT NOT NULL,
      profile       TEXT NOT NULL CHECK(profile IN ('dev', 'restaurant', 'clinic', 'ecommerce')),
      status        TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'degraded')),
      token_limit   INTEGER NOT NULL DEFAULT 0,
      api_key_hash  TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      last_activity TEXT
    )
  `);

  // ─── Migration: Add api_key_hash column for existing databases ──────────────
  try {
    db.exec(`ALTER TABLE platform_tenants ADD COLUMN api_key_hash TEXT`);
    log.info("Migration: added api_key_hash column to platform_tenants");
  } catch {
    // Column already exists — safe to ignore (SQLite throws if column exists)
  }

  // Rol máximo de la clave. Las claves existentes quedan en 'viewer' (mínimo
  // privilegio) hasta regenerarlas con el rol que corresponda.
  try {
    db.exec(
      `ALTER TABLE platform_tenants ADD COLUMN api_key_role TEXT NOT NULL DEFAULT 'viewer' CHECK(api_key_role IN ('viewer', 'operator', 'admin'))`,
    );
    log.info("Migration: added api_key_role column to platform_tenants");
  } catch {
    // Column already exists — safe to ignore
  }

  migratePlatformTenantsProfiles(db);

  // ─── Usage Metrics (append-only event log) ──────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_metrics (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id   TEXT NOT NULL,
      event_type  TEXT NOT NULL CHECK(event_type IN ('tokens', 'task_completed', 'task_error', 'cortex_error')),
      value       INTEGER NOT NULL DEFAULT 0,
      timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES platform_tenants(tenant_id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_metrics_tenant_time
    ON platform_metrics(tenant_id, timestamp)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_metrics_time
    ON platform_metrics(timestamp)
  `);

  // ─── Alerts ─────────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_alerts (
      id              TEXT PRIMARY KEY,
      severity        TEXT NOT NULL CHECK(severity IN ('critical', 'warning', 'info')),
      type            TEXT NOT NULL,
      message         TEXT NOT NULL,
      details         TEXT NOT NULL DEFAULT '{}',
      tenant_id       TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      acknowledged    INTEGER NOT NULL DEFAULT 0,
      acknowledged_at TEXT
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_alerts_active
    ON platform_alerts(acknowledged, severity, created_at)
  `);

  // ─── Audit Log ──────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_audit (
      id            TEXT PRIMARY KEY,
      action        TEXT NOT NULL,
      actor         TEXT NOT NULL,
      target_tenant TEXT,
      details       TEXT NOT NULL DEFAULT '{}',
      timestamp     TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_time
    ON platform_audit(timestamp)
  `);

  // ─── Profile Change History ─────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_profile_changes (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id        TEXT NOT NULL,
      previous_profile TEXT NOT NULL,
      new_profile      TEXT NOT NULL,
      changed_at       TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES platform_tenants(tenant_id)
    )
  `);

  log.info("Platform schema inicializado correctamente");
}

import Database from "better-sqlite3";
import type DatabaseType from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { createLogger } from "../../config/logger.js";

const log = createLogger("TenantRegistryService");

// ─── Zod Schemas ────────────────────────────────────────────────────────────

export const TenantStatusSchema = z.enum(["active", "inactive", "degraded"]);
export type TenantStatus = z.infer<typeof TenantStatusSchema>;

export const TenantProfileSchema = z.enum([
  "dev",
  "restaurant",
  "clinic",
  "ecommerce",
]);
export type TenantProfileType = z.infer<typeof TenantProfileSchema>;

export const TenantRecordSchema = z.object({
  tenant_id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  display_name: z.string().min(1).max(128),
  profile: TenantProfileSchema,
  status: TenantStatusSchema.default("active"),
  created_at: z.string(),
  updated_at: z.string(),
  token_limit: z.number().int().min(0).default(0),
  last_activity: z.string().nullable(),
});

export type TenantRecord = z.infer<typeof TenantRecordSchema>;

export const CreateTenantSchema = z.object({
  tenant_id: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-z0-9-]+$/,
      "tenant_id must be lowercase alphanumeric with hyphens",
    ),
  display_name: z.string().min(1).max(128),
  profile: TenantProfileSchema,
  token_limit: z.number().int().min(0).optional(),
});

export type CreateTenantInput = z.infer<typeof CreateTenantSchema>;

export interface TenantListFilter {
  profile?: TenantProfileType;
  status?: TenantStatus;
}

// ─── Raw DB Row Type ────────────────────────────────────────────────────────

interface TenantRow {
  tenant_id: string;
  display_name: string;
  profile: string;
  status: string;
  token_limit: number;
  created_at: string;
  updated_at: string;
  last_activity: string | null;
  api_key_hash: string | null;
}

// ─── Callback type for profile change notifications ─────────────────────────

/**
 * Callback invoked when a tenant's profile is changed.
 * Used to notify external systems (e.g. TenantManager) that an active
 * session should be marked for reload on its next request cycle.
 */
export type ProfileChangeCallback = (tenantId: string) => void;

// ─── TenantRegistryService ──────────────────────────────────────────────────

/**
 * TenantRegistryService — Gestiona el registro de tenants en la plataforma.
 *
 * Usa la tabla `platform_tenants` del schema compartido (creada por platformSchema.ts).
 * Al crear un tenant, inicializa un archivo de base de datos aislado en `data/tenants/{tenant_id}.db`.
 */
export class TenantRegistryService {
  private db: InstanceType<typeof DatabaseType> | null = null;
  private readonly tenantsDataDir: string;
  private onProfileChange: ProfileChangeCallback | null = null;

  constructor(tenantsDataDir?: string) {
    this.tenantsDataDir =
      tenantsDataDir ?? join(process.cwd(), "data", "tenants");
  }

  /**
   * Registers a callback that will be invoked when a tenant's profile changes.
   * This allows external systems (like TenantManager) to react to profile changes
   * by marking the active session for reload on the next request cycle.
   *
   * @param callback - Function that receives the tenantId when profile changes
   */
  setProfileChangeCallback(callback: ProfileChangeCallback): void {
    this.onProfileChange = callback;
  }

  /**
   * Inicializa el servicio con una instancia de base de datos compartida.
   * La tabla `platform_tenants` debe existir previamente (creada por platformSchema.ts).
   */
  initialize(db: InstanceType<typeof DatabaseType>): void {
    this.db = db;
    log.info("TenantRegistryService inicializado");
  }

  /**
   * Crea un nuevo tenant en el registro y su base de datos aislada.
   *
   * @throws Error si el tenant_id ya existe
   * @throws ZodError si la validación de input falla
   */
  create(input: CreateTenantInput): TenantRecord {
    if (!this.db) {
      throw new Error(
        "TenantRegistryService not initialized — call initialize() first",
      );
    }

    // Validate input with Zod
    const validated = CreateTenantSchema.parse(input);

    // Check for duplicate tenant_id
    if (this.exists(validated.tenant_id)) {
      throw new Error(
        `Tenant with ID '${validated.tenant_id}' already exists in the registry`,
      );
    }

    const now = new Date().toISOString();
    const tokenLimit = validated.token_limit ?? 0;

    // Insert record into platform_tenants
    const stmt = this.db.prepare(`
      INSERT INTO platform_tenants (tenant_id, display_name, profile, status, token_limit, created_at, updated_at, last_activity)
      VALUES (?, ?, ?, 'active', ?, ?, ?, NULL)
    `);

    stmt.run(
      validated.tenant_id,
      validated.display_name,
      validated.profile,
      tokenLimit,
      now,
      now,
    );

    // Initialize isolated tenant DB file
    this.initializeTenantDb(validated.tenant_id);

    const record: TenantRecord = {
      tenant_id: validated.tenant_id,
      display_name: validated.display_name,
      profile: validated.profile,
      status: "active",
      token_limit: tokenLimit,
      created_at: now,
      updated_at: now,
      last_activity: null,
    };

    log.info(
      { tenantId: validated.tenant_id, profile: validated.profile },
      "Tenant creado",
    );

    return record;
  }

  /**
   * Obtiene un tenant por su ID.
   *
   * @returns TenantRecord o null si no existe
   */
  getById(tenantId: string): TenantRecord | null {
    if (!this.db) {
      throw new Error(
        "TenantRegistryService not initialized — call initialize() first",
      );
    }

    const stmt = this.db.prepare(`
      SELECT tenant_id, display_name, profile, status, token_limit, created_at, updated_at, last_activity
      FROM platform_tenants
      WHERE tenant_id = ?
    `);

    const row = stmt.get(tenantId) as TenantRow | undefined;

    if (!row) {
      return null;
    }

    return this.rowToRecord(row);
  }

  /**
   * Lista todos los tenants con filtros opcionales, ordenados por created_at DESC.
   */
  list(filter?: TenantListFilter): TenantRecord[] {
    if (!this.db) {
      throw new Error(
        "TenantRegistryService not initialized — call initialize() first",
      );
    }

    let sql = `
      SELECT tenant_id, display_name, profile, status, token_limit, created_at, updated_at, last_activity
      FROM platform_tenants
    `;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.profile) {
      conditions.push("profile = ?");
      params.push(filter.profile);
    }

    if (filter?.status) {
      conditions.push("status = ?");
      params.push(filter.status);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }

    sql += " ORDER BY created_at DESC";

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as TenantRow[];

    return rows.map((row) => this.rowToRecord(row));
  }

  /**
   * Actualiza el status de un tenant (active/inactive).
   *
   * @throws Error si el tenant no existe
   */
  updateStatus(tenantId: string, status: TenantStatus): TenantRecord {
    if (!this.db) {
      throw new Error(
        "TenantRegistryService not initialized — call initialize() first",
      );
    }

    // Validate status
    TenantStatusSchema.parse(status);

    const existing = this.getById(tenantId);
    if (!existing) {
      throw new Error(
        `Tenant with ID '${tenantId}' does not exist in the registry`,
      );
    }

    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE platform_tenants
      SET status = ?, updated_at = ?
      WHERE tenant_id = ?
    `);

    stmt.run(status, now, tenantId);

    log.info({ tenantId, status }, "Tenant status actualizado");

    return { ...existing, status, updated_at: now };
  }

  /**
   * Actualiza el perfil de un tenant.
   *
   * @throws Error si el tenant no existe o el perfil es inválido
   * @returns Objeto con el record actualizado y el perfil anterior
   */
  updateProfile(
    tenantId: string,
    newProfile: TenantProfileType,
  ): { record: TenantRecord; previousProfile: TenantProfileType } {
    if (!this.db) {
      throw new Error(
        "TenantRegistryService not initialized — call initialize() first",
      );
    }

    // Validate profile
    TenantProfileSchema.parse(newProfile);

    const existing = this.getById(tenantId);
    if (!existing) {
      throw new Error(
        `Tenant with ID '${tenantId}' does not exist in the registry`,
      );
    }

    const previousProfile = existing.profile;
    const now = new Date().toISOString();

    // Update profile
    const updateStmt = this.db.prepare(`
      UPDATE platform_tenants
      SET profile = ?, updated_at = ?
      WHERE tenant_id = ?
    `);
    updateStmt.run(newProfile, now, tenantId);

    // Record profile change in history table
    const historyStmt = this.db.prepare(`
      INSERT INTO platform_profile_changes (tenant_id, previous_profile, new_profile, changed_at)
      VALUES (?, ?, ?, ?)
    `);
    historyStmt.run(tenantId, previousProfile, newProfile, now);

    log.info(
      { tenantId, previousProfile, newProfile },
      "Tenant profile actualizado",
    );

    // Notify external systems (e.g. TenantManager) to mark active session for reload
    // Requirement 6.4: mark session for reload on next request cycle when profile changes
    if (this.onProfileChange) {
      this.onProfileChange(tenantId);
    }

    return {
      record: { ...existing, profile: newProfile, updated_at: now },
      previousProfile,
    };
  }

  /**
   * Actualiza el token_limit de un tenant.
   *
   * @throws Error si el tenant no existe o el límite es inválido
   */
  updateTokenLimit(tenantId: string, limit: number): TenantRecord {
    if (!this.db) {
      throw new Error(
        "TenantRegistryService not initialized — call initialize() first",
      );
    }

    if (!Number.isInteger(limit) || limit < 0) {
      throw new Error(
        `Token limit must be a non-negative integer, got: ${limit}`,
      );
    }

    const existing = this.getById(tenantId);
    if (!existing) {
      throw new Error(
        `Tenant with ID '${tenantId}' does not exist in the registry`,
      );
    }

    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE platform_tenants
      SET token_limit = ?, updated_at = ?
      WHERE tenant_id = ?
    `);

    stmt.run(limit, now, tenantId);

    log.info({ tenantId, limit }, "Tenant token_limit actualizado");

    return { ...existing, token_limit: limit, updated_at: now };
  }

  /**
   * Verifica si un tenant existe en el registro.
   */
  exists(tenantId: string): boolean {
    if (!this.db) {
      throw new Error(
        "TenantRegistryService not initialized — call initialize() first",
      );
    }

    const stmt = this.db.prepare(`
      SELECT 1 FROM platform_tenants WHERE tenant_id = ?
    `);

    return stmt.get(tenantId) !== undefined;
  }

  /**
   * Actualiza el timestamp de last_activity de un tenant.
   */
  touchActivity(tenantId: string): void {
    if (!this.db) {
      throw new Error(
        "TenantRegistryService not initialized — call initialize() first",
      );
    }

    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE platform_tenants
      SET last_activity = ?, updated_at = ?
      WHERE tenant_id = ?
    `);

    stmt.run(now, now, tenantId);

    log.debug({ tenantId }, "Tenant last_activity actualizado");
  }

  /**
   * Store the bcrypt hash of an API key for a tenant.
   */
  setApiKeyHash(tenantId: string, hash: string): void {
    if (!this.db) {
      throw new Error(
        "TenantRegistryService not initialized — call initialize() first",
      );
    }

    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE platform_tenants
      SET api_key_hash = ?, updated_at = ?
      WHERE tenant_id = ?
    `);

    stmt.run(hash, now, tenantId);

    log.info({ tenantId }, "API key hash actualizado");
  }

  /**
   * Get the stored API key hash for a tenant.
   * Returns null if no key is set.
   */
  getApiKeyHash(tenantId: string): string | null {
    if (!this.db) {
      throw new Error(
        "TenantRegistryService not initialized — call initialize() first",
      );
    }

    const stmt = this.db.prepare(`
      SELECT api_key_hash
      FROM platform_tenants
      WHERE tenant_id = ?
    `);

    const row = stmt.get(tenantId) as
      | { api_key_hash: string | null }
      | undefined;

    if (!row) {
      return null;
    }

    return row.api_key_hash;
  }

  /**
   * Get all active tenants that have an api_key_hash set (not null).
   * Used during login to find the tenant matching a provided API key.
   */
  getActiveTenantsWithKeys(): Array<{
    tenant_id: string;
    api_key_hash: string;
    profile: string;
    status: string;
  }> {
    if (!this.db) {
      throw new Error(
        "TenantRegistryService not initialized — call initialize() first",
      );
    }

    const stmt = this.db.prepare(`
      SELECT tenant_id, api_key_hash, profile, status
      FROM platform_tenants
      WHERE status = 'active' AND api_key_hash IS NOT NULL
    `);

    const rows = stmt.all() as Array<{
      tenant_id: string;
      api_key_hash: string;
      profile: string;
      status: string;
    }>;

    return rows;
  }

  /**
   * Get masked API key representation for a tenant.
   * Since we only store the hash (not the raw key), this method returns
   * a placeholder indicator if a key exists, or null if not set.
   * The raw key is only shown once at creation/regeneration.
   */
  getMaskedApiKey(tenantId: string): string | null {
    if (!this.db) {
      throw new Error(
        "TenantRegistryService not initialized — call initialize() first",
      );
    }

    const hash = this.getApiKeyHash(tenantId);

    if (!hash) {
      return null;
    }

    return "****...****";
  }

  /**
   * Limpia recursos. Desvincula la referencia a la base de datos.
   */
  dispose(): void {
    this.db = null;
    log.info("TenantRegistryService disposed");
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Inicializa la base de datos aislada para un tenant.
   * Crea el directorio si no existe y abre/cierra una conexión para generar el archivo.
   */
  private initializeTenantDb(tenantId: string): void {
    if (!existsSync(this.tenantsDataDir)) {
      mkdirSync(this.tenantsDataDir, { recursive: true });
      log.info({ dir: this.tenantsDataDir }, "Directorio de tenants creado");
    }

    const dbPath = join(this.tenantsDataDir, `${tenantId}.db`);

    // Create the DB file by opening and immediately closing a connection
    const tenantDb = new Database(dbPath);
    tenantDb.pragma("journal_mode = WAL");
    tenantDb.close();

    log.debug({ tenantId, dbPath }, "Tenant DB aislada inicializada");
  }

  /**
   * Convierte una fila raw de SQLite a TenantRecord tipado.
   */
  private rowToRecord(row: TenantRow): TenantRecord {
    return {
      tenant_id: row.tenant_id,
      display_name: row.display_name,
      profile: row.profile as TenantProfileType,
      status: row.status as TenantStatus,
      token_limit: row.token_limit,
      created_at: row.created_at,
      updated_at: row.updated_at,
      last_activity: row.last_activity,
    };
  }
}

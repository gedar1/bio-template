import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "../config/logger.js";

const log = createLogger("TenantDatabaseManager");

/**
 * TenantDatabaseManager — Gestiona bases de datos aisladas por tenant.
 *
 * Estructura:
 *   data/
 *   ├── biocore-shared.db     → reflexes, embeddings, métricas (compartido)
 *   └── tenants/
 *       ├── buen-sabor.db     → datos de negocio del tenant
 *       ├── la-esquina.db     → datos de negocio del tenant
 *       └── clinica-x.db      → datos de negocio del tenant
 *
 * La BD compartida se usa para:
 *   - ReflexMolecule (memoria procedural compartida entre tenants del mismo perfil)
 *   - PerfMonitor (métricas globales)
 *   - Configuración del sistema
 *
 * La BD por tenant se usa para:
 *   - OrderMolecule, InventoryMolecule, DeliveryMolecule (restaurantes)
 *   - AgendaMolecule, PatientMolecule (clínicas)
 *   - Cualquier dato de negocio específico del cliente
 */
export class TenantDatabaseManager {
  private readonly baseDir: string;
  private readonly tenantsDir: string;
  private readonly sharedDbPath: string;

  constructor(baseDir: string = process.env.DATABASE_DIR || "./data") {
    this.baseDir = baseDir;
    this.tenantsDir = join(baseDir, "tenants");
    this.sharedDbPath =
      process.env.DATABASE_PATH || join(baseDir, "biocore-shared.db");

    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
      log.info({ dir: this.baseDir }, "Directorio de datos creado");
    }
    if (!existsSync(this.tenantsDir)) {
      mkdirSync(this.tenantsDir, { recursive: true });
      log.info({ dir: this.tenantsDir }, "Directorio de tenants creado");
    }
  }

  /**
   * Retorna la ruta de la BD compartida (reflexes, métricas, config).
   */
  getSharedDbPath(): string {
    return this.sharedDbPath;
  }

  /**
   * Retorna la ruta de la BD específica de un tenant.
   * Crea el archivo si no existe (SQLite lo crea automáticamente al conectar).
   */
  getTenantDbPath(tenantId: string): string {
    // Sanitizar el tenantId para usarlo como nombre de archivo
    const safeName = tenantId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const dbPath = join(this.tenantsDir, `${safeName}.db`);

    log.debug({ tenantId, dbPath }, "Ruta de BD de tenant");
    return dbPath;
  }

  /**
   * Lista todos los tenants que tienen BD creada.
   */
  listTenantDbs(): string[] {
    const { readdirSync } = require("node:fs");
    try {
      const files = readdirSync(this.tenantsDir) as string[];
      return files
        .filter((f: string) => f.endsWith(".db"))
        .map((f: string) => f.replace(".db", ""));
    } catch {
      return [];
    }
  }

  /**
   * Elimina la BD de un tenant (para cleanup).
   */
  removeTenantDb(tenantId: string): boolean {
    const { unlinkSync } = require("node:fs");
    const dbPath = this.getTenantDbPath(tenantId);
    try {
      if (existsSync(dbPath)) {
        unlinkSync(dbPath);
        log.info({ tenantId, dbPath }, "BD de tenant eliminada");
        return true;
      }
      return false;
    } catch (err: any) {
      log.error(
        { tenantId, error: err.message },
        "Error eliminando BD de tenant",
      );
      return false;
    }
  }
}

/** Singleton global del TenantDatabaseManager */
let _instance: TenantDatabaseManager | null = null;

export function getTenantDbManager(): TenantDatabaseManager {
  _instance ??= new TenantDatabaseManager();
  return _instance;
}

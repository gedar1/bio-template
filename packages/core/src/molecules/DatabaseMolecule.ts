import { IDatabase } from "./interfaces/IDatabase.js";
import { SQLiteMolecule } from "./implementations/SQLiteMolecule.js";
import { MoleculeError } from "../errors.js";

/**
 * Factory Pattern: Devuelve la implementación de DB según configuración.
 * Por defecto usa SQLite (sin dependencias del sistema).
 *
 * Para agregar PostgreSQL/MongoDB:
 * 1. Crea PostgreSQLMolecule.ts implementando IDatabase
 * 2. Añade case 'postgres' en el switch
 * 3. Actualiza .env con DATABASE_TYPE=postgres
 *
 * @example
 * const db = DatabaseMolecule.create();
 * await db.connect();
 * await db.insert('logs', { message: 'Test', timestamp: Date.now() });
 */
export class DatabaseMolecule {
  static create(type?: string): IDatabase {
    const dbType = type || process.env.DATABASE_TYPE || "sqlite";

    switch (dbType.toLowerCase()) {
      case "sqlite":
        return new SQLiteMolecule(process.env.DATABASE_PATH || "./biocore.db");

      case "postgres":
        throw new MoleculeError("postgres", "PostgreSQL no implementado aún.");

      case "mongodb":
        throw new MoleculeError("mongodb", "MongoDB no implementado aún.");

      default:
        throw new MoleculeError(dbType, `Tipo de DB no soportado: ${dbType}`);
    }
  }
}

import type { IMolecule } from "./IMolecule.js";

/**
 * Interfaz agnóstica para operaciones de base de datos.
 * Permite implementaciones intercambiables (SQLite, PostgreSQL, MongoDB, etc.)
 */
export interface IDatabase extends IMolecule {
  /**
   * Inicializa la conexión a la base de datos.
   */
  connect(): Promise<void>;

  /**
   * Ejecuta una query SQL cruda (para bases relacionales).
   */
  query(sql: string, params?: any[]): Promise<any[]>;

  /**
   * Inserta un documento/registro.
   */
  insert(table: string, data: Record<string, any>): Promise<any>;

  /**
   * Busca registros según filtros.
   */
  find(table: string, filter?: Record<string, any>): Promise<any[]>;

  /**
   * Actualiza registros.
   */
  update(
    table: string,
    filter: Record<string, any>,
    data: Record<string, any>,
  ): Promise<number>;

  /**
   * Elimina registros.
   */
  delete(table: string, filter: Record<string, any>): Promise<number>;

  /**
   * Cierra la conexión.
   */
  close(): Promise<void>;
}

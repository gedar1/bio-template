/**
 * Interfaz que define la base ( C R U D) para cualquier molécula de Estado o Memoria.
 * Obliga a las Células de Bases de Datos o Almacenamiento a seguir un estándar genérico.
 */
export interface MolecularGen {
  /** Create: Sintetiza nueva información */
  create(key: string, data: any): boolean;

  /** Read: Lee información existente. Retorna null si no existe. */
  read(key: string): any;

  /** Update: Muta/actualiza información existente */
  update(key: string, data: any): boolean;

  /** Delete: Elimina la sinapsis / información */
  delete(key: string): boolean;
}

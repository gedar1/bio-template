/**
 * Contrato del almacén de ejecuciones de cadena pendientes de un dato del usuario
 * (por ejemplo, la URL). Una implementación en memoria es la predeterminada;
 * una implementación en base de datos la reemplaza sin tocar UnifiedCortex.
 */

export interface PendingChainRequest {
  readonly sequence: string;
  readonly expiresAt: number;
}

export interface IPendingChainStore {
  /** Guarda una ejecución pendiente para la sesión. */
  set(sessionId: string, sequence: string): void;
  /** Devuelve la pendiente vigente de la sesión, o null si no existe o expiró. */
  get(sessionId: string): PendingChainRequest | null;
  /** Elimina la pendiente de la sesión. */
  clear(sessionId: string): void;
}

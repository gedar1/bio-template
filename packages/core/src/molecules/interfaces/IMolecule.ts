/**
 * Contrato base que TODA molécula de BioCore debe implementar.
 * Define el ciclo de vida y la identidad de una molécula.
 */
export interface IMolecule {
  /** Nombre único de la molécula (ej: 'scraper', 'http', 'gmail') */
  readonly name: string;

  /** Versión semántica de la molécula */
  readonly version: string;

  /**
   * Inicialización asíncrona (conexiones, configuración, etc.)
   * Se llama una vez cuando CellServer instancia la molécula.
   */
  initialize?(): Promise<void>;

  /**
   * Limpieza de recursos (cerrar conexiones, liberar memoria).
   * Se llama cuando la célula muta a otro perfil.
   */
  dispose?(): Promise<void>;
}

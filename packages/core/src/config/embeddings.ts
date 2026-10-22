// Configuración de embeddings via variable de entorno
// Default: true (backward compatibility)
// Set to 'false' para deshabilitar embeddings y usar solo Jev
export const ENABLE_EMBEDDINGS = process.env.ENABLE_EMBEDDINGS !== 'false';

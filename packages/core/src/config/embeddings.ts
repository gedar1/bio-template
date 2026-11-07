// Configuración de embeddings via variable de entorno
// Default: true (backward compatibility)
// Set to 'false' para deshabilitar embeddings y usar solo Jev
//
// Se lee en cada llamada, no al cargar el módulo: los imports se evalúan antes
// de que dotenv cargue el .env, así que una constante quedaba con el default.
export function isEmbeddingsEnabled(): boolean {
  return process.env.ENABLE_EMBEDDINGS !== "false";
}

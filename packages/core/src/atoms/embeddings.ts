/**
 * Átomos de embeddings semánticos para la Memoria Refleja de BioCore.
 * Funciones puras — sin estado, sin efectos secundarios.
 *
 * Usa @xenova/transformers con el modelo paraphrase-multilingual-MiniLM-L12-v2:
 *   - Tamaño: ~120 MB (descarga automática en primer uso, se cachea localmente)
 *   - Dimensión del vector: 384
 *   - Velocidad: ~15ms por embedding en CPU
 *   - Idiomas: 50+ incluyendo español e inglés (cross-language real)
 *   - Costo: $0 siempre (100% local)
 */

import { pipeline, env } from "@xenova/transformers";
import { createLogger } from "../config/logger.js";

const log = createLogger("Embeddings");

// Silenciar logs de descarga del modelo en producción
env.allowLocalModels = true;
env.allowRemoteModels = true;

/** Vector de embedding — array de 384 números flotantes */
export type Embedding = number[];

// Singleton del pipeline de feature extraction (carga el modelo una vez)
let _pipeline: Awaited<ReturnType<typeof pipeline>> | null = null;

async function getPipeline() {
  _pipeline ??= await pipeline(
    "feature-extraction",
    "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
  );
  return _pipeline;
}

/**
 * Pre-loads the embedding pipeline. Call during server init.
 * If already loaded, resolves immediately with 0ms.
 * If loading fails, logs the error and allows lazy fallback.
 *
 * @returns Load duration in milliseconds
 */
export async function preloadPipeline(): Promise<number> {
  if (_pipeline !== null) return 0;
  const start = Date.now();
  try {
    await getPipeline();
    const duration = Date.now() - start;
    log.info({ durationMs: duration }, "Embedding pipeline pre-loaded");
    return duration;
  } catch (err: any) {
    log.warn(
      { error: err.message },
      "Failed to pre-load embedding pipeline, will retry on first use",
    );
    return Date.now() - start;
  }
}

/**
 * Convierte un texto en un vector de embedding semántico.
 * El modelo se descarga automáticamente en el primer uso (~22 MB) y se cachea.
 *
 * @param text - Texto a vectorizar (máximo ~512 tokens, ~400 palabras)
 * @returns Vector de 384 dimensiones que representa el significado semántico
 *
 * @example
 * const v = await computeEmbedding("Scrape esta URL y guarda en DB");
 * // → [0.23, -0.11, 0.87, ...]  (384 números)
 */
export async function computeEmbedding(text: string): Promise<Embedding> {
  const extractor = await getPipeline();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const output = await (extractor as any)(text, {
    pooling: "mean",
    normalize: true,
  });
  // output.data es un Float32Array — convertir a array normal para JSON/SQLite
  return Array.from(output.data as Float32Array);
}

/**
 * Calcula la similitud coseno entre dos embeddings.
 * Mide qué tan parecidos son semánticamente dos textos.
 *
 * @returns Número entre -1 y 1:
 *   - 1.0 = idénticos en significado
 *   - 0.9 = muy similares (misma intención, palabras distintas)
 *   - 0.7 = relacionados
 *   - 0.0 = sin relación
 *   - -1.0 = opuestos
 *
 * @example
 * cosineSimilarity([0.23, -0.11, ...], [0.21, -0.09, ...]) // → 0.93
 */
export function cosineSimilarity(a: Embedding, b: Embedding): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Normaliza una secuencia de pasos de herramientas a un string canónico.
 * Se usa como identificador legible de la secuencia y para deduplicación.
 *
 * @param steps - Pasos de ejecución: ["mutate:sensory", "scrape_url", "mutate:memory", "db_insert"]
 * @returns String canónico: "mutate:sensory->scrape_url->mutate:memory->db_insert"
 *
 * @example
 * normalizeSequence(["mutate:sensory", "scrape_url", "mutate:memory", "db_insert"])
 * // => "mutate:sensory->scrape_url->mutate:memory->db_insert"
 */
export function normalizeSequence(steps: string[]): string {
  return steps
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .join("->");
}

/**
 * Normaliza un texto de usuario para mejorar la similitud semántica en embeddings.
 * Elimina valores concretos (URLs, emails, rutas, números) que reducen la similitud
 * sin aportar información sobre la *intención* de la tarea.
 *
 * @example
 * normalizeForEmbedding("scrapea https://example.com y guarda en tabla users")
 * // => "scrapea una URL y guarda en tabla"
 */
export function normalizeForEmbedding(text: string): string {
  return text
    .replaceAll(/https?:\/\/[^\s"'<>()[\],]+/gi, "una URL") // URLs con protocolo → "una URL"
    .replaceAll(
      /(?<!\w)[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.(?:com|org|net|io|dev|co|app|xyz|info|me|tv|es|uk|de|fr|jp|br|ar|mx|cl|edu|gov)(?:\.[a-zA-Z]{2,})?(?:\/[^\s"'<>()[\],]*)?/gi,
      "una URL",
    ) // Dominios sin protocolo (example.com, api.example.com/path) → "una URL"
    .replaceAll(
      /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/gi,
      "un email",
    ) // emails
    .replaceAll(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "una IP") // IPs
    .replaceAll(/(?:\.\/|\/)[^\s"']+\.\w{1,5}/g, "un archivo") // rutas de archivo
    .replaceAll(/\b\d+\b/g, "") // números sueltos
    .replaceAll(/\s{2,}/g, " ") // espacios múltiples
    .trim();
}

/**
 * Serializa un embedding a string JSON para almacenar en SQLite.
 * SQLite no tiene tipo nativo para arrays — se guarda como JSON.
 */
export function serializeEmbedding(embedding: Embedding): string {
  return JSON.stringify(embedding);
}

/**
 * Deserializa un embedding desde string JSON almacenado en SQLite.
 */
export function deserializeEmbedding(raw: string): Embedding {
  return JSON.parse(raw) as Embedding;
}

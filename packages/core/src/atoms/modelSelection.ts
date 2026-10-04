/**
 * Selección semántica de modelo LLM usando TypeSafe AI (Jev).
 * Reemplaza la heurística anterior (longitud + keyword "analiza") por
 * una clasificación real de la naturaleza del request.
 *
 * Modelos disponibles:
 *   gemini — rápido, eficiente, ideal para acciones, lookups y tareas directas
 *   claude — preciso, razonamiento profundo, ideal para análisis y decisiones complejas
 *   nvidia — especializado en tool calling, fallback cuando los anteriores fallan
 *
 * Flujo:
 *   1. Comandos explícitos (/claude, /gemini, /nvidia) → respetados sin llamar a Jev
 *   2. Si TYPESAFE_API_KEY disponible → Jev clasifica semánticamente (~100ms)
 *   3. Si Jev falla o no hay key → fallback heurístico síncrono (comportamiento anterior)
 *
 * Costo: ~$0.00002 por llamada (preguntas pequeñas, ~500 tokens de entrada).
 */

import { TypeSafeClient, choice, noul } from "@typesafe-ai/sdk";
import { createLogger } from "../config/logger.js";

const log = createLogger("ModelSelection");

/** Singleton del cliente Jev para selección de modelo */
let _jevClient: TypeSafeClient | null = null;

function getJevClient(): TypeSafeClient | null {
  if (!process.env.TYPESAFE_API_KEY) return null;
  _jevClient ??= new TypeSafeClient({
    apiKey: process.env.TYPESAFE_API_KEY,
    defaultModel: "jev-latest",
    logLevel: "warn",
    timeout: 3000, // 3s max — la selección de modelo no puede bloquear el inicio del chat
  });
  return _jevClient;
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Selecciona el modelo LLM más adecuado para el texto del usuario.
 *
 * Prioridad:
 * 1. Comandos explícitos del usuario (/claude, /gemini, /nvidia)
 * 2. Clasificación semántica via Jev (si TYPESAFE_API_KEY configurada)
 * 3. Heurística síncrona de fallback (longitud + keywords)
 *
 * @param userText - Texto original del usuario (antes de limpiar comandos)
 * @returns Nombre del proveedor LLM recomendado
 */
export async function chooseModel(
  userText: string,
): Promise<"gemini" | "claude" | "nvidia"> {
  const text = userText.toLowerCase().trim();

  // ── 1. Comandos explícitos — siempre respetados ──────────────────────────
  if (text.startsWith("/claude")) return "claude";
  if (text.startsWith("/gemini")) return "gemini";
  if (text.startsWith("/nvidia")) return "nvidia";

  // ── 2. Clasificación semántica via Jev ───────────────────────────────────
  const client = getJevClient();
  if (client) {
    try {
      const result = await client.systemOne({
        state: { message: userText.substring(0, 500) },
        questions: {
          model: choice(
            "¿Qué modelo LLM es más adecuado para responder este request?",
            {
              gemini:
                "Acción directa, lookup, tarea operativa, scraping, DB, git, archivos, CLI — respuesta rápida sin razonamiento profundo",
              claude:
                "Análisis, revisión de código, decisiones complejas, razonamiento multi-paso, escritura elaborada, debugging detallado",
              nvidia:
                "Caso que requiere tool calling intensivo o capacidades especializadas de modelos open-source",
            },
          ),
          needs_deep_reasoning: noul(
            "El request requiere razonamiento profundo, análisis multi-dimensional, o evaluación de múltiples factores antes de responder",
          ),
        },
      });

      const modelAnswer = result.answers.model;
      const reasoningNoul = result.answers.needs_deep_reasoning;

      // Si Jev elige gemini pero necesita razonamiento profundo (> 0.75), escalar a claude
      let selected = modelAnswer.choice as "gemini" | "claude" | "nvidia";
      if (selected === "gemini" && reasoningNoul.noul > 0.75) {
        selected = "claude";
        log.debug(
          {
            original: "gemini",
            override: "claude",
            reasoningNoul: reasoningNoul.noul.toFixed(2),
          },
          "ModelSelection: escalado a claude por razonamiento profundo detectado",
        );
      }

      log.info(
        {
          selected,
          confidence: modelAnswer.confidence.toFixed(3),
          needsReasoning: reasoningNoul.noul.toFixed(2),
          inputTokens: result.usage.input_tokens,
          source: "jev",
        },
        "ModelSelection: modelo seleccionado",
      );

      return selected;
    } catch (err: any) {
      // Degradación silenciosa — Jev nunca bloquea la selección de modelo
      log.debug(
        { error: err.message },
        "ModelSelection: Jev falló — usando heurística",
      );
    }
  }

  // ── 3. Fallback heurístico síncrono ─────────────────────────────────────
  // Comportamiento original — se activa cuando no hay API key o Jev falla.
  const selected = heuristicChooseModel(text);
  log.debug({ selected, source: "heuristic" }, "ModelSelection: heurística");
  return selected;
}

// ─── Heurística de fallback ───────────────────────────────────────────────────

/**
 * Heurística síncrona original — fallback cuando Jev no está disponible.
 * Preserva el comportamiento anterior exacto para no romper tests existentes.
 */
function heuristicChooseModel(text: string): "gemini" | "claude" {
  if (text.length > 300) return "claude";
  if (
    text.includes("analiza") ||
    text.includes("analyze") ||
    text.includes("revisa") ||
    text.includes("explica") ||
    text.includes("compara") ||
    text.includes("evalúa") ||
    text.includes("evalua") ||
    text.includes("diseña") ||
    text.includes("diseña")
  ) {
    return "claude";
  }
  return "gemini";
}

/**
 * Átomo de pre-routing de célula usando TypeSafe AI (Jev).
 * Función pura — sin estado, sin efectos secundarios.
 *
 * Evalúa el mensaje del usuario (con contexto de historial) y decide qué tipo
 * de célula activar ANTES de entrar al loop LLM. Esto elimina el turno de
 * "stimulate_differentiation" que el LLM consumía para decidir qué célula usar.
 *
 * Graceful degradation: si TYPESAFE_API_KEY no está configurada, o si la
 * confianza de Jev es < MIN_CONFIDENCE, retorna null y el flujo continúa
 * normalmente hacia el LLM sin pre-routing.
 *
 * Costo: ~$0.00004 por llamada ($0.042/MTok de entrada, salida gratis).
 * Latencia: 70–500ms (sin bloquear el turno LLM, que toma ≥3s).
 */

import { TypeSafeClient, choice, score, noul } from "@typesafe-ai/sdk";
import { createLogger } from "../config/logger.js";

const log = createLogger("CellRouter");

/**
 * Confianza mínima para pre-mutar la célula automáticamente.
 * Por debajo de este umbral, se deja la decisión al LLM (comportamiento actual).
 */
const MIN_CONFIDENCE = 0.7;

/** Singleton del cliente Jev — se crea una vez y se reutiliza */
let _jevClient: TypeSafeClient | null = null;

function getJevClient(): TypeSafeClient | null {
  if (!process.env.TYPESAFE_API_KEY) return null;
  _jevClient ??= new TypeSafeClient({
    apiKey: process.env.TYPESAFE_API_KEY,
    defaultModel: "jev-latest",
    logLevel: "warn",
    timeout: 5000, // 5s max — si Jev tarda más, degradamos al LLM
  });
  return _jevClient;
}

// ─── Tipos públicos ───────────────────────────────────────────────────────────

/** Resultado del pre-routing de célula */
export interface CellRouteResult {
  /** Tipo de célula recomendado por Jev */
  cellType: string;
  /** Confianza de Jev en la decisión (0–1) */
  confidence: number;
  /** Complejidad estimada de la tarea (0 = simple, 1 = media, 2 = compleja) */
  complexityScore: number;
  /** Jev consideró que el usuario hace referencia a la acción anterior */
  refersToContext: boolean;
  /** Probabilidad de que la tarea requiera múltiples células en secuencia */
  multiCellProbability: number;
  /** Tokens de entrada consumidos en la llamada */
  inputTokens: number;
}

/** Entrada de historial para dar contexto a Jev */
export interface RouterHistoryEntry {
  role: "user" | "assistant";
  content: string;
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Pre-clasifica el tipo de célula que necesita un mensaje del usuario.
 *
 * @param message       - Mensaje actual del usuario
 * @param history       - Últimas 2 entradas del historial de conversación (para pronombres como "guardala")
 * @param allowedCells  - Tipos de célula permitidos para el perfil del tenant actual
 * @returns CellRouteResult si Jev confía ≥ MIN_CONFIDENCE, null en caso contrario
 *
 * @example
 * const route = await preCellRoute("scrapea example.com", [], ["sensory", "memory"]);
 * // → { cellType: "sensory", confidence: 0.91, complexityScore: 0, ... }
 *
 * @example
 * // Con contexto: Jev entiende el pronombre "guardala"
 * const route = await preCellRoute(
 *   "guardala",
 *   [{ role: "assistant", content: "Scrapeé los productos de example.com" }],
 *   ["sensory", "memory"]
 * );
 * // → { cellType: "memory", confidence: 0.83, refersToContext: true, ... }
 */
export async function preCellRoute(
  message: string,
  history: RouterHistoryEntry[],
  allowedCells: string[],
): Promise<CellRouteResult | null> {
  const client = getJevClient();

  if (!client) {
    log.debug("TYPESAFE_API_KEY no configurada — pre-routing desactivado");
    return null;
  }

  if (allowedCells.length === 0) {
    log.warn("allowedCells vacío — no hay tipos de célula para clasificar");
    return null;
  }

  // Construir los criterios del Choice dinámicamente desde el registry del tenant
  // Importamos las descripciones del registry para que Jev tenga contexto semántico
  const cellDescriptions = buildCellCriteria(allowedCells);

  // Estado enriquecido con contexto de conversación para resolver pronombres.
  // Se usan dos rutas distintas sin propiedades opcionales porque EntryType
  // requiere { [key: string]: JsonValue } y JsonValue no incluye undefined.
  const recentContext = history
    .slice(-2)
    .map(
      (h) =>
        `${h.role === "user" ? "Usuario" : "Asistente"}: ${h.content.substring(0, 300)}`,
    )
    .join("\n");

  const state: Record<string, string> = recentContext
    ? { message, recent_context: recentContext }
    : { message };

  try {
    const result = await client.systemOne({
      state,
      questions: {
        cell_type: choice(
          "¿Qué tipo de célula (capacidad del sistema) necesita esta tarea?",
          cellDescriptions,
        ),
        complexity: score("¿Cuál es la complejidad de esta tarea?", [
          "Simple: un solo paso, acción directa",
          "Media: varios pasos o coordinación entre herramientas",
          "Compleja: múltiples células, flujo largo o razonamiento profundo",
        ] as const),
        refers_to_context: noul(
          "El usuario se refiere al resultado o acción de un mensaje anterior (usa pronombres como 'guardala', 'envíala', 'procesala', etc.)",
        ),
        needs_multiple_cells: noul(
          "Esta tarea requiere más de un tipo de célula en secuencia (ej: scraping + guardar en BD, leer archivo + enviar email, git + notificar)",
        ),
      },
    });

    const cellAnswer = result.answers.cell_type;
    const complexityAnswer = result.answers.complexity;
    const refersAnswer = result.answers.refers_to_context;
    const multiCellAnswer = result.answers.needs_multiple_cells;

    log.info(
      {
        message: message.substring(0, 80),
        cellType: cellAnswer.choice,
        confidence: cellAnswer.confidence.toFixed(3),
        complexity: complexityAnswer.score.toFixed(2),
        refersToContext: refersAnswer.noul.toFixed(2),
        multiCell: multiCellAnswer.noul.toFixed(2),
        inputTokens: result.usage.input_tokens,
        model: result.model,
      },
      "Jev pre-routing completado",
    );

    // Tareas multi-célula: el LLM coordina mejor la secuencia completa.
    // El Reflex aprenderá toda la secuencia y la próxima vez la ejecuta sin LLM ni Jev.
    if (multiCellAnswer.noul > 0.65) {
      log.debug(
        {
          multiCell: multiCellAnswer.noul.toFixed(2),
          cellType: cellAnswer.choice,
        },
        "Multi-célula detectado — delegando secuencia al LLM",
      );
      return null;
    }

    // Si Jev no está seguro de la célula, dejar la decisión al LLM
    if (cellAnswer.confidence < MIN_CONFIDENCE) {
      log.debug(
        {
          confidence: cellAnswer.confidence.toFixed(3),
          threshold: MIN_CONFIDENCE,
        },
        "Confianza insuficiente — delegando al LLM",
      );
      return null;
    }

    return {
      cellType: cellAnswer.choice,
      confidence: cellAnswer.confidence,
      complexityScore: complexityAnswer.score,
      refersToContext: refersAnswer.noul > 0.6,
      multiCellProbability: multiCellAnswer.noul,
      inputTokens: result.usage.input_tokens,
    };
  } catch (err: any) {
    // Degradación silenciosa: Jev nunca rompe el flujo principal
    log.warn(
      { error: err.message },
      "Jev pre-routing falló — continuando sin pre-routing",
    );
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Descripción semántica de cada tipo de célula para los criterios del Choice de Jev.
 * Estas descripciones son las que Jev usa para entender qué célula elegir.
 */
const CELL_DESCRIPTIONS: Record<string, string> = {
  sensory:
    "Leer datos externos: web scraping, APIs REST, feeds RSS, páginas web",
  memory:
    "Persistir o consultar información: base de datos, guardar, buscar, insertar, actualizar",
  filesystem:
    "Operaciones de archivos locales: leer, escribir, copiar, mover, listar directorios",
  communication: "Enviar emails, WhatsApp, notificaciones, mensajes a personas",
  versioncontrol:
    "Operaciones Git: commit, push, pull, branches, historial de cambios",
  http: "Peticiones HTTP avanzadas: GET, POST, PUT, DELETE, APIs con autenticación",
  system:
    "Ejecutar comandos CLI del sistema: ffmpeg, imagemagick, scripts, procesos",
  monitor:
    "Monitoreo de servicios: vigilar URLs, verificar disponibilidad, alertas",
  realtime: "Comunicación WebSocket bidireccional en tiempo real",
  orders: "Pedidos de restaurante: crear, actualizar, listar, cancelar pedidos",
  inventory: "Inventario: stock, alertas de reorden, productos disponibles",
  delivery: "Entregas: asignar repartidor, rastrear entrega, estimar tiempo",
};

/**
 * Construye el mapa de criterios para el Choice de Jev,
 * filtrando solo los tipos permitidos para el tenant actual.
 */
function buildCellCriteria(allowedCells: string[]): Record<string, string> {
  const criteria: Record<string, string> = {};
  for (const cellType of allowedCells) {
    criteria[cellType] = CELL_DESCRIPTIONS[cellType] ?? cellType;
  }
  return criteria;
}

/**
 * Átomo de guardrail pre-ejecución usando TypeSafe AI (Jev).
 * Función pura — sin estado, sin efectos secundarios.
 *
 * Intercepta herramientas destructivas o de alto riesgo ANTES de ejecutarlas
 * y verifica que la acción sea coherente con lo que el usuario pidió.
 *
 * Herramientas vigiladas (DESTRUCTIVE_TOOLS):
 *   - execute_cli   — ejecuta comandos arbitrarios en el sistema
 *   - write_file    — sobreescribe archivos en disco
 *   - delete_file   — elimina archivos permanentemente
 *   - git_push      — sube cambios a repositorio remoto
 *   - git_commit    — crea commits en el repositorio
 *   - send_email    — envía emails a destinatarios externos
 *   - send_whatsapp — envía mensajes WhatsApp
 *   - send_bulk_email     — envía emails masivos
 *   - send_template_email — envía emails desde plantilla
 *   - http_post / http_put / http_delete — mutaciones HTTP a APIs externas
 *   - db_delete     — borra registros de la base de datos
 *
 * Thresholds (escalados por riesgo):
 *   - SAFE_THRESHOLD   0.60 — mínimo para ejecutar sin confirmación
 *   - REVIEW_THRESHOLD 0.40 — zona de revisión: se loguea pero ejecuta con advertencia
 *   - Por debajo de 0.40 → bloqueo total, lanza GuardrailBlockedError
 *
 * Graceful degradation: si TYPESAFE_API_KEY no está configurada, o si Jev falla,
 * retorna safe=true y la herramienta se ejecuta normalmente (comportamiento actual).
 *
 * Costo: ~$0.00003 por llamada. Latencia: 70–300ms.
 */

import { TypeSafeClient, noul, score } from "@typesafe-ai/sdk";
import { createLogger } from "../config/logger.js";

const log = createLogger("ExecutionGuardrail");

// ─── Configuración ────────────────────────────────────────────────────────────

/**
 * Herramientas de alto riesgo que pasan por el guardrail.
 * Mapa: nombre de herramienta → nivel de riesgo ("high" | "critical")
 *
 * high     → threshold 0.60 (acción reversible o con impacto moderado)
 * critical → threshold 0.75 (acción irreversible o con impacto externo)
 */
const GUARDED_TOOLS: Record<string, "high" | "critical"> = {
  // Sistema — comandos arbitrarios (irreversible)
  execute_cli:         "critical",

  // Filesystem — sobreescritura y eliminación
  write_file:          "high",
  delete_file:         "critical",
  write_json:          "high",

  // Git — cambios al repositorio
  git_commit:          "high",
  git_push:            "critical",

  // Comunicación — mensajes a personas externas
  send_email:          "critical",
  send_bulk_email:     "critical",
  send_template_email: "critical",
  send_whatsapp:       "critical",

  // HTTP — mutaciones a APIs externas
  http_post:           "high",
  http_put:            "high",
  http_delete:         "critical",

  // Base de datos — borrado de registros
  db_delete:           "critical",
};

/** Umbral mínimo para ejecutar sin bloqueo según nivel de riesgo */
const SAFE_THRESHOLD: Record<"high" | "critical", number> = {
  high:     0.55,
  critical: 0.70,
};

/** Zona de advertencia: ejecuta pero loguea la baja confianza */
const REVIEW_THRESHOLD = 0.40;

/** Singleton del cliente Jev */
let _jevClient: TypeSafeClient | null = null;

function getJevClient(): TypeSafeClient | null {
  if (!process.env.TYPESAFE_API_KEY) return null;
  _jevClient ??= new TypeSafeClient({
    apiKey: process.env.TYPESAFE_API_KEY,
    defaultModel: "jev-latest",
    logLevel: "warn",
    timeout: 4000, // 4s max — guardrail no puede bloquear demasiado el flujo
  });
  return _jevClient;
}

// ─── Tipos públicos ───────────────────────────────────────────────────────────

/** Resultado del guardrail */
export interface GuardrailResult {
  /** true = ejecutar, false = bloquear */
  safe: boolean;
  /** Probabilidad de que la acción sea coherente con el input (0–1) */
  safetyScore: number;
  /** Razón legible del bloqueo (solo cuando safe=false) */
  reason?: string;
  /** Nivel de riesgo de la herramienta */
  riskLevel: "high" | "critical";
  /** Tokens consumidos */
  inputTokens: number;
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Verifica si una herramienta destructiva es segura de ejecutar
 * dado el input original del usuario y los argumentos que el LLM propone.
 *
 * @param toolName  - Nombre de la herramienta que se va a ejecutar
 * @param args      - Argumentos que el LLM propone pasar a la herramienta
 * @param userInput - Input original del usuario en esta sesión
 * @returns GuardrailResult con safe=true si se puede ejecutar,
 *          o GuardrailResult con safe=false si debe bloquearse.
 *          Retorna null si la herramienta no está vigilada o Jev no está disponible.
 *
 * @example
 * const result = await checkExecutionSafety(
 *   "delete_file",
 *   { path: "./important-data.json" },
 *   "borra el archivo de configuración temporal"
 * );
 * // → { safe: true, safetyScore: 0.82, riskLevel: "critical", ... }
 *
 * @example
 * const result = await checkExecutionSafety(
 *   "send_email",
 *   { to: "boss@company.com", subject: "Renuncia" },
 *   "envía un email de prueba a mi correo de test"
 * );
 * // → { safe: false, safetyScore: 0.21, reason: "...", riskLevel: "critical", ... }
 */
export async function checkExecutionSafety(
  toolName: string,
  args: Record<string, unknown>,
  userInput: string,
): Promise<GuardrailResult | null> {
  // Solo herramientas vigiladas pasan por aquí
  const riskLevel = GUARDED_TOOLS[toolName];
  if (!riskLevel) return null;

  const client = getJevClient();
  if (!client) {
    log.debug("TYPESAFE_API_KEY no configurada — guardrail desactivado");
    return null;
  }

  // Serializar los args de forma segura para el estado de Jev
  const argsPreview = safeSerializeArgs(args);

  try {
    const result = await client.systemOne({
      state: {
        user_request: userInput.substring(0, 400),
        proposed_tool: toolName,
        proposed_args: argsPreview,
        risk_level: riskLevel,
      },
      questions: {
        safe_to_execute: noul(
          "La acción propuesta (herramienta + argumentos) es coherente y proporcional a lo que el usuario solicitó",
        ),
        is_destructive_scope: noul(
          "El alcance de la acción es más amplio o destructivo de lo que el usuario implícitamente autorizó (ej: borra todo en vez de un archivo, envía a todos en vez de uno)",
        ),
        risk_assessment: score(
          "Nivel de riesgo operacional de ejecutar esta acción ahora",
          [
            "Sin riesgo: acción completamente alineada con el pedido",
            "Riesgo bajo: acción coherente, impacto reversible",
            "Riesgo medio: acción coherente pero con impacto significativo",
            "Riesgo alto: acción parcialmente alineada o impacto grave",
            "Riesgo crítico: acción no alineada o consecuencias irreversibles",
          ] as const,
        ),
      },
    });

    const safeAnswer    = result.answers.safe_to_execute;
    const scopeAnswer   = result.answers.is_destructive_scope;
    const riskAnswer    = result.answers.risk_assessment;

    // safetyScore: coherencia positiva menos penalización por scope excesivo
    const safetyScore = Math.max(
      0,
      safeAnswer.noul - scopeAnswer.noul * 0.4,
    );

    const threshold = SAFE_THRESHOLD[riskLevel];
    const isSafe = safetyScore >= threshold && riskAnswer.score < 3;

    log.info(
      {
        tool: toolName,
        riskLevel,
        safetyScore: safetyScore.toFixed(3),
        coherence: safeAnswer.noul.toFixed(3),
        scopeExcess: scopeAnswer.noul.toFixed(3),
        riskScore: riskAnswer.score.toFixed(2),
        threshold,
        decision: isSafe ? "ALLOW" : safetyScore >= REVIEW_THRESHOLD ? "WARN" : "BLOCK",
        inputTokens: result.usage.input_tokens,
      },
      "Guardrail evaluado",
    );

    if (!isSafe && safetyScore < REVIEW_THRESHOLD) {
      // Bloqueo total — acción incoherente con el pedido del usuario
      const reason = buildBlockReason(toolName, args, safeAnswer.noul, scopeAnswer.noul, riskAnswer.score);
      return {
        safe: false,
        safetyScore,
        reason,
        riskLevel,
        inputTokens: result.usage.input_tokens,
      };
    }

    if (!isSafe) {
      // Zona de advertencia — ejecuta pero loguea prominentemente
      log.warn(
        {
          tool: toolName,
          safetyScore: safetyScore.toFixed(3),
          userInput: userInput.substring(0, 100),
          args: argsPreview,
        },
        "⚠️  Guardrail: ejecutando con baja confianza (zona de revisión)",
      );
    }

    return {
      safe: true,
      safetyScore,
      riskLevel,
      inputTokens: result.usage.input_tokens,
    };
  } catch (err: any) {
    // Degradación silenciosa — el guardrail nunca bloquea por fallo propio
    log.warn(
      { tool: toolName, error: err.message },
      "Guardrail falló — permitiendo ejecución (fail-open)",
    );
    return null;
  }
}

/**
 * Indica si una herramienta está bajo vigilancia del guardrail.
 * Útil para logs y dashboards sin invocar a Jev.
 */
export function isGuardedTool(toolName: string): boolean {
  return toolName in GUARDED_TOOLS;
}

/**
 * Retorna el nivel de riesgo de una herramienta, o null si no está vigilada.
 */
export function getToolRiskLevel(toolName: string): "high" | "critical" | null {
  return GUARDED_TOOLS[toolName] ?? null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Serializa los args de la herramienta a string de forma segura para el estado de Jev.
 * Trunca valores largos para no saturar el context window.
 */
function safeSerializeArgs(args: Record<string, unknown>): string {
  try {
    const truncated: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      if (typeof v === "string" && v.length > 200) {
        truncated[k] = v.substring(0, 200) + "…";
      } else {
        truncated[k] = v;
      }
    }
    return JSON.stringify(truncated);
  } catch {
    return String(args);
  }
}

/**
 * Construye un mensaje de bloqueo legible para el LLM y el usuario.
 */
function buildBlockReason(
  toolName: string,
  args: Record<string, unknown>,
  coherence: number,
  scopeExcess: number,
  riskScore: number,
): string {
  const parts: string[] = [
    `Guardrail bloqueó '${toolName}':`,
  ];

  if (coherence < 0.40) {
    parts.push(`la acción no parece coherente con lo que el usuario pidió (coherencia: ${(coherence * 100).toFixed(0)}%)`);
  }
  if (scopeExcess > 0.60) {
    parts.push(`el alcance parece excesivo respecto al pedido original (exceso: ${(scopeExcess * 100).toFixed(0)}%)`);
  }
  if (riskScore >= 3) {
    parts.push(`nivel de riesgo operacional alto (${riskScore.toFixed(1)}/4)`);
  }

  // Hint para el LLM
  const keyArgs = Object.keys(args).slice(0, 3).join(", ");
  parts.push(`Confirma con el usuario antes de proceder. Argumentos propuestos: { ${keyArgs} }`);

  return parts.join(". ");
}

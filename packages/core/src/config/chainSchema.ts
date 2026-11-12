/**
 * Esquema de las cadenas declaradas por un perfil de dominio.
 *
 * Una cadena es una secuencia de pasos (célula + herramienta) que el motor ejecuta
 * sin LLM cuando Jev la sugiere y sus células están permitidas en el perfil.
 *
 * Argumentos de cada paso (strings con prefijo `$`):
 *   "$requires.<nombre>"  valor extraído del mensaje del usuario (ver `requires`)
 *   "$previous"           salida del paso anterior
 *   "$now"                fecha y hora actual en ISO 8601
 *   cualquier otro valor  literal
 *
 * Limitaciones deliberadas de esta versión:
 *   - `requires` admite como máximo un dato. Si la cadena necesita más, se pedirán en
 *     una conversación de varios turnos, que todavía no existe.
 *   - `setup` se ejecuta en la célula `memory` antes del primer paso.
 */

import { z } from "zod";

/** Extractores de datos del mensaje. Los implementa el motor en `atoms/chainSpec.ts`. */
export const EXTRACTOR_NAMES = ["url", "text"] as const;
export type ExtractorName = (typeof EXTRACTOR_NAMES)[number];

export const ChainStepSchema = z.object({
  cell: z.string().min(1),
  tool: z.string().min(1),
  args: z.record(z.unknown()).default({}),
});

export const ChainRequirementSchema = z.object({
  name: z.string().regex(/^[a-z_]+$/, "name: solo minúsculas y guion bajo"),
  extractor: z.enum(EXTRACTOR_NAMES),
  /** Pregunta que se hace al usuario cuando el mensaje no trae el dato. */
  ask: z.string().min(1),
});

export const ChainDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "id: minúsculas, números y guion"),
  description: z.string().min(1),
  requires: z.array(ChainRequirementSchema).max(1).default([]),
  steps: z.array(ChainStepSchema).min(1),
  setup: z.array(z.string().min(1)).default([]),
  /** Respuesta al usuario cuando la cadena termina bien. */
  done: z.string().min(1).default("Cadena completada."),
});

export type ChainStep = z.infer<typeof ChainStepSchema>;
export type ChainRequirement = z.infer<typeof ChainRequirementSchema>;
export type ChainDefinition = z.infer<typeof ChainDefinitionSchema>;

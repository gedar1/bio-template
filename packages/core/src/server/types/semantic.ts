/**
 * Semantic routing types for Fase 3: Multi-Intent Composition
 * Defines interfaces for execution chains, dependencies, and multi-intent orchestration.
 */

/**
 * Representa una dependencia entre dos reflexes:
 * reflexA debe ejecutarse antes que reflexB
 */
export interface ExecutionDependency {
  source_id: number; // Reflex que debe ejecutarse primero
  target_id: number; // Reflex que depende del source
  confidence: number; // Confianza Jev de la dependencia (0-100)
  sequence_keyword: string; // "y", "luego", "después", etc.
}

/**
 * Un nodo en la cadena de ejecución ordenada (execution chain)
 */
export interface ExecutionChainNode {
  id: number; // Reflex ID
  task_summary: string; // Descripción de la tarea
  confidence: number; // Confidence del reflex original (0-100)
  status: "activated" | "candidate"; // Estado del reflex
  execution_order: number; // 1, 2, 3, etc. (posición en secuencia)
  depends_on: number | null; // Reflex ID que debe completar primero, null si no tiene dependencia
  estimated_duration_ms?: number; // Duración estimada (opcional, para UI)
}

/**
 * Resultado de detección de secuencias multi-intent
 */
export interface MultiIntentSequenceDetectionResult {
  sequences: Array<{
    primary: number; // Reflex primario (confianza alta)
    chained: number[]; // Reflexes que dependen del primario
  }>;
  implied_order: number[]; // Orden de ejecución sugerida (topological)
  dependencies: ExecutionDependency[]; // Detalle de cada dependencia
}

/**
 * Resultado de resolución de orden de ejecución
 */
export interface ExecutionOrderResolution {
  chain: ExecutionChainNode[]; // Nodos en orden topológico
  strategy: "sequential" | "parallel"; // Estrategia de ejecución seleccionada
  has_cycles: boolean; // true si había ciclos (fallback a sequential)
}

/**
 * SemanticRouteResultV3: extiende SemanticRouteResult con composición multi-intent
 * Mantiene todos los campos de Fase 1-2 para backward compatibility
 */
export interface SemanticRouteResultV3 {
  // Fase 1-2 fields (todos presentes para backward compat)
  ranking: Array<{
    id: number;
    task_summary: string;
    confidence: number;
    reliability: "high" | "medium" | "low";
  }>;
  top_match: {
    id: number;
    task_summary: string;
    confidence: number;
    reliability: "high" | "medium" | "low";
  } | null;
  model_confidence: number; // 0-1, normalizado desde top_match.confidence
  escalate_to_llm: boolean; // true si reliability="low" O multi_intent_detected
  phase: "fast-search" | "jev-reranking";
  activated_reflexes: number[]; // IDs con confidence >= 85%
  candidate_reflexes: number[]; // IDs con 60% < confidence < 85%
  multi_intent_detected: boolean; // true si len(activated) >= 2
  verification_results: Record<
    string,
    { llm_decision: "accept" | "reject"; reasoning: string }
  >; // LLM verification results

  // Fase 3 fields (nuevos, para composición multi-intent)
  execution_chain: ExecutionChainNode[]; // Cadena de ejecución ordenada
  execution_strategy: "sequential" | "parallel"; // Estrategia seleccionada
  total_reflexes_activated: number; // Resumen: cuántos reflexes están activados
  intent_count: number; // Resumen: cuántos intents distintos detectados
  execution_dependencies?: ExecutionDependency[]; // Detalle de dependencias (opcional)
}

# Implementation Plan: Fase 3 — Multi-Intent Composition

## Executive Summary

Fase 3 extiende Fase 2 (Intent Detection + LLM Verification) con **composición multi-intent**: cuando 2 o más reflexes tienen confidence ≥ 75%, el sistema detecta dependencias entre ellos, resuelve un grafo de ejecución (topological sort) y enriquece la respuesta con `execution_chain`, `execution_strategy` y metadata de secuenciación.

**Requisitos implementados:**
1. Detectar secuencias implícitas (palabras clave: "y", "y luego", "después", "entonces")
2. Usar Jev para validar si un reflex debe ejecutarse antes que otro
3. Resolver orden de ejecución (DAG topológico)
4. Seleccionar estrategia: `sequential` (default, seguro) o `parallel` (si no hay dependencias)
5. Enriquecer response con `ExecutionChainNode[]` que incluya dependencies, order y task summary

---

## Análisis del Código Actual (Fase 1-2)

### Ubicación actual de métodos Fase 2 en TenantManager.ts

| Línea    | Método                          | Responsabilidad                                                            |
| -------- | ------------------------------- | -------------------------------------------------------------------------- |
| ~200-250 | `jevDetectIntents()`            | Categoriza ranking Jev en 3 buckets (activated/candidates/ignored)         |
| ~250-310 | `llmVerifyReflex()`             | LLM valida si reflex candidate resuelve intent → accept/reject            |
| ~310-450 | `evaluateSemanticRoute()`       | Flujo principal: ranking Jev + detección + verificación                    |
| ~450-550 | `listReflexesForSemanticRoute()` | Query BD para cargar reflexes                                              |
| ~550-600 | `buildRoutingPrompt()`          | Construye formato "id. task_summary\nid. task_summary\n..."               |
| ~600-700 | `callSemanticRouter()`          | Orquesta Jev (Phase 1: fast-search, Phase 2: jev-reranking)               |
| ~700-800 | `jevEvaluateAll()`              | Batch Jev noul para evaluar todos los reflexes                             |
| ~800-850 | `enrichRankingWithReliability()` | Mapea confidence → reliability (high/medium/low)                           |
| ~850-900 | `extractReflexesFromPrompt()`   | Parse del formato "id. task_summary"                                       |

### SemanticRouteResult actual (Fase 2)

```typescript
export interface SemanticRouteResult {
  ranking: SemanticRouteRanking[];                              // Todos los reflexes ordenados por confidence
  top_match: SemanticRouteRanking | null;                       // El más confiable
  model_confidence: number;                                     // 0-1, normalizado desde top_match.confidence
  escalate_to_llm: boolean;                                     // true si reliability="low" O multi_intent_detected
  phase: "fast-search" | "jev-reranking";
  activated_reflexes: number[];                                 // IDs con confidence >= 85%
  candidate_reflexes: number[];                                 // IDs con 60% < confidence < 85%
  multi_intent_detected: boolean;                               // true si len(activated) >= 2
  verification_results: Record<string, {...}>>;                 // LLM verification results por candidate
}
```

---

## Cambios Necesarios para Fase 3

### 1. Nuevas Interfaces/Tipos (en TenantManager.ts o archivo externo)

```typescript
/**
 * Representa un eslabón de dependencia: reflexA debe ejecutarse antes que reflexB
 */
interface ExecutionDependency {
  source_id: number;        // Reflex que debe ejecutarse primero
  target_id: number;        // Reflex que depende del source
  confidence: number;       // Confianza Jev de la dependencia (0-100)
  sequence_keyword: string; // "y", "luego", "después", etc. que indicó dependencia
}

/**
 * Un nodo en la cadena de ejecución ordenada
 */
interface ExecutionChainNode {
  id: number;                           // Reflex ID
  task_summary: string;                 // Descripción de la tarea
  confidence: number;                   // Confidence del reflex original
  status: "activated" | "candidate";    // Estado del reflex
  execution_order: number;              // 1, 2, 3, etc. (índice en sequence)
  depends_on: number | null;            // Reflex ID que debe completar primero
  estimated_duration_ms?: number;       // Para UI: duración estimada (opcional)
}

/**
 * Resultado de detección de secuencias multi-intent
 */
interface MultiIntentSequenceDetectionResult {
  sequences: Array<{
    primary: number;                     // Reflex primario (confianza alta)
    chained: number[];                   // Reflexes que dependen del primario
  }>;
  implied_order: number[];               // Orden de ejecución sugerida
  dependencies: ExecutionDependency[];   // Detalle de cada dependencia
}

/**
 * Resultado de resolución de orden de ejecución
 */
interface ExecutionOrderResolution {
  chain: ExecutionChainNode[];           // Nodos en orden topológico
  strategy: "sequential" | "parallel";   // Estrategia de ejecución
  has_cycles: boolean;                   // true si había cycles (fallback a sequential)
}

/**
 * SemanticRouteResultV3: extiende V2 con composición multi-intent
 */
export interface SemanticRouteResultV3 extends SemanticRouteResult {
  // Campos Fase 3
  execution_chain: ExecutionChainNode[];      // Cadena de ejecución ordenada
  execution_strategy: "sequential" | "parallel"; // Modo seleccionado
  total_reflexes_activated: number;           // Resumen: cuántos reflexes están activados
  intent_count: number;                       // Resumen: cuántos intents distintos detectados
  execution_dependencies?: ExecutionDependency[]; // Detalle de dependencias (opcional)
}
```

### 2. Nuevos Métodos en TenantManager

#### Método: `detectMultiIntentSequence()`

**Firma:**
```typescript
private async detectMultiIntentSequence(
  userMessage: string,
  intents: IntentDetectionResult
): Promise<MultiIntentSequenceDetectionResult>
```

**Responsabilidad:**
- Detectar palabras clave de secuencia en `userMessage` (y, y luego, después, entonces, para, ,)
- Para cada par (reflexA, reflexB) donde ambos están en activated O candidates:
  - Usar Jev `choice()` para preguntar: "¿{reflexA} debe ejecutarse antes que {reflexB}?"
  - Si confidence Jev > 80% → marcar como dependency
- Retornar grafo de dependencias + implied_order

**Pseudocódigo:**
```
1. Buscar palabras clave de secuencia en userMessage
2. Para cada par (reflexA, reflexB) en (activated + candidates):
   Si existe palabra clave entre reflexA y reflexB en el text:
     - Construir pregunta Jev: "Does 'reflexA.task' need to execute before 'reflexB.task'?"
     - Si confidence > 80% → agregar dependency
3. Construir implied_order usando topological sort simple
4. Retornar MultiIntentSequenceDetectionResult
```

**Logging:**
```
[Multi-Intent Sequence Detection] Searching for sequence keywords in: "guardala y luego actualiza el inventario"
[Multi-Intent Sequence Detection] Found keyword: "y luego" between reflex 51 and 42
[Multi-Intent Sequence Detection] Asking Jev about (51→42): "Does 'Guarda un registro' need to execute before 'Actualiza inventario'?"
[Multi-Intent Sequence Detection] Jev answered: confidence=92%, answer=yes
[Multi-Intent Sequence Detection] Dependencies detected: 51→42 (92%), 46→51 (0%)
[Multi-Intent Sequence Detection] Implied order: [51, 42]
```

#### Método: `resolveExecutionOrder()`

**Firma:**
```typescript
private resolveExecutionOrder(
  activated: Array<{ id: number; confidence: number }>,
  dependencies: Map<number, number[]>
): ExecutionOrderResolution
```

**Responsabilidad:**
- Realizar topological sort del DAG de dependencias
- Si hay ciclos → fallback sequential + mark has_cycles=true
- Si no hay edges (parallelizable) → strategy=parallel
- Si hay edges → strategy=sequential
- Retornar cadena ordenada con execution_order y depends_on

**Pseudocódigo:**
```
1. Build dependency graph from Map<source, [targets]>
2. Detect cycles (DFS from each node, mark back edges)
   If cycles found: set has_cycles=true, strategy=sequential, flatten order
3. If no edges: strategy=parallel, order arbitrary
4. Else: Topological sort (Kahn's algorithm)
   - Compute in-degree for each node
   - Initialize queue with nodes having in-degree 0
   - While queue not empty:
     - Dequeue node, add to order
     - Reduce in-degree of neighbors
     - Enqueue any neighbor with in-degree 0
5. Build ExecutionChainNode[] with execution_order, depends_on
6. Return ExecutionOrderResolution
```

**Logging:**
```
[Execution Order Resolution] Building DAG with 3 nodes and 2 edges
[Execution Order Resolution] Cycle detection: no cycles found
[Execution Order Resolution] Topological sort: [51, 42, 46]
[Execution Order Resolution] Strategy: sequential (has_edges=true)
[Execution Order Resolution] Chain:
  - Order 1: id=51, depends_on=null
  - Order 2: id=42, depends_on=51
  - Order 3: id=46, depends_on=null
```

#### Método: `buildExecutionChain()`

**Firma:**
```typescript
private buildExecutionChain(
  activated: Array<{ id: number; task_summary: string; confidence: number }>,
  orderResolution: ExecutionOrderResolution
): ExecutionChainNode[]
```

**Responsabilidad:**
- Combinar metadata de `activated` reflexes con orden resuelto
- Mapear cada node en orderResolution a ExecutionChainNode completo
- Retornar array con task_summary, confidence, status, etc.

**Pseudocódigo:**
```
1. Create map: reflexId → { task_summary, confidence, status }
2. For each node in orderResolution.chain:
   - Find source data in map
   - Build ExecutionChainNode with all fields
   - Set status based on cual bucket viene (activated vs candidate)
3. Return complete ExecutionChainNode[]
```

### 3. Refactorización de `evaluateSemanticRoute()`

**Cambios en el flujo:**

```typescript
async evaluateSemanticRoute(
  tenantId: string,
  userMessage: string,
): Promise<SemanticRouteResultV3> {
  // ... Fase 1-2 existente (ranking, intents, verification) ...

  // NEW: Fase 3 Multi-Intent Composition
  let executionChain: ExecutionChainNode[] = [];
  let executionStrategy: "sequential" | "parallel" = "sequential";
  let intentCount = intents.activated.length;

  if (intents.activated.length >= 2) {
    log.info(
      { tenantId, activatedCount: intents.activated.length },
      "[Fase 3] Multi-intent detected, starting composition"
    );

    // Detectar secuencias implícitas
    const sequenceDetection = await this.detectMultiIntentSequence(
      userMessage,
      intents
    );
    log.info(
      {
        dependencyCount: sequenceDetection.dependencies.length,
        impliedOrder: sequenceDetection.implied_order,
      },
      "[Fase 3] Sequence detection complete"
    );

    // Convertir dependencies a Map<source, targets[]>
    const depMap = new Map<number, number[]>();
    for (const dep of sequenceDetection.dependencies) {
      if (!depMap.has(dep.source_id)) {
        depMap.set(dep.source_id, []);
      }
      depMap.get(dep.source_id)!.push(dep.target_id);
    }

    // Resolver orden de ejecución
    const orderResolution = this.resolveExecutionOrder(
      intents.activated,
      depMap
    );
    log.info(
      {
        strategy: orderResolution.strategy,
        chainLength: orderResolution.chain.length,
        hasCycles: orderResolution.has_cycles,
      },
      "[Fase 3] Execution order resolved"
    );

    // Construir execution_chain con metadata completa
    executionChain = this.buildExecutionChain(
      intents.activated,
      orderResolution
    );
    executionStrategy = orderResolution.strategy;

    log.info(
      { executionChain: executionChain.map(n => ({ id: n.id, order: n.execution_order })) },
      "[Fase 3] Execution chain built"
    );
  }

  // Construir resultado V3
  const result: SemanticRouteResultV3 = {
    // Campos Fase 1-2
    ranking: enrichedRanking,
    top_match: topMatch,
    model_confidence: topMatch ? topMatch.confidence / 100 : 0,
    escalate_to_llm: escalateToLLM,
    phase: process.env.TYPESAFE_API_KEY ? "jev-reranking" : "fast-search",
    activated_reflexes: intents.activated.map(r => r.id),
    candidate_reflexes: intents.candidates.map(r => r.id),
    multi_intent_detected: intents.activated.length >= 2,
    verification_results: verificationResults,

    // Campos Fase 3
    execution_chain: executionChain,
    execution_strategy: executionStrategy,
    total_reflexes_activated: intents.activated.length,
    intent_count: intentCount,
  };

  log.info(
    {
      tenantId,
      totalActivated: result.total_reflexes_activated,
      executionStrategy: result.execution_strategy,
      chainLength: result.execution_chain.length,
    },
    "=== evaluateSemanticRoute returned (Fase 3) ==="
  );

  return result;
}
```

---

## Logging Estratégico

### Locations y Mensajes por Componente

#### `detectMultiIntentSequence()` - Búsqueda de palabras clave

```
[Multi-Intent Detection] Found multiple intents: count=2, ids=[51, 42]
[Dependency Resolution] Searching keywords in: "guardala y luego actualiza el inventario"
[Dependency Resolution] Keyword match: "y luego" at position 12-19
[Dependency Resolution] Asking Jev about (51→42): "Does 'Guarda un registro' need to execute before 'Actualiza inventario'?"
[Dependency Resolution] Jev response: confidence=92%, answer=yes
[Dependency Resolution] Detected dependency: 51→42 (conf=92%, keyword="y luego")
```

#### `resolveExecutionOrder()` - Topological sort

```
[Execution Plan] Building DAG: 3 nodes, 2 edges
[Execution Plan] Cycle detection: 0 cycles found
[Execution Plan] Topological sort result: [51, 42, 46]
[Execution Plan] Strategy: sequential (has edges)
[Execution Plan] Chain:
  - Execution order 1: id=51, depends_on=null, task='Guarda un registro'
  - Execution order 2: id=42, depends_on=51, task='Actualiza inventario'
  - Execution order 3: id=46, depends_on=null, task='Envía notificación'
```

#### `evaluateSemanticRoute()` - Summary

```
[Evaluation Summary] Single-intent route: activated=[51], strategy=sequential
[Evaluation Summary] Multi-intent composition: count=2, activated=[51, 42], strategy=sequential, escalate_to_llm=true
```

---

## Secuencia de Implementación (Order Crítico)

### Paso 1: Agregar tipos e interfaces
**Archivos:** TenantManager.ts
- Agregar 5 interfaces nuevas al inicio del archivo
- Verificar: `npx tsc --noEmit` — sin errores

### Paso 2: Implementar `detectMultiIntentSequence()`
**Archivos:** TenantManager.ts
- Implementar método privado completo
- Incluir búsqueda de palabras clave
- Llamadas a Jev para validar cada dependency
- Verificar: `npx tsc --noEmit`

### Paso 3: Implementar `resolveExecutionOrder()`
**Archivos:** TenantManager.ts
- Implementar topological sort (Kahn's algorithm)
- Manejo de ciclos
- Determinación de estrategia
- Verificar: `npx tsc --noEmit`

### Paso 4: Implementar `buildExecutionChain()`
**Archivos:** TenantManager.ts
- Mapeo de reflexes a ExecutionChainNode
- Verificar: `npx tsc --noEmit`

### Paso 5: Refactorizar `evaluateSemanticRoute()`
**Archivos:** TenantManager.ts
- Integrar Fase 3 después de Fase 2
- Condicional: si `activated.length >= 2`
- Retornar SemanticRouteResultV3
- Verificar: `npx tsc --noEmit`

### Paso 6: Escribir test cases
**Archivos:** packages/core/tests/server/TenantManager.spec.ts
- 5 test cases (ver sección Validación Manual abajo)
- Verificar: `npx vitest run` — todos pasan

---

## Validación Manual (5 Test Cases)

### Test 1: Single Reflex (Backward Compatibility)
**Input:** `"guardala en la bd"`
**Expected Output:**
```json
{
  "activated_reflexes": [51],
  "candidate_reflexes": [],
  "multi_intent_detected": false,
  "execution_chain": [],
  "execution_strategy": "sequential",
  "total_reflexes_activated": 1,
  "intent_count": 1,
  "top_match": { "id": 51, "confidence": 88 }
}
```
**Verificación:** Backward compat, sin execution_chain

---

### Test 2: Two-Intent Sequential
**Input:** `"guardala y luego actualiza el inventario"`
**Reflexes en DB:**
- Reflex 51: "Guarda un registro" (confidence 88%)
- Reflex 42: "Actualiza inventario" (confidence 79%)
- Jev dirá: 51→42 (si, 92%)

**Expected Output:**
```json
{
  "activated_reflexes": [51, 42],
  "candidate_reflexes": [],
  "multi_intent_detected": true,
  "execution_chain": [
    {
      "id": 51,
      "task_summary": "Guarda un registro",
      "confidence": 88,
      "status": "activated",
      "execution_order": 1,
      "depends_on": null
    },
    {
      "id": 42,
      "task_summary": "Actualiza inventario",
      "confidence": 79,
      "status": "activated",
      "execution_order": 2,
      "depends_on": 51
    }
  ],
  "execution_strategy": "sequential",
  "total_reflexes_activated": 2,
  "intent_count": 2
}
```
**Verificación:** Chain con dependency, strategy=sequential

---

### Test 3: Three-Intent Sequential (Complex DAG)
**Input:** `"guarda el registro, después actualiza inventario, y notifica al cliente"`
**Reflexes en DB:**
- Reflex 51: "Guarda un registro" (confidence 87%)
- Reflex 42: "Actualiza inventario" (confidence 76%)
- Reflex 60: "Envía notificación" (confidence 75%)
- Jev dirá: 51→42 (90%), 42→60 (88%)

**Expected Output:**
```json
{
  "activated_reflexes": [51, 42, 60],
  "candidate_reflexes": [],
  "multi_intent_detected": true,
  "execution_chain": [
    {
      "id": 51,
      "task_summary": "Guarda un registro",
      "confidence": 87,
      "status": "activated",
      "execution_order": 1,
      "depends_on": null
    },
    {
      "id": 42,
      "task_summary": "Actualiza inventario",
      "confidence": 76,
      "status": "activated",
      "execution_order": 2,
      "depends_on": 51
    },
    {
      "id": 60,
      "task_summary": "Envía notificación",
      "confidence": 75,
      "status": "activated",
      "execution_order": 3,
      "depends_on": 42
    }
  ],
  "execution_strategy": "sequential",
  "total_reflexes_activated": 3,
  "intent_count": 3
}
```
**Verificación:** Chain lineal 51→42→60, todas dependen

---

### Test 4: Two-Intent Parallel (Sin Dependencias)
**Input:** `"guarda el registro y envía la factura"`
**Reflexes en DB:**
- Reflex 51: "Guarda un registro" (confidence 86%)
- Reflex 70: "Envía PDF por email" (confidence 77%)
- Jev dirá: 51→70 (15%, no hay orden), 70→51 (18%, no hay orden)

**Expected Output:**
```json
{
  "activated_reflexes": [51, 70],
  "candidate_reflexes": [],
  "multi_intent_detected": true,
  "execution_chain": [
    {
      "id": 51,
      "task_summary": "Guarda un registro",
      "confidence": 86,
      "status": "activated",
      "execution_order": 1,
      "depends_on": null
    },
    {
      "id": 70,
      "task_summary": "Envía PDF por email",
      "confidence": 77,
      "status": "activated",
      "execution_order": 2,
      "depends_on": null
    }
  ],
  "execution_strategy": "parallel",
  "total_reflexes_activated": 2,
  "intent_count": 2
}
```
**Verificación:** Ambos tienen execution_order pero depends_on=null, strategy=parallel

---

### Test 5: Mixed Activated + Candidates
**Input:** `"guarda el registro y tal vez actualiza el inventario"`
**Reflexes en DB:**
- Reflex 51: "Guarda un registro" (confidence 87%, activated)
- Reflex 42: "Actualiza inventario" (confidence 72%, candidate)
  - LLM verifica: accept (es relevante)
- Reflex 30: "Envía reporte" (confidence 65%, candidate)
  - LLM verifica: reject (no es relevante)

**Expected Output:**
```json
{
  "activated_reflexes": [51, 42],
  "candidate_reflexes": [30],
  "multi_intent_detected": true,
  "execution_chain": [
    {
      "id": 51,
      "task_summary": "Guarda un registro",
      "confidence": 87,
      "status": "activated",
      "execution_order": 1,
      "depends_on": null
    },
    {
      "id": 42,
      "task_summary": "Actualiza inventario",
      "confidence": 72,
      "status": "candidate",
      "execution_order": 2,
      "depends_on": 51
    }
  ],
  "execution_strategy": "sequential",
  "total_reflexes_activated": 2,
  "intent_count": 2,
  "verification_results": {
    "42": { "llm_decision": "accept", "reasoning": "Sí, actualizar inventario es relevante después de guardar" },
    "30": { "llm_decision": "reject", "reasoning": "El reporte no es relevante para este flujo" }
  }
}
```
**Verificación:** Mezcla de activated/candidate en chain, solo activated se ordena

---

## Decisiones de Diseño (Rationale)

| Decisión                      | Rationale                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| Threshold multi-intent: ≥2    | Si hay 2 o más activated, siempre ordena (composición segura)                                |
| Threshold Jev dependency: 80% | >80% da confianza de que A debe preceder B; <80% es ambigüedad (fallback no hay order)       |
| Palabras clave: y, luego, ...  | Indicadores lingüísticos comunes de secuencia en español                                     |
| Strategy parallel by default   | Si no hay edges en DAG → sin dependencias → parallelizable sin race conditions                |
| Strategy sequential fallback   | Ciclos detectados → fallback sequential (nunca falla, siempre seguro)                         |
| DAG + topological sort        | Permite expresar dependencias n-arias, no solo pares lineales                                 |
| Backward compat: V3 extiende V2 | Clientes antiguos ignoran execution_chain; clientes nuevos lo usan                           |

---

## Backward Compatibility Checklist

- ✅ SemanticRouteResultV3 extiende SemanticRouteResult (todos los campos V2 presentes)
- ✅ single-intent cases: execution_chain=[], execution_strategy="sequential" (ignored by old clients)
- ✅ Todos los campos nuevos tienen defaults seguros
- ✅ Métodos Fase 3 son privados (no cambia API pública)
- ✅ evaluateSemanticRoute() sigue con misma firma pública

---

## Archivos a Modificar

| Archivo                                   | Cambios                                                   | Líneas Aprox. |
| ----------------------------------------- | --------------------------------------------------------- | ------------- |
| packages/core/src/server/TenantManager.ts | +5 interfaces, +4 métodos, refactor evaluateSemanticRoute | +400-500      |
| packages/core/tests/server/TenantManager.spec.ts | +5 test cases para Phase 3                            | +200-300      |

---

## Métricas de Éxito

1. ✅ `npx tsc --noEmit` — sin errores en core
2. ✅ `npx vitest run` — todos los tests pasan (incluyendo Fase 1-2)
3. ✅ 5 test cases de Fase 3 todos green
4. ✅ Logging manual: verificar que aparecen los 3 logs de cada fase en orden
5. ✅ Response V3 contiene execution_chain, execution_strategy, intent_count

---

## Próximos Pasos (Post-Implementation)

- Fase 4: Execution Engine — implementar `executeChain()` que respete execution_strategy
- Fase 5: UI Enhancements — mostrar execution_chain visual en dashboard
- Fase 6: Metrics & Observability — tracking de execution time por reflex, parallelization benefits

---
inclusion: manual
---

# Cómo se ejecuta un mensaje: del chat a la mutación de la célula

Fuentes: `system/implementations/UnifiedCortex.ts`, `system/BaseOrchestrator.ts`, `organisms/BaseOrganisms.ts`, `cells/CellServer.ts`. Este documento describe el código vigente. Si algo no coincide, el código manda.

## Resumen

Un mensaje entra por `UnifiedCortex.chat()` (ruta no streaming, usada por la API de chat, MCP, CLI y scheduler). Antes de llamar a un LLM, el cortex intenta resolver el mensaje con código y con Jev:

1. Si hay un mensaje pendiente de URL, lo resuelve.
2. Si Jev detecta la cadena `scrape_url→db_insert` con similitud ≥ 0.7, la ejecuta sin LLM.
3. Si Jev sugiere otra secuencia, la agrega como pista en el historial.
4. Si Jev elige una célula, la muta antes del LLM (pre-routing).
5. Si nada de lo anterior resuelve el mensaje, el LLM decide. Sus tool calls se ejecutan con `executeAction`.

El LLM no ejecuta nada por sí mismo. Solo devuelve tool calls, y el código decide cómo ejecutarlas.

## Paso a paso (ruta `chat()`)

### 1. Entrada: `chat(userMessage)`

- Marca la sesión activa y llama a `checkTokenLimit()`.
- Llama a `runConversation(userMessage, streaming = false)`.
- Si todo sale bien, registra la métrica `task_completed` y guarda la secuencia con `saveReflex()`.
- Si falla, registra `task_error` y relanza el error.

### 2. Mensaje pendiente

`runConversation` revisa `pendingChains` para la sesión.

- Si hay un pendiente de la cadena `scrape_url→db_insert`, se limpia.
- Si el mensaje actual contiene una URL, se ejecuta `runScrapeAndStore(url)`.
- Si no contiene URL, responde `PENDING_DISCARDED_WARNING`. Ese mensaje no se procesa: el usuario debe reenviarlo.

### 3. Consulta a Jev (`queryReflex`)

Solo si el mensaje no es una respuesta a un pendiente:

1. `trackInput(cleanText)` registra el input y reinicia el guardarraíl de mutaciones (`_mutatedTypes`).
2. `queryReflex(cleanText)` llama a `DefaultReflexExecutor.queryReflex(input, allowedCells)`. Ese método arma el catálogo de herramientas con `buildJevToolCatalog(allowedCells)` (filtrado de `tools.json` por las células permitidas) y llama a `jevEvaluateAll`.
3. `jevEvaluateAll` hace dos llamadas a Jev, en secuencia:
   - primer paso y si la tarea es multi-paso;
   - siguiente paso, con el primero como dato. `ninguno` significa que la tarea termina en un paso.

Jev devuelve `ReflexMatch` con `record.sequence`, `similarity` y `mode: "hint"`.

### 4. Gate de cadenas (sin LLM)

Si `match.record.sequence` es `scrape_url→db_insert` y `similarity ≥ CHAIN_MIN_SIMILARITY (0.7)`, se llama a `handleScrapeAndStore(cleanText)`:

- Si el mensaje no trae URL (`extractUrl` no encuentra ninguna), guarda el pendiente y responde `URL_QUESTION` ("¿Cuál es la URL a scrapear?").
- Si trae URL, ejecuta `runScrapeAndStore(url)`.

`runScrapeAndStore` ejecuta los pasos en orden. Cada cambio de célula pasa por `routeStimulus`:

| Paso | Llamada                                                                                      | Efecto                                                                                                   |
| ---- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1    | `routeStimulus({type: "sensory", source: "jev-chain"})`                                      | Muta la célula a `sensory`.                                                                              |
| 2    | `executeAction("scrape_url", {url})`                                                         | Scrapea la URL.                                                                                          |
| 3    | `routeStimulus({type: "memory", source: "jev-chain"})`                                       | Muta la célula a `memory`.                                                                               |
| 4    | `organisms[0].callTool("db_query", {sql: CREATE_CHAIN_TABLE_SQL})`                           | Crea `jev_chain_results` si no existe. Va directo al organismo para no registrarse como paso del reflex. |
| 5    | `executeAction("db_insert", {table: "jev_chain_results", data: {url, payload, created_at}})` | Guarda el resultado en la base del tenant.                                                               |

Si algún paso falla, se registra el error y la respuesta indica qué falló.

La respuesta se guarda en el historial con `replyAssistant`. No hay llamada al LLM.

### 5. Pista de Jev (`hint`)

Si Jev devuelve otra secuencia en modo `hint`, `runConversation` agrega un mensaje de sistema al historial:

```
[Jev] Secuencia sugerida: <secuencia>. Úsala como guía si aplica.
```

La pista guía al LLM. No obliga a ejecutar nada.

### 6. Pre-routing de célula (`preRoute`)

`preRoute(input)` usa las últimas 4 entradas de historial de usuario y asistente y llama a `preCellRoute(input, recentHistory, allowedCells)`.

- Si Jev no devuelve ruta, o la célula ya está en `_mutatedTypes`, no hace nada.
- Si devuelve una célula, llama a `routeStimulus({type, source: "jev-pre-router"})` y agrega el tipo a `_mutatedTypes`.

Así la célula ya tiene sus herramientas cuando el LLM empieza.

### 7. Bucle del LLM

1. Se agrega el mensaje del usuario al historial.
2. `refreshTools()` obtiene las herramientas actuales de los organismos (`getUnifiedTools`).
3. Se recorre `providerChain()` (Gemini, Claude, NVIDIA, según configuración). Cada proveedor tiene su circuit breaker.
4. Por cada respuesta del proveedor:
   - Sin tool calls: se guarda la respuesta y se devuelve el texto.
   - Con tool calls: se guardan en el historial, se ejecutan con `executeToolCalls`, se refrescan las herramientas y se vuelve a llamar al mismo proveedor.
5. El bucle tiene como máximo `MAX_ITERATIONS = 10` vueltas. Al llegar al límite lanza `ProviderError` con razón `iteration_limit`.
6. Si un proveedor falla antes de ejecutar efectos y el error es reintentable, se prueba el siguiente. Si ya hubo efectos (`effectsStarted`), no se reintenta con otro proveedor y el error se propaga.

### 8. Ejecución de tool calls (`executeAction`)

`executeToolCalls` ejecuta cada tool call en orden. Si una falla, responde a las llamadas pendientes con error y relanza.

`executeAction(name, args)` tiene dos rutas:

**`stimulate_differentiation` (mutación pedida por el LLM):**

- Si el tipo ya está en `_mutatedTypes`, no muta y responde que las herramientas ya están disponibles.
- Si no, llama a `routeStimulus({type, source: "llm"})`, marca el tipo y registra el paso `mutate:<tipo>` en el reflex.

**Cualquier otra herramienta:**

- Busca el organismo que la expone (`inspectTools`).
- Si `checkExecutionSafety` (Jev guardrail, solo con `TYPESAFE_API_KEY`) bloquea la ejecución, lanza `GuardrailBlockedError`.
- Ejecuta `org.callTool(name, args)` dentro de `perfTracker.measure`.
- Registra el paso en el reflex con `recordStep`.
- Si no encuentra la herramienta, lanza `ToolExecutionError` con el mensaje "Muta el sistema primero".

## Mutación de célula

`routeStimulus(stimulus)` valida el tipo con `StimulusTypeSchema`, mide con `perfTracker` y llama a `stimulate(type)` en cada organismo.

`BaseOrganisms.stimulate(type)` llama la herramienta MCP `stimulate_differentiation` en el proceso hijo `CellServer`.

En `CellServer`, el handler de `stimulate_differentiation`:

1. `disposeMolecules()`: retira las herramientas MCP y libera los recursos del tipo anterior.
2. `activateTypes(type)`: recorre la cadena de `parent`, crea las moléculas de cada tipo con registro, las inicializa y registra sus herramientas MCP.
3. Actualiza el tipo actual.

Detalle completo en [[biocore-mutation-lifecycle]].

Después de la mutación, `getUnifiedTools()` devuelve el catálogo nuevo. La célula siempre expone un solo tipo a la vez, por eso las mutaciones dentro de un mismo mensaje son secuenciales.

## Cierre y memoria

- `saveReflex()` guarda la secuencia de la sesión en `reflexes` (`ReflexMolecule.save`). Esta tabla es historial: no decide ni se consulta para ejecutar nada.
- `task_completed` y `task_error` se registran en `platform_metrics`. Requiere la fila del tenant en `platform_tenants` (`ensureTenantRecord`).

## Ruta de streaming (`chatStream`)

Esta ruta tiene un comportamiento distinto y debe tenerse en cuenta antes de depender del gate de cadenas:

1. `BaseOrchestrator.chatStream` llama a `trackInput` y `queryReflex`. Si Jev devuelve `hint`, agrega un mensaje `[Memoria Refleja]` y antepone `[Contexto: secuencia sugerida: ...]` al mensaje del usuario.
2. `UnifiedCortex.chatStream` llama a `runConversation(userMessage, streaming = true, signal)`. Esa es la misma ruta que `chat()`: el pendiente de URL, el gate `scrape_url→db_insert`, la pista de Jev, el pre-routing y el bucle del LLM se evalúan igual en streaming y sin streaming.
3. Al terminar, `chatStream` registra la métrica `task_completed` y guarda la secuencia con `saveReflex()`.

Hoy el gate solo funciona en `chat()`. La ruta de streaming (`ProductionServer` → `TenantManager.chatStream`) no lo usa. Corregirlo es una decisión pendiente.

## Tabla de pasos y ubicación

| Paso                | Función                                                              | Archivo                                                     |
| ------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| Entrada             | `chat()`, `chatStream()`                                             | `system/implementations/UnifiedCortex.ts`                   |
| Pendiente y gate    | `runConversation()`, `handleScrapeAndStore()`                        | `UnifiedCortex.ts`                                          |
| Ejecución de cadena | `runScrapeAndStore()`                                                | `UnifiedCortex.ts`                                          |
| Consulta Jev        | `queryReflex()`, `trackInput()`                                      | `system/BaseOrchestrator.ts`                                |
| Selección de cadena | `jevEvaluateAll()`                                                   | `atoms/reflexSelector.ts`                                   |
| Catálogo para Jev   | `buildJevToolCatalog()`                                              | `config/toolCatalog.ts`                                     |
| Pre-routing         | `preRoute()`, `preCellRoute()`                                       | `UnifiedCortex.ts`, `atoms/cellRouter.ts`                   |
| Bucle LLM           | `runConversation()` (bucle de proveedores)                           | `UnifiedCortex.ts`                                          |
| Tool calls          | `executeToolCalls()`                                                 | `UnifiedCortex.ts`                                          |
| Acción              | `executeAction()`                                                    | `system/BaseOrchestrator.ts`                                |
| Mutación            | `routeStimulus()`                                                    | `system/BaseOrchestrator.ts`                                |
| Organismo           | `stimulate()`, `callTool()`, `inspectTools()`                        | `organisms/BaseOrganisms.ts`                                |
| Célula              | `stimulate_differentiation`, `disposeMolecules()`, `activateTypes()` | `cells/CellServer.ts`                                       |
| Historial           | `saveReflex()`, `ReflexMolecule.save()`                              | `system/BaseOrchestrator.ts`, `molecules/ReflexMolecule.ts` |

## Pendientes conocidos

- Gate de cadenas en streaming: ver la sección anterior.
- El pendiente de URL se guarda en memoria del proceso (`pendingChains`), no en base de datos.
- `CHAIN_TABLE` (`jev_chain_results`) es fija. Cada caso de negocio tendrá su propia tabla.

## Relaciones

- Arquitectura por capas: [[biocore-architecture]]
- Cadenas con Jev: [[biocore-jev-pre-routing]]
- Decisiones: [[biocore-decisions]]
- Glosario: [[biocore-glossary]]
- Límites entre capas: [[biocore-boundaries]]

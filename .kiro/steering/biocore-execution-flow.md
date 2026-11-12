---
inclusion: manual
---

# Cómo se ejecuta un mensaje: del chat a la mutación de la célula

Fuentes: `system/implementations/UnifiedCortex.ts`, `system/chainRunner.ts`, `atoms/chainSpec.ts`, `system/BaseOrchestrator.ts`, `organisms/BaseOrganisms.ts`, `cells/CellServer.ts`. Este documento describe el código vigente. Si algo no coincide, el código manda.

## Resumen

Un mensaje entra por `UnifiedCortex.chat()` (no streaming) o `UnifiedCortex.chatStream()`. Ambos llaman a `runConversation`, que intenta resolver el mensaje con código y con Jev antes de llamar a un LLM:

1. Si hay una ejecución pendiente de la sesión, el mensaje responde al dato que faltaba.
2. Si Jev detecta una secuencia que coincide con una cadena declarada en el perfil activo, con similitud ≥ 0.7, la cadena se ejecuta sin LLM.
3. Si Jev sugiere otra secuencia, la agrega como pista en el historial.
4. Si Jev elige una célula, la muta antes del LLM (pre-routing).
5. Si nada de lo anterior resuelve el mensaje, el LLM decide. Sus tool calls se ejecutan con `executeAction`.

El LLM no ejecuta nada por sí mismo. Solo devuelve tool calls, y el código decide cómo ejecutarlas.

## Paso a paso

### 1. Entrada: `chat()` o `chatStream()`

- `chat()` llama a `checkTokenLimit()` y luego a `runConversation(userMessage, false)`. Si todo sale bien, registra `task_completed`. Si falla, registra `task_error` y relanza.
- `chatStream()` hace lo mismo con `runConversation(userMessage, true, signal)`.
- Las dos rutas comparten el gate, la pista de Jev, el pre-routing y el bucle del LLM.

### 2. Ejecución pendiente

`runConversation` revisa `pendingChains` para la sesión. Si hay una:

- Limpia el pendiente y agrega el mensaje al historial.
- Busca la cadena por `chainId` y extrae el dato con el extractor que declara `requires` (`url` o `text`).
- Si el dato aparece, ejecuta la cadena con ese valor.
- Si no aparece, responde `PENDING_DISCARDED_WARNING`. El mensaje no se procesa: el usuario debe reenviarlo.

El pendiente vive en memoria (`DefaultPendingChainStore`), tiene vencimiento de 24 horas y se pierde al reiniciar el proceso.

### 3. Consulta a Jev (`queryReflex`)

Solo si no hay pendiente:

1. `trackInput(cleanText)` registra el input y reinicia el guardarraíl de mutaciones (`_mutatedTypes`).
2. `queryReflex(cleanText)` llama a `DefaultReflexExecutor.queryReflex(input, allowedCells)`. Arma el catálogo con `buildJevToolCatalog(allowedCells)` (filtrado de `tools.json` por las células permitidas) y llama a `jevEvaluateAll`.
3. `jevEvaluateAll` hace dos llamadas a Jev, en secuencia:
   - primer paso, y si la tarea es multi-paso;
   - siguiente paso, con el primero como dato. `ninguno` significa que la tarea termina en un paso.

Jev devuelve un `ReflexMatch` con `record.sequence` y `similarity`.

### 4. Gate de cadenas (sin LLM)

Si `match.similarity ≥ CHAIN_MIN_SIMILARITY (0.7)`, el cortex busca en el perfil una cadena (`findChain`) que cumpla dos condiciones:

- su secuencia de herramientas (`chainSequence`) es igual a la secuencia de Jev, después de normalizar `->` y `→` (`sequenceKey`);
- todas sus células están en `allowedCells` del tenant.

Si no encuentra ninguna, el gate no aplica y el mensaje sigue al paso 5.

Si encuentra una, `handleChain` hace esto:

- Si la cadena declara `requires`, aplica el extractor del requerimiento al mensaje (`EXTRACTORS`: `url` usa `extractUrl`; `text` toma el texto limpio).
- Si el extractor no encuentra el dato, guarda el `chainId` como pendiente y responde con la pregunta del requerimiento (por ejemplo, "¿Cuál es la URL a scrapear?").
- Si lo encuentra, ejecuta `runChainSteps`.

`runChain` (`system/chainRunner.ts`) ejecuta en este orden:

1. **Setup:** si la cadena tiene sentencias `setup`, muta a la célula `memory` y ejecuta cada SQL con `db_query` directo sobre el organismo. Así el DDL no queda como paso del reflex. Por ejemplo, `CREATE TABLE IF NOT EXISTS` crea la tabla de resultados del tenant.
2. **Pasos:** por cada paso del perfil, muta a la célula del paso (`routeStimulus` con `source: "jev-chain"`), resuelve los argumentos y llama a la herramienta con `executeAction`. Los argumentos aceptan `$requires.<nombre>` (dato extraído), `$previous` (salida del paso anterior), `$now` (fecha actual) y literales.

Si un paso falla, la respuesta dice qué falló. Si todo sale bien, la respuesta es el texto `done` de la cadena.

La respuesta se guarda en el historial con `replyAssistant`. No hay llamada al LLM.

Ejemplo del perfil `domain` (`config/domain-profile.ts`), cadena `scrape-store`:

| Paso | Mutación  | Llamada                                                      |
| ---- | --------- | ------------------------------------------------------------ |
| 0    | `memory`  | Setup: `CREATE TABLE IF NOT EXISTS jev_chain_results ...`    |
| 1    | `sensory` | `scrape_url` con `url = $requires.url`                       |
| 2    | `memory`  | `db_insert` en `jev_chain_results` con `payload = $previous` |

### 5. Pista de Jev (`hint`)

Si el gate no aplica y Jev devuelve una secuencia en modo `hint`, se agrega un mensaje de sistema al historial:

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

`UnifiedCortex.chatStream` sobrescribe el de `BaseOrchestrator`. Llama a `runConversation(userMessage, true, signal)`, así que el pendiente, el gate, la pista de Jev, el pre-routing y el bucle del LLM se evalúan igual que en `chat()`.

## Tabla de pasos y ubicación

| Paso                | Función                                                              | Archivo                                                      |
| ------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| Entrada             | `chat()`, `chatStream()`                                             | `system/implementations/UnifiedCortex.ts`                    |
| Pendiente           | `runConversation()`, `pendingChains`                                 | `UnifiedCortex.ts`, `strategies/DefaultPendingChainStore.ts` |
| Consulta Jev        | `queryReflex()`, `trackInput()`                                      | `system/BaseOrchestrator.ts`                                 |
| Selección de cadena | `jevEvaluateAll()`                                                   | `atoms/reflexSelector.ts`                                    |
| Catálogo para Jev   | `buildJevToolCatalog()`                                              | `config/toolCatalog.ts`                                      |
| Gate de cadenas     | `findChain()`, `handleChain()`, `runChainSteps()`                    | `UnifiedCortex.ts`                                           |
| Ejecución de cadena | `runChain()`, `resolveArgs()`                                        | `system/chainRunner.ts`, `atoms/chainSpec.ts`                |
| Extractores         | `EXTRACTORS`, `extractUrl()`                                         | `atoms/chainSpec.ts`, `atoms/chainExtraction.ts`             |
| Pre-routing         | `preRoute()`, `preCellRoute()`                                       | `UnifiedCortex.ts`, `atoms/cellRouter.ts`                    |
| Bucle LLM           | `runConversation()` (bucle de proveedores)                           | `UnifiedCortex.ts`                                           |
| Tool calls          | `executeToolCalls()`                                                 | `UnifiedCortex.ts`                                           |
| Acción              | `executeAction()`                                                    | `system/BaseOrchestrator.ts`                                 |
| Mutación            | `routeStimulus()`                                                    | `system/BaseOrchestrator.ts`                                 |
| Organismo           | `stimulate()`, `callTool()`, `inspectTools()`                        | `organisms/BaseOrganisms.ts`                                 |
| Célula              | `stimulate_differentiation`, `disposeMolecules()`, `activateTypes()` | `cells/CellServer.ts`                                        |
| Historial           | `saveReflex()`, `ReflexMolecule.save()`                              | `system/BaseOrchestrator.ts`, `molecules/ReflexMolecule.ts`  |

## Pendientes conocidos

- El pendiente se guarda en memoria del proceso. Un reinicio lo borra.
- Las cadenas se declaran en `domain-profile.ts`. Un perfil sin cadenas no activa el gate.

## Relaciones

- Arquitectura por capas: [[biocore-architecture]]
- Cadenas con Jev: [[biocore-jev-pre-routing]]
- Decisiones: [[biocore-decisions]]
- Glosario: [[biocore-glossary]]
- Límites entre capas: [[biocore-boundaries]]

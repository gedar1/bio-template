---
inclusion: fileMatch
fileMatchPattern: "**/packages/core/src/**"
---

# BioCore - Glosario

Definiciones de los componentes tal como existen en `packages/core/src`. Para el flujo completo, ver [[biocore-execution-flow]].

## Jev (TypeSafe System One)

Modelo de TypeSafe que devuelve decisiones tipadas. BioCore lo usa para elegir cadenas de herramientas y tipos de célula sin llamar al LLM.

- **Archivo:** `atoms/reflexSelector.ts` (`jevEvaluateAll`)
- **Llamadas:** dos secuenciales por mensaje. La primera pregunta por el primer paso y si la tarea es multi-paso, con el catálogo completo. La segunda pregunta por el siguiente paso, con el primero como dato. `ninguno` significa que la tarea termina en un paso.
- **Salida:** `ReflexSelection` con `record.sequence`, `confidence` y `source: "jev"`.
- **Umbral:** `REFLEX_SELECTION_THRESHOLD = 0.7` es una guardia para que no se formen cadenas de baja confianza.
- **Consumo:** los logs reportan entre 550 y 700 tokens de entrada y unos 150 de salida por llamada. No hay medición en otro entorno.
- **Relacionado:** [[biocore-jev-pre-routing]], [[biocore-execution-flow]]

## Gate de cadenas

Paso de `UnifiedCortex.runConversation` que ejecuta sin LLM una cadena declarada en el perfil (`domain-profile.ts`, campo `chains`) cuando Jev sugiere su secuencia con similitud ≥ `CHAIN_MIN_SIMILARITY` (0.7, en `atoms/chainExtraction.ts`). Si la cadena pide un dato y el mensaje no lo trae, guarda un pendiente con vencimiento de 24 horas (`DefaultPendingChainStore`). El siguiente mensaje de la misma sesión intenta completar la cadena. El pendiente vive en memoria y se pierde al reiniciar el proceso.

- **Aplica en `chat()` y `chatStream()`.** Ambas rutas llaman a `runConversation`.
- **Declaración:** cada perfil define sus cadenas. Un perfil sin cadenas no activa el gate.
- **Relacionado:** [[biocore-execution-flow]]

## Pre-router

Paso de `UnifiedCortex.preRoute` que elige un tipo de célula con `preCellRoute` (`atoms/cellRouter.ts`) y lo muta antes del LLM. Se omite si ese tipo ya se mutó en el mensaje.

- **Relacionado:** [[biocore-llm-decision-flow]]

## Cortex

Cerebro del tenant. `UnifiedCortex` recorre los proveedores configurados, y cada uno tiene su propio circuit breaker.

- **Archivo:** `system/implementations/UnifiedCortex.ts`
- **Proveedores:** `system/providers/` contiene `AnthropicProvider`, `GeminiProvider` y `NvidiaProvider`.
- **Orden:** `providerConfig.primaryProvider`, seguido de `fallbackOrder`. El orden lo define la configuración, no una función de selección por contenido.
- **Otros archivos:** `GeminiCortex.ts`, `ClaudeCortex.ts` y `NvidiaCortex.ts` están en `system/implementations/`. El flujo activo que usa el servidor es `UnifiedCortex`.
- **Relacionado:** [[biocore-llm-decision-flow]], [[biocore-execution-flow]]

## Orquestador

Centro del sistema. Conecta organismos, unifica herramientas y difunde mutaciones.

- **Archivo:** `system/BaseOrchestrator.ts`
- **Métodos clave:** `routeStimulus()`, `getUnifiedTools()`, `executeAction()`, `trackInput()`, `queryReflex()`, `saveReflex()`
- **Relacionado:** [[biocore-stimulus-sources]], [[biocore-architecture]]

## Organismo

Controlador de una célula. Lanza la célula como proceso hijo y se comunica con ella por MCP.

- **Archivo:** `organisms/BaseOrganisms.ts`
- **Métodos clave:** `stimulate()`, `inspectTools()`, `callTool()`, `getAllowedCells()`
- **Relacionado:** [[biocore-mutation-lifecycle]]

## Célula

Servidor MCP que cambia de tipo según el estímulo. Expone solo las herramientas del tipo activo.

- **Archivo:** `cells/CellServer.ts`
- **Tipos con registro integrado:** `memory`, `http`, `filesystem`, `communication`, `versioncontrol`, `sensory`, `system`, `realtime`
- **Sin registro integrado:** `sensory_advanced` y `monitor`. Están en `registry.json` y no se anuncian al LLM.
- **Estado inicial:** `undifferentiated`, sin herramientas.
- **Relacionado:** [[biocore-mutation-lifecycle]], [[biocore-llm-decision-flow]]

## Molécula

Capacidad concreta con recursos propios (base de datos, HTTP, scraping, email, Git, sistema, WebSocket). Una molécula no depende de otra.

- **Directorio:** `molecules/*.ts`
- **Moléculas de capacidad:** `DatabaseMolecule`, `HTTPMolecule`, `ScraperMolecule`, `FileSystemMolecule`, `GmailMolecule`, `WhatsAppMolecule`, `GitMolecule`, `SystemMolecule`, `WebSocketMolecule`
- **Moléculas de soporte:** `ReflexMolecule` (historial de secuencias), `HistoryMolecule`
- **Molécula de dominio de ejemplo:** `ExampleMolecule`
- **Relacionado:** [[biocore-mutation-lifecycle]]

## Átomo

Función pura sin estado ni efectos. No importa moléculas, células, organismos ni el sistema.

- **Directorio:** `atoms/*.ts`
- **Funciones de esquema y herramientas:** `cleanSchemaForLLM()`, `deduplicateTools()` (`schema.ts`); `formatToolsForAnthropic()`, `formatToolsForGemini()`, `formatToolsForOpenAI()` (`toolFormat.ts`)
- **Funciones de registro:** `resolveTools()`, `resolveAllTools()` (`registry.ts`)
- **Funciones de Jev:** `jevEvaluateAll()` (`reflexSelector.ts`); `preCellRoute()` (`cellRouter.ts`); `extractUrl()` (`chainExtraction.ts`); `chainSequence()`, `sequenceKey()`, `resolveArgs()` (`chainSpec.ts`)
- **Exportado sin uso en el chat:** `chooseModel()` (`modelSelection.ts`). El proveedor se elige por configuración, no por esta función.
- **Relacionado:** [[biocore-what-llm-receives]]

## Estímulo (IStimulus)

Orden de mutación con trazabilidad: `type`, `source`, `metadata` y `timestamp`.

- **Archivo:** `system/interfaces/IStimulus.ts`
- **Relacionado:** [[biocore-stimulus-sources]], [[biocore-execution-flow]]

## Mutación

Cambio de tipo de una célula. Se hace en dos pasos: `disposeMolecules()` libera el tipo anterior y `activateTypes(tipo)` activa el nuevo a partir de la cadena de `parent`.

- **Archivo:** `cells/CellServer.ts`
- **Relacionado:** [[biocore-mutation-lifecycle]]

## Registry

Archivo JSON que define los tipos de célula: `type`, `description`, `parent` opcional y `tools` declaradas.

- **Archivos:** `config/registry.json` (core) y `config/domain-registry.json` (dominio)
- **Fusión:** `loadApplicationRegistry()` en `config/mergeRegistry.ts`. `assertUniqueTypes` lanza `RegistryConfigurationError` si un registro repite un tipo.
- **Nota:** `tools` es declarativo. La herramienta solo se anuncia si la célula tiene un handler registrado.
- **Relacionado:** [[biocore-what-llm-receives]], [[biocore-llm-decision-flow]]

## Memoria Refleja (historial)

`ReflexMolecule` guarda las secuencias de herramientas de cada sesión que terminó bien. `saveReflex()` lo llama al final de `chat()`.

- **Archivo:** `molecules/ReflexMolecule.ts`
- **No decide nada.** `DefaultReflexExecutor.queryReflex` consulta a Jev sobre el catálogo de `tools.json`, no sobre estas secuencias guardadas. Las secuencias guardadas no son candidatas a ejecución.
- **Modo:** solo HINT. Los modos de ejecución directa y los umbrales adaptativos se retiraron. Ver [[biocore-decisions]].
- **Relacionado:** [[biocore-architecture]], [[biocore-execution-flow]]

## MCP External Server

Servidor que expone BioCore a IDEs como herramientas MCP. Cada herramienta llama a `tenantManager.chat`, así que pasa por el cortex.

- **Transporte stdio:** `server/MCPExternalServer.ts`. El IDE lanza el proceso.
- **Transporte HTTP (Streamable HTTP):** `server/MCPHttpServer.ts`, con `startMCPHttpServer`. Pensado para equipos.
- **Herramientas:** `biocore_execute`, `biocore_scrape`, `biocore_db_query`, `biocore_http`, `biocore_git`, `biocore_email`, `biocore_cli`, `biocore_status`
- **Relacionado:** [[biocore-stimulus-sources]]

## Perfil de tenant (TenantProfile)

Configuración que decide qué células puede ver un tenant y qué agente de dominio usa.

- **Archivos:** `config/domain-profile.ts` (el perfil del dominio) y `config/profileRegistry.ts` (esquema del perfil)
- **Campos:** `allowedCells` (mínimo un tipo), `agentFile` (ruta del `.md`), `description` opcional, `chains` opcional (cadenas que el gate puede ejecutar sin LLM)
- **Relacionado:** [[biocore-architecture]]

## Agente de dominio

Archivo markdown que se agrega como mensaje de sistema al cortex del tenant.

- **Archivos:** `config/domain-agent.md` (el que referencia el perfil del dominio) y `config/agents/dev-agent.md`
- **Carga:** `TenantManager.loadAgentFile()`, al crear el cortex del tenant
- **Relacionado:** [[biocore-what-llm-receives]]

## TenantDatabaseManager

Da una base de datos aislada a cada tenant para sus datos de negocio.

- **Archivo:** `infrastructure/TenantDatabaseManager.ts`
- **Estructura:** `DATABASE_PATH` (compartida, por defecto `./data/biocore.db`) guarda `platform_*`, reflexes y estado de plantillas. `DATABASE_DIR/tenants/<tenant>.db` guarda los datos del negocio.
- **Relacionado:** [[biocore-architecture]]

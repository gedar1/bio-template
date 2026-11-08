---
inclusion: fileMatch
fileMatchPattern: "packages/core/src/**"
---

# 🏗️ BioCore - Arquitectura

Fuentes de verdad: `docs/DECISIONS-AND-CONFIG.md` (decisiones y configuración) y `.kiro/steering/biocore-jev-pre-routing.md` (flujo de cadenas).

## Capas del Sistema

```
Usuario / Dashboard / API / Scheduler / CLI
              ↓
┌─────────────────────────────────┐
│ Servidor HTTP                   │ ProductionServer, HealthServer, RouteRegistry, rutas en server/routes/
└──────────────┬──────────────────┘
               ↓
┌─────────────────────────────────┐
│ Cortex                          │ UnifiedCortex — gate de cadenas (Jev), luego LLM con fallback
└──────────────┬──────────────────┘
               ↓
┌─────────────────────────────────┐
│ Orquestador                     │ BaseOrchestrator — unifica herramientas, difunde mutaciones, ejecuta acciones
└──────────────┬──────────────────┘
               ↓
┌─────────────────────────────────┐
│ Organismo                       │ BaseOrganisms — controla una célula MCP como proceso hijo
└──────────────┬──────────────────┘
               ↓
┌─────────────────────────────────┐
│ Célula                          │ CellServer — servidor MCP, muta de tipo y expone solo sus herramientas
└──────────────┬──────────────────┘
               ↓
┌─────────────────────────────────┐
│ Molécula                        │ Lógica de negocio (DB, HTTP, scraper, git, email, dominio)
└──────────────┬──────────────────┘
               ↓
┌─────────────────────────────────┐
│ Átomo                           │ Funciones puras (schema, toolFormat, cellRouter, reflexSelector, chainExtraction, sequence, paths)
└─────────────────────────────────┘
```

## Archivos Clave

| Capa              | Archivo                                                              | Responsabilidad                                                                                                                                                                                                                               |
| ----------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cortex            | `system/implementations/UnifiedCortex.ts`                            | Gate de cadenas, pista de Jev, pre-routing de célula, chat loop con proveedores y fallback                                                                                                                                                    |
| Runner de cadenas | `system/chainRunner.ts`                                              | Ejecuta los pasos de una cadena declarada en el perfil a través de un puerto (setup, mutar, llamar herramienta)                                                                                                                               |
| Orquestador       | `system/BaseOrchestrator.ts`                                         | Registra organismos, `routeStimulus`, `executeAction`, `queryReflex`, `trackInput`, `saveReflex`                                                                                                                                              |
| Estrategias       | `system/strategies/`                                                 | `IReflexExecutor` / `DefaultReflexExecutor` (consulta a Jev e historial), `IPendingChainStore` / `DefaultPendingChainStore` (pendientes 24 h), `IHistoryManager`, `IPerfTracker`                                                              |
| Organismo         | `organisms/BaseOrganisms.ts`                                         | Lanza `CellServer` como proceso hijo; `stimulate`, `inspectTools`, `callTool`                                                                                                                                                                 |
| Célula            | `cells/CellServer.ts`                                                | Muta de tipo (`disposeMolecules` → `activateTypes`, que recorre `parent` y registra herramientas por tipo); registra `db_*`, `scrape_url`, `read_file`, etc.                                                                                  |
| Moléculas         | `molecules/*.ts`                                                     | `DatabaseMolecule` (SQLite del tenant), `ReflexMolecule` (historial de cadenas), `ExampleMolecule` (dominio), HTTP, scraper, git, email                                                                                                       |
| Átomos            | `atoms/*.ts`                                                         | Puros: `schema.ts` (limpieza de schemas), `toolFormat.ts`, `cellRouter.ts`, `reflexSelector.ts` (`jevEvaluateAll`), `chainExtraction.ts`, `chainSpec.ts` (extractores y secuencias de cadenas), `sequence.ts`, `paths.ts` (`resolveDataPath`) |
| Catálogo Jev      | `config/toolCatalog.ts` + `config/tools.json`                        | Herramientas que Jev puede elegir, filtradas por células permitidas                                                                                                                                                                           |
| Registry          | `config/registry.json`, `config/domain-registry.json`                | Tipos de célula y sus herramientas                                                                                                                                                                                                            |
| Perfiles          | `config/domain-profile.ts`, `config/profileRegistry.ts`              | `allowedCells`, agente, descripción y `chains` (cadenas que el gate ejecuta sin LLM)                                                                                                                                                          |
| Tenants           | `server/TenantManager.ts`, `infrastructure/TenantDatabaseManager.ts` | Aísla cortex, base de datos y perfil por tenant                                                                                                                                                                                               |
| Plataforma        | `server/services/platformSchema.ts`                                  | Tablas `platform_*` en la base compartida                                                                                                                                                                                                     |
| Logger            | `config/logger.ts`, `config/ILogger.ts`                              | Pino con `createLogger("Componente")`                                                                                                                                                                                                         |
| Telemetría        | `config/telemetry.ts`                                                | OpenTelemetry, `startSpan`, `measureSpan`                                                                                                                                                                                                     |

## Bases de datos

| Base       | Ruta                                              | Contenido                                                                  |
| ---------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| Compartida | `DATABASE_PATH` (por defecto `./data/biocore.db`) | `platform_*`, `reflexes` (historial), `template_state`, `mutation_history` |
| Por tenant | `DATABASE_DIR/tenants/<tenant>.db`                | Datos del negocio: `db_*`, `ExampleMolecule`, `jev_chain_results`          |

Las rutas relativas se resuelven desde la raíz del proyecto (`resolveDataPath`). No dependen del directorio de trabajo.

## Patrones Usados

| Patrón               | Dónde                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| Strategy (DI)        | `BaseOrchestrator` delega en `IReflexExecutor`, `IPendingChainStore`, `IHistoryManager`, `IPerfTracker` |
| Gate de cadenas      | `UnifiedCortex.runConversation`: Jev sugiere; el código decide si ejecuta sin LLM                       |
| Mutación de célula   | `CellServer` cambia de tipo; cada tipo expone sus herramientas                                          |
| Pendiente de usuario | Una ejecución espera un dato (la URL) y se reanuda con el siguiente mensaje                             |
| Circuit Breaker      | Fallback entre proveedores LLM en `UnifiedCortex`                                                       |
| Interface + Adapter  | `ILogger` + `PinoLoggerAdapter`                                                                         |

## Memoria de cadenas (historial)

`ReflexMolecule` guarda la secuencia de herramientas ejecutada como historial. **No decide nada.**

- La selección de cadenas la hace Jev sobre `tools.json` (ver `biocore-jev-pre-routing.md`).
- Los umbrales adaptativos, el modo `reflex` y la búsqueda por embeddings se retiraron.
- La columna `embedding` de `reflexes` queda vacía por compatibilidad.
- El dashboard muestra el conteo de ejecuciones y la última vez usada.

## Relaciones

- Flujo de ejecución completo: [[biocore-execution-flow]]
- Flujo de cadenas con Jev: [[biocore-jev-pre-routing]]
- Decisiones: [[biocore-decisions]]
- Glosario: [[biocore-glossary]]
- Límites entre capas: [[biocore-boundaries]]

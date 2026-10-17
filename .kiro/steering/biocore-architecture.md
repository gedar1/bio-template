---
inclusion: fileMatch
fileMatchPattern: "packages/core/src/**"
---

# 🏗️ BioCore - Arquitectura

Fuente completa: #[[file:docs/biocore/biocore-architecture.md]]

## Capas del Sistema

```
Usuario / API / Webhook / Scheduler / CLI / IDE (via MCP)
              ↓
┌─────────────────────────────────┐
│ MCP External Server             │ MCPHttpServer / MCPExternalServer — Expone BioCore a IDEs
└──────────────┬──────────────────┘
               ↓
┌─────────────────────────────────┐
│ [[biocore-glossary#Cortex]]     │ UnifiedCortex — Fallback: Gemini → Claude → NVIDIA
└──────────────┬──────────────────┘
               ↓
┌─────────────────────────────────┐
│ Orquestador                     │ BaseOrchestrator — Unifica herramientas, difunde mutaciones
└──────────────┬──────────────────┘
               ↓
┌─────────────────────────────────┐
│ [[biocore-glossary#Organismo]]  │ BaseOrganisms — Sub-agentes MCP, controlan células
└──────────────┬──────────────────┘
               ↓
┌─────────────────────────────────┐
│ [[biocore-glossary#Célula]]     │ CellServer — Servidor MCP dinámico, muta según estímulo
└──────────────┬──────────────────┘
               ↓
┌─────────────────────────────────┐
│ [[biocore-glossary#Molécula]]   │ Lógica de negocio (DB, HTTP, Scraper, Git, Email, etc.)
└──────────────┬──────────────────┘
               ↓
┌─────────────────────────────────┐
│ [[biocore-glossary#Átomo]]      │ Funciones puras (schema, toolFormat, modelSelection)
└─────────────────────────────────┘
```

## Archivos Clave

| Capa            | Archivo                                   | Responsabilidad                                                           |
| --------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| Cortex          | `system/implementations/UnifiedCortex.ts` | Selecciona modelo, ejecuta chat loops, fallback 3 niveles                 |
| Cortex NVIDIA   | `system/implementations/NvidiaCortex.ts`  | Cortex con NVIDIA NIM API (Nemotron 49B, tool calling)                    |
| Orquestador     | `system/BaseOrchestrator.ts`              | Orquestación pura: register, route, execute, stream. Delega a strategies  |
| Estrategias     | `system/strategies/*.ts`                  | IReflexExecutor, IHistoryManager, IPerfTracker + Default implementations  |
| Organismo       | `organisms/BaseOrganisms.ts`              | Controla célula MCP como proceso hijo                                     |
| Célula          | `cells/CellServer.ts`                     | Muta dinámicamente, instancia moléculas                                   |
| Moléculas       | `molecules/*.ts`                          | Lógica de negocio reutilizable                                            |
| Átomos          | `atoms/*.ts`                              | Funciones puras sin estado                                                |
| Paths           | `atoms/paths.ts`                          | `getModuleDir()`, `getProjectRoot()` — resolución de rutas centralizada   |
| Tool Format     | `atoms/toolFormat.ts`                     | `formatToolsForAnthropic`, `formatToolsForGemini`, `formatToolsForOpenAI` |
| Config          | `config/registry.json`                    | Define tipos de célula y herramientas                                     |
| Logger          | `config/ILogger.ts`                       | Interfaz `ILogger` + `PinoLoggerAdapter` (DI para logging)                |
| Telemetría      | `config/telemetry.ts`                     | Bootstrap OpenTelemetry SDK, `startSpan`, `measureSpan`                   |
| Memoria Refleja | `molecules/ReflexMolecule.ts`             | Guarda/recupera secuencias por similitud semántica                        |
| Embeddings      | `atoms/embeddings.ts`                     | `computeEmbedding`, `cosineSimilarity`, `preloadPipeline` ($0)            |
| Interpolación   | `atoms/interpolation.ts`                  | `deriveTemplate`, `interpolateTemplate`, serialización ArgTemplates       |
| Param Extractor | `atoms/paramExtractor.ts`                 | `extractParamsFromText` — extrae URL, tabla, path del texto               |
| Infraestructura | `infrastructure/*.ts`                     | `PerfMonitor`, `CircuitBreaker`, `Scheduler`, `TenantDatabaseManager`     |
| RouteRegistry   | `server/RouteRegistry.ts`                 | Registro centralizado de 14 rutas con error handling individual           |
| MCP Local       | `server/MCPExternalServer.ts`             | MCP Server stdio para uso individual en IDE local                         |
| MCP Remoto      | `server/MCPHttpServer.ts`                 | MCP Server HTTP para equipos (Streamable HTTP Transport)                  |
| Tenant Manager  | `server/TenantManager.ts`                 | Multi-tenant: aísla cortex, BD, perfil y agente por cliente               |
| Agentes Dominio | `config/agents/*.md`                      | System prompts por industria (restaurante, clínica, dev, ecommerce)       |
| Perfiles        | `config/tenant-profiles.json`             | Células permitidas + agentFile por perfil                                 |

## Patrones Usados

| Patrón               | Dónde                                                                  | Relación                           |
| -------------------- | ---------------------------------------------------------------------- | ---------------------------------- |
| Strategy (DI)        | BaseOrchestrator delega a IReflexExecutor/IHistoryManager/IPerfTracker | `system/strategies/`               |
| Strategy (model)     | Cortex elige modelo                                                    | Ver [[biocore-llm-decision-flow]]  |
| Observer             | Orquestador difunde mutaciones                                         | Ver [[biocore-stimulus-sources]]   |
| Factory              | CellServer instancia moléculas                                         | Ver [[biocore-mutation-lifecycle]] |
| State Machine        | Célula cambia de estado                                                | Ver [[biocore-mutation-lifecycle]] |
| Circuit Breaker      | Fallback entre modelos                                                 | Ver [[biocore-execution-flow]]     |
| Decorator            | `measureSpan` wrappea funciones async con spans OTel                   | `config/telemetry.ts`              |
| Procedural Memory    | `ReflexMolecule` aprende y reutiliza secuencias exitosas               | `molecules/ReflexMolecule.ts`      |
| Centralized Registry | `RouteRegistry` registra las 14 rutas del servidor                     | `server/RouteRegistry.ts`          |
| Interface + Adapter  | `ILogger` + `PinoLoggerAdapter` desacopla logging                      | `config/ILogger.ts`                |

## Memoria Refleja (Procedural Memory)

BioCore implementa **memoria procedural** — el sistema aprende qué secuencia de herramientas resuelve cada tipo de tarea y la reutiliza automáticamente.

```
Input usuario
   ↓ normalizeForEmbedding()  ← elimina URLs/emails/IPs concretas
   ↓ computeEmbedding()       ← vector 384 dims, modelo multilingüe, $0
   ↓ HNSW opcional                ← búsqueda O(log n), fallback lineal O(n)
   ↓ compositeScore           ← similarity × temporalDecay × reliabilityBoost
   ↓
┌─────────────────────────────────────────────────────────────┐
│ sim ≥ adaptiveThreshold + éxitos ≥ 3 → REFLEX              │
│   interpolateTemplate() resuelve $URL, $TABLE del input     │
│   Ejecuta secuencia directamente sin LLM                    │
│   chainOutputTo: paso N → paso N+1 declarativo              │
│   0 tokens consumidos                                       │
├─────────────────────────────────────────────────────────────┤
│ sim ≥ 0.80 → HINT                                           │
│   Inyecta secuencia como contexto al LLM                    │
│   ~40% menos razonamiento                                   │
├─────────────────────────────────────────────────────────────┤
│ sim < 0.80 → NORMAL                                         │
│   Loop LLM completo → guarda reflex con ArgTemplate al fin  │
└─────────────────────────────────────────────────────────────┘
```

### Componentes involucrados

| Componente                                   | Responsabilidad                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| `atoms/embeddings.ts`                        | `computeEmbedding`, `cosineSimilarity`, `preloadPipeline` (local, $0)          |
| `atoms/interpolation.ts`                     | `deriveTemplate`, `interpolateTemplate`, serialización de ArgTemplates         |
| `atoms/paramExtractor.ts`                    | `extractParamsFromText` — extrae URL, tabla, path, email del texto del usuario |
| `molecules/ReflexMolecule.ts`                | SQLite + HNSW index, temporal decay, adaptive threshold, schema versioning     |
| `system/strategies/DefaultReflexExecutor.ts` | Lógica completa de reflex: query, execute, save, schema versions               |
| `system/BaseOrchestrator.ts`                 | `chatStream` → delega a IReflexExecutor, facade methods                        |
| `infrastructure/PerfMonitor`                 | `ReflexMetrics`: hit/miss rate, token savings, degradation tracking            |

### Modelo de embeddings

- **Modelo:** `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (via `@xenova/transformers`)
- **Dimensión:** 384 números por vector
- **Velocidad:** ~5ms por embedding en CPU (pre-cargado al boot)
- **Costo:** $0 siempre — 100% local, sin API externa
- **Idiomas:** 50+ incluyendo español e inglés con cross-language ~0.80

## Relaciones

- El flujo de ejecución completo está en [[biocore-execution-flow]]
- Cómo el LLM recibe las herramientas está en [[biocore-what-llm-receives]]
- La comparación con arquitectura tradicional está en [[biocore-tools-comparison]]
- Las fuentes de estímulo están en [[biocore-stimulus-sources]]
- Las decisiones arquitectónicas están en [[biocore-decisions]]

---
inclusion: fileMatch
fileMatchPattern: "**/packages/core/src/**"
---

# 📖 BioCore - Glosario

Fuente completa: #[[file:docs/biocore/biocore-glossary.md]]

## Cortex

El cerebro del sistema. Selecciona qué modelo LLM usar (Gemini/Claude/NVIDIA), ejecuta loops de chat y maneja Circuit Breakers para fallback automático entre 3 proveedores.

- **Archivo:** `system/implementations/UnifiedCortex.ts`
- **Implementaciones:** `GeminiCortex`, `ClaudeCortex`, `NvidiaCortex`, `UnifiedCortex` (maestro con fallback)
- **Hereda de:** `BaseOrchestrator`
- **Cadena de fallback:** Gemini → Claude → NVIDIA (configurable)
- **Relacionado:** [[biocore-llm-decision-flow]], [[biocore-execution-flow]]

## Orquestador

El sistema nervioso. Centraliza la gestión de organismos, unifica herramientas y difunde señales de mutación. Es la capa que conecta todo.

- **Archivo:** `system/BaseOrchestrator.ts`
- **Métodos clave:** `routeStimulus()`, `getUnifiedTools()`, `executeAction()`
- **Relacionado:** [[biocore-stimulus-sources]], [[biocore-architecture]]

## Organismo

Un sub-agente especializado que controla una célula MCP como proceso hijo. Se comunica con la célula via JSON-RPC 2.0 (Model Context Protocol).

- **Archivo:** `organisms/BaseOrganisms.ts`
- **Métodos clave:** `stimulate()`, `inspectTools()`, `callTool()`
- **Relacionado:** [[biocore-execution-flow]]

## Célula

Un servidor MCP dinámico que muta según el estímulo recibido. Cuando muta, cierra las moléculas anteriores e instancia las nuevas.

- **Archivo:** `cells/CellServer.ts`
- **Estados posibles:** `undifferentiated`, `sensory`, `memory`, `filesystem`, `communication`, `versioncontrol`, `http`, `system`, `monitor`
- **Relacionado:** [[biocore-mutation-lifecycle]], [[biocore-tools-comparison]]

## Molécula

Lógica de negocio reutilizable. Cada molécula implementa una capacidad concreta (BD, HTTP, scraping, email, etc.). Son agnósticas al LLM.

- **Directorio:** `molecules/*.ts`
- **Moléculas:** DatabaseMolecule, HTTPMolecule, ScraperMolecule, FileSystemMolecule, GmailMolecule, GitMolecule, SystemMolecule, WhatsAppMolecule
- **Relacionado:** [[biocore-mutation-lifecycle]]

## Átomo

Funciones puras sin estado ni efectos secundarios. Utilidades compartidas por todas las capas.

- **Directorio:** `atoms/*.ts`
- **Funciones:** `cleanSchemaForLLM()`, `deduplicateTools()`, `formatToolsForAnthropic()`, `formatToolsForGemini()`, `formatToolsForOpenAI()`, `chooseModel()`, `resolveTools()`
- **Relacionado:** [[biocore-what-llm-receives]]

## Estímulo (IStimulus)

Una señal que provoca la mutación de una célula. Puede venir de cualquier fuente (LLM, API, CLI, webhook, scheduler, etc.). Incluye trazabilidad: `type`, `source`, `metadata`, `timestamp`.

- **Archivo:** `system/interfaces/IStimulus.ts`
- **Relacionado:** [[biocore-stimulus-sources]], [[biocore-execution-flow]]

## Mutación

El proceso por el cual una célula cambia de estado. Cierra moléculas anteriores (`disposeMolecules`), instancia nuevas (`initializeMolecules`) y registra herramientas MCP (`registerToolsForType`).

- **Relacionado:** [[biocore-mutation-lifecycle]], [[biocore-tools-comparison]]

## Registry

Archivo JSON que define qué tipos de célula existen, qué herramientas tiene cada una y las relaciones de herencia entre tipos.

- **Archivo:** `config/registry.json`
- **Relacionado:** [[biocore-what-llm-receives]], [[biocore-llm-decision-flow]]

## Memoria Refleja (Reflex)

Sistema de memoria procedural que aprende secuencias exitosas de herramientas y las reutiliza sin LLM. Usa embeddings semánticos locales para comparar intención, no palabras exactas.

- **Archivo:** `molecules/ReflexMolecule.ts`
- **Modos:** REFLEX (ejecución directa, 0 tokens), HINT (inyecta contexto al LLM), NORMAL (LLM completo)
- **Relacionado:** [[biocore-architecture]], [[biocore-execution-flow]]

## ArgTemplate

Plantilla parametrizada que captura la estructura de argumentos de un reflex exitoso. Usa placeholders (`$URL`, `$TABLE`, `$PATH`) que se interpolan con valores del input actual al re-ejecutar.

- **Archivo:** `atoms/interpolation.ts`
- **Funciones:** `deriveTemplate()`, `interpolateTemplate()`, `serializeArgTemplates()`
- **Relacionado:** [[biocore-architecture]]

## Interpolation Engine

Componente que resuelve placeholders en un ArgTemplate extrayendo valores del texto del usuario. Si un placeholder requerido (URL, email, path, table) no se encuentra, degrada a HINT_Mode.

- **Archivo:** `atoms/interpolation.ts`, `atoms/paramExtractor.ts`
- **Función principal:** `interpolateTemplate(template, extractedParams)`
- **Relacionado:** [[biocore-architecture]]

## Temporal Decay

Factor multiplicativo que reduce el peso de reflexes antiguos. Usa decaimiento exponencial con half-life de 30 días: un reflex sin usar por 30 días tiene 50% de peso.

- **Archivo:** `molecules/ReflexMolecule.ts`
- **Fórmula:** `0.5 ^ (daysSinceUse / halfLifeDays)`
- **Relacionado:** [[biocore-architecture]]

## Adaptive Threshold

Umbral dinámico de similitud para activar modo REFLEX. Reflexes con alto ratio de éxito se activan a menor similitud (hasta 0.875); reflexes con fallos requieren mayor similitud (hasta 1.0).

- **Archivo:** `molecules/ReflexMolecule.ts`
- **Rango:** [0.80, 1.0], default 0.95
- **Relacionado:** [[biocore-architecture]]

## MCP External Server

Servidor MCP que expone BioCore como proveedor de herramientas para IDEs. Permite que VS Code, Kiro, Cursor o Claude Code consuman las capacidades de BioCore via MCP protocol.

- **Archivo (stdio):** `server/MCPExternalServer.ts` — transport local, el IDE lanza el proceso
- **Archivo (HTTP):** `server/MCPHttpServer.ts` — transport remoto, servidor centralizado para equipos
- **Herramientas expuestas:** `biocore_execute`, `biocore_scrape`, `biocore_db_query`, `biocore_http`, `biocore_git`, `biocore_email`, `biocore_cli`, `biocore_status`
- **Protocolo:** MCP Streamable HTTP (spec 2025-03-26)
- **Relacionado:** [[biocore-architecture]]

## NvidiaCortex

Implementación de Cortex usando NVIDIA NIM API con modelo Llama 3.3 Nemotron Super 49B. Soporta tool calling completo y actúa como tercer nivel de fallback en el UnifiedCortex.

- **Archivo:** `system/implementations/NvidiaCortex.ts`
- **Modelo:** `nvidia/llama-3.3-nemotron-super-49b-v1` (optimizado para tareas agénticas)
- **API:** OpenAI-compatible (`integrate.api.nvidia.com/v1/chat/completions`)
- **Formato tools:** `formatToolsForOpenAI()` — formato function calling estándar OpenAI
- **Relacionado:** [[biocore-architecture]]

## Perfil de Tenant (TenantProfile)

Configuración por industria que determina qué capacidades tiene un tenant. Define las células permitidas y el archivo de agente de dominio.

- **Archivo:** `config/tenant-profiles.json`
- **Perfiles:** `dev`, `restaurant`, `clinic`, `ecommerce`
- **Campos:** `allowedCells` (tipos de célula), `agentFile` (prompt de dominio)
- **Relacionado:** [[biocore-architecture]]

## Agente de Dominio

Archivo markdown que define el system prompt completo para una industria. Incluye rol, vocabulario, capacidades, flujos típicos y reglas de comportamiento.

- **Directorio:** `config/agents/*.md`
- **Archivos:** `restaurant-agent.md`, `dev-agent.md`, `clinic-agent.md`, `ecommerce-agent.md`
- **Se inyecta como:** mensaje `role: "system"` al crear el tenant
- **Relacionado:** [[biocore-architecture]]

## TenantDatabaseManager

Gestiona bases de datos aisladas por tenant. Datos de negocio (pedidos, inventario) van en BD separada por tenant; datos del sistema (reflexes, métricas) van en BD compartida.

- **Archivo:** `infrastructure/TenantDatabaseManager.ts`
- **Estructura:** `data/biocore-shared.db` (compartida) + `data/tenants/{tenantId}.db` (aislada)
- **Relacionado:** [[biocore-architecture]]

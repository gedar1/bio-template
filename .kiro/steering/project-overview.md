---
inclusion: always
---

# BioCore — Resumen del Proyecto

## Qué es

Motor de automatización con mutación dinámica de herramientas. El LLM es opcional — el sistema puede operar con scheduler, webhooks, CLI o API REST.

## Concepto clave

En lugar de cargar 50+ herramientas al LLM, BioCore expone solo `stimulate_differentiation`. El LLM elige un tipo (sensory, memory, filesystem, etc.) y el sistema muta dinámicamente, cargando solo las herramientas relevantes.

## Estructura de carpetas

```
bio-core/                           ← Monorepo (npm workspaces)
├── packages/
│   ├── core/                       ← @bio/core — motor genérico
│   │   └── src/
│   │       ├── atoms/              → Funciones puras (schema, embeddings, interpolation, paths)
│   │       ├── cells/              → CellServer: servidor MCP dinámico que muta
│   │       ├── config/             → registry.json, templates.json, agents/*.md, ILogger
│   │       ├── infrastructure/     → CircuitBreaker, PerfMonitor, RateLimiter, Scheduler
│   │       ├── molecules/          → Lógica genérica (DB, HTTP, Scraper, Git, Email)
│   │       ├── organisms/          → Sub-agentes MCP que controlan células
│   │       ├── server/             → ProductionServer, RouteRegistry, SettingsManager
│   │       └── system/             → Orquestador + Cortex + strategies/
│   │           └── strategies/     → IReflexExecutor, IHistoryManager, IPerfTracker + Defaults
│   ├── restaurant/                 ← @bio/restaurant — vertical de dominio
│   │   └── src/
│   │       ├── molecules/          → Orders, Inventory, Delivery
│   │       └── config/             → registry.ts, profile.ts, agents/
│   └── dashboard/                  ← @bio/dashboard — Frontend React (Vite + Tailwind)
│       └── src/
│           ├── components/         → SettingsPanel, ChatPanel, SectionNav, etc.
│           ├── hooks/              → useSettings, useApi, etc.
│           └── types/              → dashboard.types, health.types, platform.types, domain.types
├── data/                           → Base de datos (runtime)
│   ├── biocore-shared.db           → Reflexes, embeddings, template state
│   └── tenants/                    → BD aislada por tenant
├── docs/                           → Documentación (Doc Engine JSON)
├── scripts/                        → Utilidades (dead-code-analysis, verify-invariants)

```

## Capas (de arriba a abajo)

1. **Cortex** — Selecciona modelo LLM, ejecuta chat loops (hereda de BaseOrchestrator)
2. **Orquestador** — Unifica herramientas, difunde mutaciones, delega a estrategias:
   - `IReflexExecutor` → memoria refleja (query, execute, save)
   - `IHistoryManager` → historial de conversación (compress, summarize)
   - `IPerfTracker` → métricas de rendimiento
3. **Organismo** — Controla célula MCP como proceso hijo
4. **Célula** — Servidor MCP dinámico, muta según estímulo
5. **Molécula** — Lógica de negocio reutilizable
6. **Átomo** — Funciones puras sin estado (incluye `paths.ts` para resolución de rutas)

## Comandos

- `npm run build` — Compila todos los paquetes (core → restaurant → dashboard)
- `npm run dev` — Desarrollo con watch (core + dashboard en paralelo)
- `npm start` — Ejecuta el sistema
- `npm run prod` — Servidor de producción (dashboard + API + streaming)
- `npm run mcp` — MCP Server local (stdio, para uso individual)
- `npm run mcp:http` — MCP Server HTTP (para equipos, acceso remoto)
- `npm run dashboard` — Inicia el frontend (Vite dev server)
- `npm run docs` — Inicia servidor de documentación (http://localhost:4000)

### Type checking por paquete

- Backend: `npx tsc --noEmit` (desde `packages/core/`)
- Frontend: `npx tsc --noEmit --project tsconfig.app.json` (desde `packages/dashboard/`)
- Tests: `npx vitest --run` (desde raíz o paquete específico)
- **Invariants gate:** `npx tsx scripts/verify-invariants.ts` (5 checks: build, tests, tsc core, tsc dashboard, MCP tools)

## Tipos de célula disponibles

| Tipo           | Capacidad                                       | Perfil     |
| -------------- | ----------------------------------------------- | ---------- |
| sensory        | Web scraping, APIs REST, feeds RSS              | dev        |
| memory         | SQLite: query, insert, find, update, delete     | todos      |
| filesystem     | Leer, escribir, copiar, mover archivos          | dev        |
| communication  | Email (Gmail), WhatsApp                         | todos      |
| versioncontrol | Git: commit, push, pull, branches               | dev        |
| http           | HTTP avanzado: GET, POST, PUT, DELETE           | dev        |
| system         | Ejecución de CLIs (ffmpeg, imagemagick, etc.)   | dev        |
| monitor        | Monitoreo combinado (scraping + HTTP + sistema) | dev        |
| orders         | Pedidos: crear, actualizar, listar, cancelar    | restaurant |
| inventory      | Inventario: stock, alertas, reorden             | restaurant |
| delivery       | Entregas: asignar, rastrear, estimar tiempo     | restaurant |

## Tecnologías

- TypeScript, Node.js
- MCP (Model Context Protocol) para comunicación entre capas
- Zod para validación
- SQLite (better-sqlite3) para persistencia
- Pino para logging
- OpenTelemetry para telemetría
- React + Vite para dashboard

## Proveedores LLM (con fallback automático)

| Proveedor | Modelo                              | Rol                       |
| --------- | ----------------------------------- | ------------------------- |
| Gemini    | gemini-2.0-flash                    | Primario (rápido, gratis) |
| Claude    | claude-3-5-sonnet-latest            | Fallback 1 (preciso)      |
| NVIDIA    | nvidia/llama-3.3-nemotron-super-49b | Fallback 2 (tool calling) |

El `UnifiedCortex` maneja la cadena de fallback con Circuit Breakers por proveedor. Soporta **hot-reload** via `reconfigure()` — el Admin Settings Panel permite cambiar provider primario y fallback chain sin reiniciar.

## MCP Server Externo (para IDEs)

BioCore se puede exponer como servidor MCP para que IDEs (VS Code, Kiro, Cursor, Claude Code) lo consuman como proveedor de herramientas:

- **Local (stdio):** `npm run mcp` — el IDE lanza el proceso directamente
- **Remoto (HTTP):** `npm run mcp:http` — servidor centralizado para equipos

Herramientas expuestas: `biocore_execute`, `biocore_scrape`, `biocore_db_query`, `biocore_http`, `biocore_git`, `biocore_email`, `biocore_cli`, `biocore_status`.

## Multi-Industria (Perfiles por Tenant)

BioCore soporta múltiples industrias con un solo deploy. Cada tenant tiene un perfil que determina:

- **Células permitidas** — qué tipos de mutación ve el LLM
- **Agente de dominio** — archivo `.md` con rol, vocabulario, flujos y reglas
- **Templates** — flujos predefinidos filtrados por perfil
- **BD aislada** — datos de negocio separados por tenant

| Perfil     | Células                                                | Agente                                                      |
| ---------- | ------------------------------------------------------ | ----------------------------------------------------------- |
| dev        | sensory, memory, filesystem, git, http, system         | `packages/core/src/config/agents/dev-agent.md`              |
| restaurant | orders, inventory, delivery, communication, memory     | `packages/restaurant/src/config/agents/restaurant-agent.md` |
| clinic     | appointments, patients, billing, communication, memory | (futuro: @bio/clinic)                                       |
| ecommerce  | catalog, orders, analytics, marketing, communication   | (futuro: @bio/ecommerce)                                    |

Configuración: `TENANT_PROFILE=restaurant` en `.env`.

## Base de Datos Híbrida (por Tenant)

```
data/
├── biocore-shared.db     → Reflexes, embeddings (compartido entre todos)
└── tenants/
    ├── buen-sabor.db     → Pedidos, inventario, entregas (aislado)
    └── clinica-x.db      → Citas, pacientes, facturación (aislado)
```

## Documentación (fuente de verdad portable)

La carpeta `docs/` usa un **Doc Engine basado en JSON + Web Components**:

- `docs/_engine/data/*.json` — Fuente de verdad (JSONs renderizables)
- `docs/_engine/` — Engine: CSS, Web Components, renderer
- `docs/viewer.html` — Shell HTML para visualizar (`npm run docs`)
- `docs/ai/` — Contexto para otros IDEs (Copilot, Cursor, etc.)
- `docs/architecture/` — ADRs, roadmap, assessment

Documentos disponibles en el engine:

- `architecture` — Capas, monorepo, archivos clave, patrones
- `admin-settings-panel` — Panel de configuración admin (hot-reload)
- `glossary`, `execution-flow`, `llm-decision-flow`, etc.

## Steering disponibles (usar con #)

Para contexto detallado, invoca manualmente:

- `biocore-architecture` — Capas, archivos clave, patrones
- `biocore-glossary` — Definiciones de cada componente
- `biocore-execution-flow` — Flujo paso a paso de un estímulo
- `biocore-llm-decision-flow` — Cómo el LLM decide qué tipo usar
- `biocore-what-llm-receives` — Qué schema se envía al LLM
- `biocore-tools-comparison` — Comparación SIN vs CON BioCore
- `biocore-stimulus-sources` — Fuentes posibles de estímulo
- `biocore-mutation-lifecycle` — Ciclo de vida de una mutación
- `biocore-decisions` — Decisiones arquitectónicas
- `lessons-learned` — Errores comunes y cómo evitarlos

## Skills disponibles

Procedimientos paso a paso para tareas comunes:

- `create-molecule` — Crear una nueva molécula completa
- `create-cell-type` — Agregar un tipo de célula al registry
- `create-cortex` — Integrar un nuevo proveedor de LLM

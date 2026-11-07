---
inclusion: always
---

# BioCore — Resumen del Proyecto (bio-template)

Este documento describe el **template** `bio-template`, que es la base de arranque para casos de uso concretos (por ejemplo, un software de contabilidad). Lo que no está en este checkout se marca como tal.

## Qué es

Motor de automatización con herramientas que se activan por célula. El LLM es opcional: el flujo de cadenas corre sin él. Las respuestas en lenguaje libre sí usan el LLM.

## Dos caminos para ejecutar

1. **Cadena sugerida por Jev (sin LLM).** `UnifiedCortex.runConversation` consulta a Jev sobre `tools.json` filtrado por las células permitidas del tenant. Si la cadena es `scrape_url→db_insert`, el gate ejecuta sin LLM, pide los datos que falten y responde por el historial. Detalle en `biocore-jev-pre-routing.md`.
2. **LLM con herramientas por célula.** Cuando no aplica el gate, el LLM recibe la pista de Jev y las herramientas de la célula activa. `stimulate_differentiation` muta la célula al tipo elegido.

## Estructura de carpetas (este checkout)

```
bio-template/
├── package.json                    ← workspaces: packages/core (el dashboard se construye aparte)
├── packages/
│   ├── core/                       ← motor + extensión de dominio del template
│   │   └── src/
│   │       ├── atoms/              → Funciones puras (schema, toolFormat, interpolation, paths, cellRouter, reflexSelector, chainExtraction, sequence)
│   │       ├── cells/              → CellServer: servidor MCP que muta por tipo de célula
│   │       ├── config/             → registry.json, domain-registry.json, tools.json, domain-profile.ts, toolCatalog.ts, applicationComposition.ts
│   │       ├── infrastructure/     → CircuitBreaker, PerfMonitor, RateLimiter, Scheduler, TenantDatabaseManager
│   │       ├── molecules/          → DatabaseMolecule, ExampleMolecule (dominio), ReflexMolecule (historial), HTTP, Scraper, Git, Gmail, etc.
│   │       ├── organisms/          → Controla cada célula como proceso hijo
│   │       ├── server/             → ProductionServer, HealthServer, TenantManager, rutas HTTP
│   │       └── system/             → UnifiedCortex, BaseOrchestrator, gate de cadenas
│   │           └── strategies/     → IReflexExecutor (queryReflex, trackInput, recordStep, saveReflex), IPendingChainStore, IHistoryManager, IPerfTracker
│   └── dashboard/                  ← Frontend React + Vite + Tailwind (se construye con npm --prefix)
├── data/                           ← Runtime (no versionar)
│   ├── biocore.db                  ← Base compartida: plataforma, reflexes (historial), estado de plantillas
│   ├── backups/                    ← Respaldos antes de migraciones
│   └── tenants/<tenant>.db         ← Datos del negocio, aislados por tenant
├── docs/                           ← Documentación en Markdown (START_HERE, DECISIONS-AND-CONFIG, JEV-README)
└── scripts/                        ← validate-template-contract.ts, utilidades de datos
```

En el template no hay `packages/restaurant`. El dominio vive en `packages/core/src/config` (registry, perfil, agente) y en `molecules/ExampleMolecule.ts`. En el monorepo de referencia (`bio-core`) sí existe un paquete de dominio separado.

## Capas (de arriba a abajo)

1. **Cortex (`UnifiedCortex`).** Elige el proveedor LLM con fallback y circuit breakers. Ejecuta el gate de cadenas antes del LLM.
2. **Orquestador (`BaseOrchestrator`).** Unifica herramientas, difunde mutaciones y delega en estrategias:
   - `IReflexExecutor` → consulta a Jev, registro de pasos y guardado de historial.
   - `IPendingChainStore` → ejecuciones pendientes de un dato del usuario (24 h, en memoria).
   - `IHistoryManager` → historial de conversación.
   - `IPerfTracker` → métricas.
3. **Organismo.** Controla una célula MCP como proceso hijo.
4. **Célula (`CellServer`).** Servidor MCP que muta de tipo. Solo expone las herramientas del tipo activo.
5. **Molécula.** Lógica de negocio reutilizable, con `initialize()` y `dispose()`.
6. **Átomo.** Funciones puras sin estado ni efectos.

## Tipos de célula (registry.json)

| Tipo              | Herramientas registradas en código                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| sensory           | `scrape_url`, `extract_links`, `scrape_metadata`                                                                                  |
| memory            | `db_query`, `db_insert`, `db_find`                                                                                                |
| filesystem        | `read_file`, `write_file`, `list_files`                                                                                           |
| communication     | `send_email`, `send_whatsapp`                                                                                                     |
| versioncontrol    | `git_status`, `git_commit`                                                                                                        |
| http              | `http_get`, `http_post`                                                                                                           |
| system            | `execute_cli`, `check_command`, `system_info`                                                                                     |
| realtime          | `ws_start_server`, `ws_stop_server`, `ws_send`, `ws_broadcast`, `ws_list_clients`, `ws_disconnect_client`                         |
| monitor           | Hereda de `sensory`; expone `http_get`, `execute_cli`, `check_command`, `system_info`                                             |
| example (dominio) | `create_record`, `get_record`, `list_records`, `update_record_status`, `delete_record` (definidas en `applicationComposition.ts`) |

Las herramientas se registran con `registerTool("nombre", ...)`. Ese nombre es la fuente de verdad: `tools.json` y `registry.json` deben coincidir con él. `scripts/validate-template-contract.ts` lo verifica.

## Catálogo de Jev

- `config/tools.json` contiene nombre → descripción, solo para herramientas que existen en código.
- `config/toolCatalog.ts` filtra ese archivo por las células permitidas del tenant, usando el registry.
- Las herramientas de dominio todavía no están en `tools.json`. Es una decisión pendiente.

## Perfiles y modos de despliegue

- **Perfil** (`TENANT_PROFILE`): define células permitidas (`allowedCells`), agente `.md` y herramientas. En `domain-profile.ts` el perfil `domain` permite `example`, `memory` y `sensory`.
- **Modo** (`DEPLOYMENT_MODE`): `studio` (varios clientes gestionados desde la plataforma) o `single` (un solo negocio, `TENANT_ID`).
- Un despliegue por estudio o negocio. Ver `DECISIONS-AND-CONFIG.md`, secciones 3.2 y 3.9.

## Bases de datos

- **Compartida** (`DATABASE_PATH`, por defecto `./data/biocore.db`): tablas `platform_*`, `reflexes` como historial y `template_state`.
- **Por tenant** (`DATABASE_DIR/tenants/<tenant>.db`): datos del negocio. Ahí caen `db_*` y `ExampleMolecule`.
- Las rutas relativas se resuelven desde la raíz del proyecto (`resolveDataPath`).
- `platform_tenants.profile` tiene un `CHECK` con lista fija de perfiles. Ver `DECISIONS-AND-CONFIG.md`.

## Proveedores LLM

| Proveedor | Rol        | Estado en este checkout                    |
| --------- | ---------- | ------------------------------------------ |
| Gemini    | Primario   | API key inválida al momento de la revisión |
| Claude    | Fallback 1 | Configurable                               |
| NVIDIA    | Fallback 2 | Configurable                               |

`UnifiedCortex` aplica circuit breakers por proveedor. `reconfigure()` permite cambios en caliente desde el panel de ajustes.

## Comandos (según `package.json`)

- `npm run build` — compila el backend y construye el dashboard.
- `npm run build:ts` — compila solo el backend (`tsc --build`) y copia los assets de config.
- `npm run dev` — dev server del dashboard (Vite, puerto 5173).
- `npm run dev:all` — compila el backend en watch y el dashboard en paralelo.
- `npm start` — ejecuta el backend desde `packages/core/dist/`. **Requiere `build:ts` tras cada cambio en `src`.**
- `npm run prod` — build completo y arranque del backend.
- `npm test` — tests de core con Vitest.
- `npm run validate-template` — valida el contrato del template.

Verificación por paquete:

- Backend: `npx tsc --noEmit` desde `packages/core/`.
- Dashboard: `npx tsc --noEmit --project tsconfig.app.json` desde `packages/dashboard/`. Tiene un error preexistente en `App.tsx` si `DashboardLayout` no se usa.

Scripts que aparecían en versiones anteriores y **no existen en este checkout**: `mcp`, `mcp:http`, `docs`, `verify-invariants`.

## Memoria refleja

`ReflexMolecule` guarda cadenas ejecutadas como historial. No decide nada: los umbrales adaptativos, el modo `reflex` y los embeddings se retiraron. La columna `embedding` queda vacía por compatibilidad.

## Documentación y steering

- `docs/` contiene Markdown plano. No hay Doc Engine JSON en este checkout.
- Steering vigente en `.kiro/steering/`: `biocore-jev-pre-routing`, `biocore-decisions`, `biocore-glossary`, `biocore-architecture`, `biocore-boundaries`, `biocore-testing-validation`, `lessons-learned`, entre otros.
- Decisiones de arquitectura y configuración: `docs/DECISIONS-AND-CONFIG.md`.

## Pendientes conocidos

- Herramientas de dominio fuera del catálogo de Jev.
- Ruta de streaming (`/api/chat/stream`) sin gate de cadenas.
- API key de Gemini inválida.
- Polling duplicado en el dashboard (`useApi` con intervalos fijos por componente).
- Lista fija de perfiles en `platform_tenants`.
- Limpieza de código sin uso (ver `packages/core/knip.json`).

# Arquitectura de bio-template y plan de mejoras

Estado: **borrador**. Revisar y ajustar antes de tomar decisiones de implementación.
Última revisión: 7 de noviembre de 2026.

## 1. Concepto

bio-template es un runtime multi-tenant para agentes con herramientas.

- Un LLM o el modelo de ruteo Jev elige un **tipo de célula**. La célula cambia de forma y expone solo las herramientas de ese tipo.
- Alrededor de ese núcleo hay tenancy, roles, autenticación, scheduler, logs, métricas y un dashboard de operación.
- Un proyecto concreto (por ejemplo, la contabilidad de un contador con varios clientes) toma el template como base y agrega:
  - un **perfil** que decide qué células están permitidas,
  - entradas de **registry** de dominio,
  - **moléculas** propias con la lógica de negocio,
  - un **agente** `.md` con el prompt de dominio,
  - **secciones de UI** específicas.

El template crece por industria. Cada proyecto aporta su dominio sin modificar el motor.

## 2. Capas

| Capa       | Ubicación                      | Responsabilidad                                                                 |
| ---------- | ------------------------------ | ------------------------------------------------------------------------------- |
| Átomos     | `packages/core/src/atoms/`     | Funciones puras (esquemas, formato de herramientas, ruteo, rutas).              |
| Moléculas  | `packages/core/src/molecules/` | Capacidades con recursos: base de datos, HTTP, scraping, Git, email, WebSocket. |
| Células    | `packages/core/src/cells/`     | Servidor MCP que cambia de tipo y registra herramientas.                        |
| Organismos | `packages/core/src/organisms/` | Controlan una célula como proceso hijo.                                         |
| Sistema    | `packages/core/src/system/`    | Cortex, orquestador, estrategias de historial y de pendientes.                  |
| Servidor   | `packages/core/src/server/`    | HTTP, rutas, tenants, plataforma, scheduler.                                    |
| Dashboard  | `packages/dashboard/src/`      | Consola de operación (React, Vite, Tailwind). Se comunica con el core por HTTP. |

El validador `scripts/validate-template-contract.ts` comprueba el contrato del template (49 rutas).

## 3. Modos de despliegue y separación de dominio

- **`DEPLOYMENT_MODE`** (`studio` o `single`): en `studio` se gestionan varios clientes desde la plataforma. En `single` hay un solo negocio y se oculta la gestión de clientes. El dashboard lo lee con `VITE_DEPLOYMENT_MODE`.
- **Separación de dominio:** el dominio vive en `domain-registry.json`, `domain-profile.ts`, `applicationComposition.ts` y en las moléculas de dominio. El motor no debe importar nada específico de un caso de uso.

## 4. Estado medido (grafo de código, 7 de noviembre de 2026)

Fuente: `graphify-out/GRAPH_REPORT.md`. Se regenera con graphify y no se versiona.

- 268 archivos de código fuente, 2 027 nodos, 4 853 aristas, 95 comunidades.
- Acoplamiento entre paquetes: el dashboard tiene **1** arista hacia el core. El core tiene 2 350 aristas internas.
- Objetos más conectados (sin barriles ni utilidades transversales): `UnifiedCortex` (65), `RouteRegistry` (64), `ProductionServer` (57), `CellServer` (49), `DashboardLayout` (47), `TenantManager` (40).
- Hubs de infraestructura, usados desde más de 20 archivos: `createLogger`, `errors.ts`, `useApi`.

Limitaciones del diagnóstico:

- Graphify resuelve nombres por etiqueta. Un nombre de librería externa puede quedar enlazado a un nodo local. El post-proceso de `.kiro/skills/graphify/scripts/postprocess_report.py` descarta esas conexiones en el reporte, pero no en `graph.json`.
- Solo se extrajo código. Documentos e imágenes no entraron.

## 5. Diagnóstico

### Lo que funciona

- Las capas son reconocibles y el validador las respalda.
- El dashboard está desacoplado del core y se comunica por HTTP.
- Existen puntos de extensión de dominio reales.
- Los modos `studio` y `single` están implementados en backend y dashboard.

### Problemas, por prioridad

**P1. Lógica de un caso de uso dentro del motor. (Resuelto)**
Las cadenas se declaran en el perfil (`config/domain-profile.ts`, campo `chains`). El motor las ejecuta con `runChain` sin conocer sus nombres de herramienta. El gate ya no contiene `scrape_url→db_insert`. Pendiente: el perfil `domain` todavía declara la cadena de ejemplo, y los extractores `url` y `text` son parte del motor.

**P2. Objetos centrales demasiado grandes.**
`RouteRegistry`, `UnifiedCortex`, `ProductionServer` y `CellServer` concentran demasiadas responsabilidades. `ProductionServer` arma casi todo el sistema.
_Propuesta:_ una sola composición raíz, con módulos más pequeños por responsabilidad.

**P3. Varias rutas de ruteo y de historial. (Parcialmente resuelto)**
La ruta canónica es `UnifiedCortex.runConversation`: gate de cadenas, pista de Jev, pre-routing de célula y LLM con herramientas. `HeadlessOrchestrator` se retiró junto con sus heurísticas. Pendiente: el historial sigue con tres implementaciones (`HistoryMolecule`, `DefaultHistoryManager` y `LegacyHistoryManagerAdapter`).

**P4. Seguridad. (Resuelto en local. Falta la topología de producción)**
Verificado en vivo con un backend de prueba: el login emite una cookie `httpOnly` y `SameSite=Strict`, la sesión se restaura con `/api/tenant/auth/me`, el logout borra la cookie, y una cookie falsificada se rechaza. El dashboard ya no guarda el token en `sessionStorage`. Queda pendiente decidir si el dashboard y la API comparten origen en producción, porque la cookie depende de eso.

Hallazgos previos a la corrección, conservados como referencia:

- El token del tenant se guarda en `sessionStorage`. `authHeaders()` solo lee la API key de `localStorage`. No está confirmado que las peticiones del tenant lleven el token.
- El SSE de logs envía la API key como query param (`?apiKey=`). Puede quedar registrada en logs de proxy o en el historial.
  _Propuesta:_ verificar el flujo de autenticación del tenant de extremo a extremo y mover la key fuera de la URL.

**P5. Migraciones al arrancar sin respaldo.**
`ReflexMolecule.runMigration()` ejecuta `DROP TABLE` en cada arranque. No hace copia de seguridad.
_Propuesta:_ migraciones explícitas, idempotentes y con respaldo previo.

**P6. Restos del proyecto original en el repositorio del template.**
Scripts ad hoc en la raíz (`analyze-reflexes.mjs`, `audit-reflexes.js`, `cleanup-db.ts`, `copy-db-to-project.js`) y `.agents/` con artefactos de tareas.
_Propuesta:_ mover a `scripts/` lo que se conserve y borrar el resto.

**P7. Sin pruebas automatizadas del dashboard.**
El core tiene 45 pruebas. El dashboard solo se verifica con `tsc`.
_Propuesta:_ pruebas de componentes y del hook `useApi` (caché, deduplicación, pausa al ocultar la pestaña).

**P8. Documentación que se desincroniza.**
Varios documentos de steering describieron versiones anteriores del código.
_Propuesta:_ una fuente por tema, con fecha de revisión en cada documento.

## 6. Plan por fases

**Fase 1: higiene y seguridad (corto plazo)**

- Verificar P4 (token de tenant y query param de la API key).
- Corregir P6: mover o borrar scripts de la raíz.
- Documentar la decisión sobre P5 y reemplazar el `DROP TABLE` en cada arranque.

**Fase 2: desacoplar el dominio (antes del proyecto de contabilidad)**

- P1: hecho (cadenas en el perfil).
- P3: ruta canónica definida. Falta unificar el historial.

**Fase 3: estructura del core**

- P2: composición raíz y división de `RouteRegistry`, `ProductionServer` y `UnifiedCortex`.

**Fase 4: calidad**

- P7: pruebas del dashboard.
- P8: revisión de documentación.

## 7. Preguntas abiertas

1. Resuelta: las cadenas de dominio se declaran en `domain-profile.ts`.
2. Resuelta: la ruta canónica es `UnifiedCortex.runConversation`. El pre-router de células es un paso de esa ruta.
3. Resuelta: `HeadlessOrchestrator` se retiró.
4. ¿La sección técnica del dashboard (reflexes, circuit breaker, registry) queda visible para operadores o solo para plataforma?
5. ¿Cuándo se valida el token de tenant de extremo a extremo?

## 8. Fuentes y verificación

- `graphify-out/GRAPH_REPORT.md` y `graphify-out/graph.json`: métricas de la sección 4.
- `docs/DECISIONS-AND-CONFIG.md`: decisiones y configuración vigentes.
- `scripts/validate-template-contract.ts`: contrato del template.

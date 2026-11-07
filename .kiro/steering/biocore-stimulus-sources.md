---
inclusion: manual
---

# Fuentes de estímulo

## Respuesta corta

Un estímulo es una orden de mutación que llega a `routeStimulus`. El método acepta un string o un `IStimulus` (`type`, `source`, `metadata`, `timestamp`), y la mutación no depende de quién lo envió. En el código actual, casi todas las entradas externas llegan como texto al cortex, y el cortex decide qué hacer con ese texto.

## Quién llama a `routeStimulus` hoy

| `source`         | Dónde                                                                     | Estímulo                                  | Notas                                         |
| ---------------- | ------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------- |
| `llm`            | `BaseOrchestrator.executeAction`, al ejecutar `stimulate_differentiation` | Tipo que elige el LLM                     | Bloqueado si el tipo ya se mutó en el mensaje |
| `jev-chain`      | `UnifiedCortex.runScrapeAndStore`, dos veces (`sensory`, `memory`)        | Tipos de la cadena `scrape_url→db_insert` | Sin LLM                                       |
| `jev-pre-router` | `UnifiedCortex.preRoute`                                                  | Tipo que elige el pre-router              | Antes del LLM                                 |

Ningún otro archivo de `packages/core/src` llama a `routeStimulus`. `HeadlessOrchestrator` tampoco lo llama.

## Entradas externas: pasan por el cortex

Estas entradas no mutan la célula directamente. Llaman a `tenantManager.chat(tenantId, texto)` o a `chatStream`, así que el texto sigue el mismo camino que un mensaje del usuario: gate de cadenas, pre-router y, si no resuelven, el LLM.

| Entrada                | Archivo                                                  | Qué envía                                     |
| ---------------------- | -------------------------------------------------------- | --------------------------------------------- |
| API de chat            | `server/routes/DashboardRoutes.ts`                       | Texto del usuario                             |
| Ruta de mutación       | `server/routes/MutationRoutes.ts`                        | Texto "Diferénciate a tipo X"                 |
| Tareas programadas     | `server/routes/SchedulerRoutes.ts`                       | Mensaje de la tarea                           |
| Monitor                | `server/routes/MonitorRoutes.ts`                         | Mensaje de alerta                             |
| WebSocket              | `server/routes/WebSocketRoutes.ts`                       | Instrucción en texto                          |
| MCP HTTP y MCP externo | `server/MCPHttpServer.ts`, `server/MCPExternalServer.ts` | Texto armado por las herramientas `biocore_*` |
| REPL y CLI             | `server/ReplServer.ts`, `system/cli/runCortexCli.ts`     | Texto de la consola                           |

La ruta de mutación no garantiza una mutación. Solo pide una al cortex, y el pre-router o el LLM deciden.

Como estas entradas no pasan por `routeStimulus`, el `source` no queda registrado en el log.

## Lo que no existe en el código

Los ejemplos del JSDoc de `system/interfaces/IStimulus.ts` describen fuentes que no tienen integración en el repositorio: webhook de GitHub, trigger de base de datos, `fs.watch`, monitor de CPU y otro organismo. Son usos posibles de la interfaz. Para agregar una fuente hay dos caminos:

- Un handler que llame a `routeStimulus` con su `source`. Esa mutación no pasa por el LLM.
- Un texto enviado con `tenantManager.chat`. Ese mensaje sí pasa por el cortex y puede llegar al LLM.

Cada camino tiene consecuencias distintas. Elegir uno es una decisión de diseño pendiente para cada caso.

## Diferencia entre las dos rutas

- **Por `routeStimulus`**: mutación directa. No hay LLM ni gate. El tipo debe existir en el registro fusionado.
- **Por texto**: el cortex decide. Puede resolver con el gate, con el pre-router o con el LLM.

## Trazabilidad

`routeStimulus` escribe `source` y `metadata` en el log. No se guardan en base de datos.

## Relaciones

- Ciclo de vida de la mutación: [[biocore-mutation-lifecycle]]
- Cómo decide el LLM: [[biocore-llm-decision-flow]]
- Ejecución completa: [[biocore-execution-flow]]
- Glosario (Estímulo, Orquestador): [[biocore-glossary]]

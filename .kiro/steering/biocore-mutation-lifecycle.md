---
inclusion: manual
---

# Ciclo de vida de una mutación

## Disparo

`BaseOrchestrator.routeStimulus(estímulo)` valida el tipo con `StimulusTypeSchema`, que usa el registro fusionado (core y dominio). Después mide la operación con `perfTracker` y llama a `stimulate(tipo)` en cada organismo. El organismo llama a la herramienta MCP `stimulate_differentiation` de su célula. Quién llama a `routeStimulus` está en [[biocore-stimulus-sources]].

## Pasos dentro de la célula

El handler de `stimulate_differentiation` en `cells/CellServer.ts` ejecuta:

1. **`disposeMolecules()`**
   - `disposeTools()` retira cada herramienta MCP activa con `remove()` y envía `tools/list_changed` si hay conexión.
   - Libera los recursos de la mutación anterior. La base del tenant se cierra con `close()`. Las demás moléculas reciben `dispose()` si lo implementan.
   - Si una liberación falla, el recurso queda en `pendingCleanup`. La siguiente llamada lo reintenta, así que nunca se declara cerrado un recurso abierto.
2. **`activateTypes(tipo)`**
   - `getTypeChain(tipo)` sigue el campo `parent` del registro y devuelve la cadena desde el ancestro hasta el tipo pedido. Un ciclo de herencia lanza `MutationError`.
   - Para cada tipo de la cadena con registro integrado o de dominio, llama a `factory(context)`, que crea moléculas y recursos.
   - Si dos recursos usan la misma clave, lanza `MutationError`.
   - Cada recurso se guarda en `resources` y recibe `initialize()` si lo implementa.
   - `registerTools()` registra las herramientas MCP. Si una herramienta ya estaba registrada en la misma mutación, lanza `MutationError`.
   - Al final envía `tools/list_changed`.
3. **`currentType = tipo`**.

Si `activateTypes` falla, los recursos creados en esa activación se liberan (rollback). `currentType` queda en `undifferentiated` y el error llega al LLM como resultado de la herramienta.

## Tipos con registro integrado

| Tipo             | Recursos (clave)                                                                                       | Registro de herramientas                       |
| ---------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `memory`         | `DatabaseMolecule` sobre la base del tenant (`database`)                                               | `registerDatabaseTools`                        |
| `http`           | `HTTPMolecule` (`http`)                                                                                | `registerHTTPTools`                            |
| `filesystem`     | `FileSystemMolecule` (`filesystem`)                                                                    | `registerFileSystemTools`                      |
| `communication`  | `GmailMolecule` (`gmail`). `WhatsAppMolecule` (`whatsapp`) es opcional: si su creación falla, se omite | `registerGmailTools` y `registerWhatsAppTools` |
| `versioncontrol` | `GitMolecule` (`git`)                                                                                  | `registerGitTools`                             |
| `sensory`        | `ScraperMolecule` (`scraper`) y `HTTPMolecule` (`http`)                                                | `registerScraperTools`                         |
| `system`         | `SystemMolecule` (`system`)                                                                            | `registerSystemTools`                          |
| `realtime`       | `WebSocketMolecule` (`websocket`) y `HTTPMolecule` (`http`)                                            | `registerWebSocketTools`                       |

`sensory_advanced` y `monitor` están en `registry.json` con `parent: "sensory"`, pero no tienen registro integrado. `activateTypes` omite los tipos de la cadena que no tienen registro. Como el enum solo muestra tipos con registro, el LLM no puede pedirlos.

`undifferentiated` no tiene recursos ni herramientas. Es el estado inicial y el estado de respaldo tras un fallo.

## Estado entre mutaciones

- Hay un solo tipo activo a la vez. Cada mutación empieza desde cero.
- Las herramientas del tipo anterior dejan de estar disponibles en cuanto empieza la mutación.
- Dentro de un mismo mensaje, el orquestador no repite la misma mutación (`_mutatedTypes`). Sí puede mutar a otro tipo.

## Dónde verlo

- `BaseOrchestrator.routeStimulus` escribe en el log "Difundiendo señal de diferenciación" y "Sistema reconfigurado", con el `source`.
- `CellServer` escribe "Mutación exitosa" cuando termina sin error.

## Relaciones

- Qué decide el LLM para mutar: [[biocore-llm-decision-flow]]
- Fuentes de estímulo: [[biocore-stimulus-sources]]
- Ejecución completa: [[biocore-execution-flow]]
- Comparación de herramientas cargadas: [[biocore-tools-comparison]]
- Glosario: [[biocore-glossary]]

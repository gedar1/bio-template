---
inclusion: manual
name: "BioCore + Jev: Cadenas desde tools.json"
description: "Cómo Jev elige la cadena de herramientas, cuándo se ejecuta sin LLM y cómo se piden los datos que faltan (flujo scrape_url → db_insert)"
---

# Jev: selección de cadenas y ejecución sin LLM

Este documento describe el flujo vigente en `UnifiedCortex`. Reemplaza la versión anterior, que describía `executeDetectedChain` como pendiente y la ruta de `TenantManager`. Esa ruta sigue existiendo para `POST /api/platform/semantic_route`, pero no interviene en el chat.

## Idea central

Jev no elige entre reflexes guardados. Elige entre las herramientas de `config/tools.json` que pertenecen a las células permitidas del tenant. Los reflexes se guardan como historial, pero no son criterios de selección.

## Flujo en el chat

```
POST /api/chat → TenantManager.chat → UnifiedCortex.chat → runConversation
  │
  ├─ queryReflex(input)                          DefaultReflexExecutor
  │    catálogo = buildJevToolCatalog(allowedCells)   config/toolCatalog.ts
  │    selection = jevEvaluateAll(input, catálogo)    atoms/reflexSelector.ts
  │      1) choice: primer paso + noul: multi-paso      (llamada 1, catálogo completo)
  │      2) choice: siguiente paso                     (llamada 2, con el primero como
  │                                                     dato y sin él entre las opciones;
  │                                                     "ninguno" = termina ahí)
  │    match.mode = "hint" siempre (Jev no guarda pasos reutilizables)
  │
  ├─ ¿match.record.sequence == "scrape_url→db_insert" y similitud ≥ 0.7?
  │    │
  │    ├─ Hay pendiente de la sesión (DefaultPendingChainStore, 24 h)?
  │    │    ├─ El mensaje trae URL  → ejecutar
  │    │    └─ No trae URL         → descartar pendiente, responder con aviso
  │    │
  │    ├─ El mensaje trae URL (extractUrl)  → ejecutar
  │    └─ No trae URL → guardar pendiente y preguntar "¿Cuál es la URL a scrapear?"
  │
  └─ Si no aplica el gate: pista "[Jev] Secuencia sugerida" → preRoute → LLM
```

### Ejecución (`runScrapeAndStore`)

1. `routeStimulus({ type: "sensory" })`, luego `executeAction("scrape_url", { url })`.
2. `routeStimulus({ type: "memory" })`.
3. `organisms[0].callTool("db_query", { sql: CREATE TABLE IF NOT EXISTS jev_chain_results ... })`. Va directo al organismo para que el DDL no quede como paso del reflex.
4. `executeAction("db_insert", { table: "jev_chain_results", data: { url, payload, created_at } })`.

La célula tiene un solo tipo activo a la vez, así que la cadena muta entre `sensory` y `memory`. `sensory` debe estar en `allowedCells` del perfil. Sin ese permiso, la mutación se rechaza.

El gate no usa `ExecutionChainRunner`. Llama directamente a `routeStimulus` y `executeAction`.

## Dónde vive cada pieza

| Pieza                      | Archivo                                                                  | Responsabilidad                                                                                |
| -------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Catálogo para Jev          | `config/toolCatalog.ts`                                                  | Filtra `tools.json` por las células permitidas usando `registry.json` y `domain-registry.json` |
| Descripciones              | `config/tools.json`                                                      | Nombre → descripción. Solo herramientas registradas en código                                  |
| Llamadas a Jev             | `atoms/reflexSelector.ts`                                                | `jevEvaluateAll`: dos llamadas secuenciales                                                    |
| Consulta                   | `system/strategies/DefaultReflexExecutor.ts`                             | `queryReflex(input, allowedCells)`                                                             |
| Extracción de URL y cadena | `atoms/chainExtraction.ts`                                               | `extractUrl` (sin fallback), `isScrapeStoreSequence`, tabla fija, pregunta y aviso             |
| Pendientes                 | `system/strategies/IPendingChainStore.ts`, `DefaultPendingChainStore.ts` | Estado por sesión con expiración de 24 h, en memoria                                           |
| Gate y ejecución           | `system/implementations/UnifiedCortex.ts`                                | `handleScrapeAndStore`, `runScrapeAndStore`, respuesta por historial                           |
| Pre-routing de célula      | `atoms/cellRouter.ts`                                                    | Elige la célula. Si `multiCell > 0.65` devuelve `null` y deja la secuencia al LLM              |

## Umbrales vigentes

| Constante                    | Valor | Dónde                                                         |
| ---------------------------- | ----- | ------------------------------------------------------------- |
| `REFLEX_SELECTION_THRESHOLD` | 0.7   | Confianza mínima del primer paso para formar cadena           |
| `CHAIN_MIN_SIMILARITY`       | 0.7   | Confianza mínima para que el gate ejecute sin LLM             |
| `MIN_CONFIDENCE`             | 0.7   | `cellRouter`, pre-routing de célula                           |
| `multiCell`                  | 0.65  | `cellRouter`, a partir de este valor la secuencia pasa al LLM |
| TTL de pendiente             | 24 h  | `DefaultPendingChainStore`                                    |

El gate evalúa la confianza del primer paso. La del segundo paso se registra en el log, pero no decide la ejecución.

## Reglas que no hay que romper

- **Jev nunca ejecuta en modo `reflex`.** Su sugerencia no trae pasos. Solo sirve como pista o para el gate.
- **Nombres del catálogo = nombres de la célula.** Jev recibe `db_insert`, no `database_insert`. Un nombre que no esté registrado en código no debe llegar al catálogo. El validador de contrato (`scripts/validate-template-contract.ts`) lo verifica.
- **El DDL de infraestructura no se registra como paso.** Va por `organisms[0].callTool`, no por `executeAction`.
- **Pendiente con mensaje sin URL = aviso y descarte.** No se procesa el mensaje nuevo en la misma respuesta. El usuario lo reenvía.

## Estado de la verificación

Verificado de punta a punta en el chat: pregunta la URL, ejecuta `scrape_url`, guarda en `jev_chain_results`, reflex guardado como `scrape_url->db_insert`.

No verificado:

- Ruta de streaming (`/api/chat/stream`). `runConversation` recibe `reflexPrepared = true` y el gate no corre.
- Latencia de la segunda llamada a Jev. Se observó menos de un segundo entre llamadas.
- Herramientas de dominio (`create_record`, etc.). No están en `tools.json`, así que Jev no las propone.

## Relaciones

- Ejecución completa del estímulo: [[biocore-execution-flow]]
- Qué recibe el LLM cuando hay pista: [[biocore-what-llm-receives]]
- Decisiones: [[biocore-decisions]]
- Glosario: [[biocore-glossary#Jev (TypeSafe System One)]]

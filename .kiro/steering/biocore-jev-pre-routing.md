---
inclusion: manual
name: "BioCore + Jev: cadenas declaradas en el perfil"
description: "Cómo Jev sugiere una cadena, cómo el gate la ejecuta sin LLM, cómo se piden los datos que faltan y dónde se declaran las cadenas (domain-profile.ts)"
---

# Jev: selección de cadenas y ejecución sin LLM

Este documento describe el flujo vigente en `UnifiedCortex`. Las cadenas no están fijas en el motor: se declaran en el perfil del tenant. El endpoint `POST /api/platform/semantic_route` y su pipeline de ranking se retiraron. El gate de `UnifiedCortex` es la única ruta de cadenas.

## Idea central

Jev no elige entre reflexes guardados. Elige entre las herramientas de `config/tools.json` que pertenecen a las células permitidas del tenant. Los reflexes se guardan como historial, pero no son criterios de selección.

Una cadena es una secuencia de pasos declarada en datos. El motor sabe ejecutarla. El perfil dice qué pasos existen para ese caso de uso.

## Dónde se declaran las cadenas

`packages/core/src/config/domain-profile.ts`, campo `chains` del perfil. Cada cadena tiene:

| Campo         | Qué define                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------- |
| `id`          | Identificador único dentro del perfil. Se guarda como `chainId` en los pendientes.                |
| `description` | Texto para humanos.                                                                               |
| `requires`    | Máximo un dato que pedir al usuario: `{ name, extractor: "url" \| "text", ask }`.                 |
| `steps`       | Pasos en orden: `{ cell, tool, args }`. Cada `cell` debe estar en `allowedCells` del perfil.      |
| `setup`       | Sentencias SQL que se ejecutan antes de los pasos, en la célula `memory`. Deben ser idempotentes. |
| `done`        | Texto de respuesta cuando la cadena termina bien.                                                 |

Validación: `config/chainSchema.ts` (zod) y `config/profileRegistry.ts`. Un perfil con ids de cadena repetidos, o con un paso en una célula no permitida, no arranca.

Argumentos de cada paso:

- `$requires.<nombre>`: dato extraído del mensaje.
- `$previous`: salida del paso anterior.
- `$now`: fecha y hora actual.
- Cualquier otro valor se usa como literal.

Los extractores (`url`, `text`) están en el motor (`atoms/chainSpec.ts`). El perfil referencia su nombre, no su código.

Ejemplo vigente en el perfil `domain`: la cadena `scrape-store`, con secuencia `scrape_url→db_insert`, guarda el contenido de una URL en `jev_chain_results`.

## Flujo en el chat

```
POST /api/chat → TenantManager.chat → UnifiedCortex.chat → runConversation
  │
  ├─ ¿Hay pendiente en la sesión?
  │    ├─ Extractor encuentra el dato   → ejecutar la cadena pendiente
  │    └─ No lo encuentra              → descartar pendiente, responder aviso (no se procesa el mensaje)
  │
  ├─ queryReflex(input)                          DefaultReflexExecutor
  │    catálogo = buildJevToolCatalog(allowedCells)   config/toolCatalog.ts
  │    selection = jevEvaluateAll(input, catálogo)    atoms/reflexSelector.ts
  │      1) choice: primer paso + noul: multi-paso      (llamada 1, catálogo completo)
  │      2) choice: siguiente paso                     (llamada 2, con el primero como
  │                                                     dato; "ninguno" = termina ahí)
  │
  ├─ ¿similitud ≥ 0.7 y existe cadena del perfil con esa secuencia y células permitidas?
  │    ├─ Cadena sin requisitos         → ejecutar
  │    ├─ Extractor encuentra el dato   → ejecutar
  │    └─ No lo encuentra              → guardar pendiente y preguntar `ask`
  │
  └─ Si no aplica el gate: pista "[Jev] Secuencia sugerida" → preRoute → LLM
```

`chatStream` pasa por la misma función, así que el gate aplica igual en streaming.

## Ejecución (`runChain`)

1. Si hay `setup`, muta a `memory` y ejecuta cada sentencia con `db_query` directo sobre el organismo. No queda como paso del reflex.
2. Por cada paso, muta a la célula del paso con `routeStimulus({source: "jev-chain"})` y llama a la herramienta con `executeAction`.
3. Si un paso falla, la respuesta indica el error. Si todo sale bien, responde con `done`.

La célula tiene un solo tipo activo a la vez, así que la cadena muta entre células en orden. Una célula fuera de `allowedCells` se rechaza al validar el perfil.

## Dónde vive cada pieza

| Pieza                    | Archivo                                                                  | Responsabilidad                                                                   |
| ------------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Declaración              | `config/domain-profile.ts`                                               | Campo `chains` del perfil                                                         |
| Esquema y validación     | `config/chainSchema.ts`, `config/profileRegistry.ts`                     | Forma de cada cadena; células y ids                                               |
| Argumentos y extractores | `atoms/chainSpec.ts`                                                     | `EXTRACTORS`, `chainSequence`, `sequenceKey`, `resolveArgs`                       |
| Runner                   | `system/chainRunner.ts`                                                  | `runChain(chain, values, port)`; setup y pasos a través de un puerto              |
| Gate y pendiente         | `system/implementations/UnifiedCortex.ts`                                | `findChain`, `handleChain`, `runChainSteps`                                       |
| Pendientes               | `system/strategies/IPendingChainStore.ts`, `DefaultPendingChainStore.ts` | Estado por sesión con expiración de 24 h, en memoria                              |
| Catálogo para Jev        | `config/toolCatalog.ts`                                                  | Filtra `tools.json` por las células permitidas                                    |
| Descripciones            | `config/tools.json`                                                      | Nombre → descripción. Solo herramientas registradas en código                     |
| Llamadas a Jev           | `atoms/reflexSelector.ts`                                                | `jevEvaluateAll`: dos llamadas secuenciales                                       |
| Pre-routing de célula    | `atoms/cellRouter.ts`                                                    | Elige la célula. Si `multiCell > 0.65` devuelve `null` y deja la secuencia al LLM |

## Umbrales vigentes

| Constante                    | Valor | Dónde                                                                          |
| ---------------------------- | ----- | ------------------------------------------------------------------------------ |
| `REFLEX_SELECTION_THRESHOLD` | 0.7   | `atoms/reflexSelector.ts`. Confianza mínima del primer paso para formar cadena |
| `CHAIN_MIN_SIMILARITY`       | 0.7   | `atoms/chainExtraction.ts`. Confianza mínima para que el gate ejecute sin LLM  |
| `MIN_CONFIDENCE`             | 0.7   | `atoms/cellRouter.ts`, pre-routing de célula                                   |
| `multiCell`                  | 0.65  | `atoms/cellRouter.ts`. A partir de este valor la secuencia pasa al LLM         |
| TTL de pendiente             | 24 h  | `DefaultPendingChainStore`                                                     |

El gate evalúa la confianza del primer paso de Jev.

## Reglas que no hay que romper

- **Jev no ejecuta nada.** Su sugerencia solo sirve para el gate, como pista o para el pre-routing. El código decide cuándo ejecutar.
- **Nombres del catálogo = nombres de la célula.** Jev recibe `db_insert`, no `database_insert`. Un nombre que no esté registrado en código no debe llegar al catálogo. El validador de contrato (`scripts/validate-template-contract.ts`) lo verifica.
- **El DDL de infraestructura no se registra como paso.** Va por `organisms[0].callTool`, no por `executeAction`.
- **Pendiente con mensaje sin dato = aviso y descarte.** El mensaje nuevo no se procesa en esa respuesta. El usuario lo reenvía.
- **Las cadenas nuevas van en el perfil, no en el motor.** El motor no contiene nombres de herramientas de dominio.

## Estado de la verificación

- Smoke test del runner con puerto simulado: el orden de mutaciones, el setup previo al scrape, la extracción de la URL y el rechazo de un perfil con una célula no permitida se comprobaron. Ese test fue temporal y se borró.
- Verificación de punta a punta en el chat tras el refactor: pendiente. Requiere reiniciar el backend desde `dist` (`npm run build:ts` y `npm start`).
- Historial previo: antes del refactor, el flujo se verificó en el chat con el camino fijo `scrape_url→db_insert`.
- No verificado: herramientas de dominio (`create_record`, etc.). No están en `tools.json`, así que Jev no las propone.

## Relaciones

- Ejecución completa del estímulo: [[biocore-execution-flow]]
- Qué recibe el LLM cuando hay pista: [[biocore-what-llm-receives]]
- Decisiones: [[biocore-decisions]]
- Glosario: [[biocore-glossary]]

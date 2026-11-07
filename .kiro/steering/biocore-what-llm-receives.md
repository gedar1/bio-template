---
inclusion: manual
---

# Qué recibe el LLM en cada petición

## Respuesta corta

Cada llamada a un proveedor lleva dos partes: el historial estructurado de la sesión y la lista de herramientas. `registry.json` nunca se envía. La lista de herramientas sale de `listTools` de la célula: nombres, descripciones y esquemas que la célula registró para su tipo activo.

## Construcción de la petición

`UnifiedCortex.buildRequest()` arma el objeto que recibe cada proveedor:

- `messages`: `getStructuredHistory()` de la sesión.
- `tools`: `normalizeTools(toolSnapshot)`. `toolSnapshot` se actualiza con `refreshTools()`.

Cada proveedor convierte la lista a su formato:

| Proveedor                    | Función de formato        | Modelo por defecto                       |
| ---------------------------- | ------------------------- | ---------------------------------------- |
| Claude (`AnthropicProvider`) | `formatToolsForAnthropic` | `claude-3-5-sonnet-latest`               |
| Gemini (`GeminiProvider`)    | `formatToolsForGemini`    | `gemini-2.5-flash`                       |
| NVIDIA (`NvidiaProvider`)    | `formatToolsForOpenAI`    | `nvidia/llama-3.3-nemotron-super-49b-v1` |

Los modelos por defecto están en `system/providers/providerFactory.ts`. La configuración puede reemplazarlos. El orden de los proveedores sale de `providerConfig.primaryProvider` y `fallbackOrder`.

## Contenido del historial

- **Agente de dominio.** Al crear el cortex de un tenant, `TenantManager` lee el archivo `agentFile` del perfil (por defecto `config/domain-agent.md`) y lo agrega como mensaje de sistema.
- **Pistas de Jev.** Mensajes `[Jev] Secuencia sugerida: ...` cuando Jev devuelve un `hint`.
- **Mensajes del usuario y del asistente**, y resultados de herramientas (`role: tool`).

## Contenido de las herramientas

Cada herramienta llega con `name`, `description` e `inputSchema`.

- `stimulate_differentiation`: la descripción lista los tipos disponibles, y el enum solo contiene esos tipos. Ver [[biocore-llm-decision-flow]].
- Herramientas del tipo activo: nombre, descripción y esquema que la función `register*Tools` del `CellServer` asignó a cada una.

## Limpieza antes de enviar

- `deduplicateTools` (`atoms/schema.ts`) devuelve solo `name`, `description` e `inputSchema`, y elimina duplicados por nombre.
- `cleanSchemaForLLM` usa `cloneJsonSchema`, que omite `$schema`. Sin esa limpieza, algunos proveedores rechazan la herramienta.
- `formatToolsForGemini` no envía `additionalProperties`. Gemini responde 400 con "Unknown name" si el campo aparece.

## Problema abierto

`db_query` declara `params: z.array(z.any())`. Zod genera un array sin `items`, y Gemini rechaza el esquema con "array requiere items". La corrección propuesta es que `cleanSchemaForLLM` asigne `items: {}` a los arrays que no tienen `items`. Esa corrección no está aplicada. El error bloquea la tarea programada `report-email`.

## Lo que no recibe

- `registry.json`, `domain-registry.json` ni `tools.json`.
- Herramientas de células que no son el tipo activo.
- Estado interno de las moléculas, conexiones ni recursos.

## Relaciones

- Cómo decide el LLM con esta información: [[biocore-llm-decision-flow]]
- Ejecución completa: [[biocore-execution-flow]]
- Comparación con cargar todas las herramientas: [[biocore-tools-comparison]]
- Glosario: [[biocore-glossary]]

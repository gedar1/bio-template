---
inclusion: manual
---

# Cómo decide el LLM qué herramienta usar

## Respuesta corta

El LLM no lee `registry.json` ni tiene un catálogo fijo. En cada petición recibe una lista de definiciones de herramientas. Una de ellas es `stimulate_differentiation`, cuya descripción y enum salen del registro de células. El LLM elige por lectura de esas descripciones, igual que con cualquier herramienta.

## De dónde sale `stimulate_differentiation`

`CellServer.setupBaseTools()` (`packages/core/src/cells/CellServer.ts`) construye la herramienta al arrancar cada célula:

1. Toma `registry.cells`. Ese registro ya incluye las células de dominio, porque `loadApplicationRegistry()` fusiona `registry.json` con `domain-registry.json`.
2. Filtra cada tipo con tres condiciones: está en `allowedCells` del perfil del tenant, no es `undifferentiated` y tiene registro integrado o de dominio (`this.registrations.has`).
3. Con los tipos que pasan el filtro, arma el enum de `type` y una descripción con el formato `'tipo': descripción | ...`.
4. Si ningún tipo pasa el filtro, el enum queda en `["undifferentiated"]`.

Un tipo declarado en `registry.json` sin handler no aparece en la herramienta. Hoy eso aplica a `sensory_advanced` y `monitor`: están en el registro con `parent: "sensory"`, pero no tienen registro integrado.

## Qué herramientas ve el LLM en cada vuelta

`UnifiedCortex` llama a `refreshTools()` antes de cada petición y después de cada ejecución de herramientas. Esa llamada consulta a cada organismo con `inspectTools()` (que pide `listTools` a la célula) y deduplica por nombre. La lista contiene:

- `stimulate_differentiation`, siempre.
- Las herramientas del tipo activo. Antes de la primera mutación, la célula no tiene ninguna.

`tools.json` y `registry.json` no llegan al LLM. `tools.json` solo alimenta el catálogo de Jev (ver [[biocore-jev-pre-routing]]).

## Niveles de decisión antes del LLM

El LLM es el último nivel. Antes de llamarlo, `runConversation` y `preRoute` pueden resolver el mensaje con código o con Jev:

1. **Gate de cadenas** (`runConversation`): si Jev detecta `scrape_url→db_insert` con similitud ≥ 0.7, la cadena se ejecuta sin LLM.
2. **Pre-router** (`preRoute`): Jev elige un tipo de célula y la muta antes de llamar al LLM. Se omite si ese tipo ya se mutó en el mensaje actual.
3. **Pista** (`hint`): Jev sugiere una secuencia. Se agrega al historial como mensaje de sistema (`[Jev] Secuencia sugerida: ...`). El LLM la lee, pero no está obligado a seguirla.
4. **LLM**: recibe el historial y las herramientas. Si elige `stimulate_differentiation`, `executeAction` muta la célula y devuelve "Sistema mutado exitosamente. Nuevas herramientas disponibles.". Si el tipo ya se mutó en el mensaje, devuelve que las herramientas de ese tipo ya están disponibles.

Después de una mutación, el bucle vuelve a llamar a `refreshTools()` y la siguiente vuelta usa la lista nueva.

## Cómo elige el LLM

Relaciona la intención del usuario con el texto de `description` y con los valores del enum. La calidad de la elección depende de la descripción en `registry.json` o en `domain-registry.json`. Cambiar esa descripción cambia la decisión sin tocar código. Ese cambio solo tiene efecto en los tipos que tienen handler registrado.

## Límites

- Una célula tiene un tipo activo. Si una tarea necesita dos tipos, el LLM muta dos veces, y cada mutación es una vuelta del bucle con su propia llamada al proveedor.
- `_mutatedTypes` impide repetir la misma mutación dentro de un mensaje. Se limpia en `trackInput()`, al inicio de cada mensaje.
- Si un proveedor falla antes de ejecutar efectos, el bucle prueba el siguiente de `providerChain()`. Después del primer efecto, no hay cambio de proveedor.

## Relaciones

- Qué se envía exactamente al LLM: [[biocore-what-llm-receives]]
- Ciclo de vida de la mutación: [[biocore-mutation-lifecycle]]
- Ejecución completa: [[biocore-execution-flow]]
- Comparación con cargar todas las herramientas: [[biocore-tools-comparison]]

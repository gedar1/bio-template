---
inclusion: manual
---

# Crear un tipo de célula

Una célula es el adaptador MCP que expone solo las herramientas de su tipo activo. La lógica de negocio va en una molecule (ver [[biocore-create-molecule]]).

## Dónde se declara

- **Dominio (el camino del template):**
  - Tipo y tools en `packages/core/src/config/domain-registry.json`.
  - Permiso en `allowedCells` de `packages/core/src/config/domain-profile.ts`.
  - Registro (`CellRegistration`) dentro de `createApplicationComposition()` en `packages/core/src/config/applicationComposition.ts`, en el array `registrations`.
- **Motor (core):** solo para capacidades genéricas de BioCore. Tipo en `packages/core/src/config/registry.json` y registro en el array `builtIns` de `createRegistrations()` en `packages/core/src/cells/CellServer.ts`. Evita tocar esto desde el template.

Un tipo solo se anuncia en `stimulate_differentiation` si cumple tres condiciones: está en `allowedCells`, tiene registro y no es `undifferentiated`. Un tipo que está solo en el registry no aparece para el LLM.

## Procedimiento (dominio)

1. Define el tipo en `domain-registry.json` con `type`, `description` y `tools`. La descripción es lo que el LLM lee para elegir el tipo. Los nombres de `tools` deben coincidir con los `registerTool` del paso 3.
2. Agrega el tipo a `allowedCells` del perfil en `domain-profile.ts`.
3. En `createApplicationComposition()`, agrega un objeto a `registrations`:
   - `factory(context)`: crea la molecule. Si usa la base del tenant, pasa `context.tenantDbPath`. Registra el recurso con `context.trackResource({ key, molecule })` y devuelve `[resource]`. La `key` debe ser única entre los tipos activos; si se repite, `activateTypes` lanza `MutationError`.
   - `registerTools(server, context)`: llama `server.registerTool(nombre, { description, inputSchema }, handler)` por cada tool. Dentro de un handler, obtén la molecule con `context.getResource<T>(key)`.
4. Si el tipo hereda de otro, declara `parent` en el registry. Al mutar, `activateTypes` activa primero la cadena del padre, pero solo los tipos que tienen registro. Un tipo con padre sin registro no se anuncia.
5. Si la capacidad es genérica del motor y no del proyecto, usa el procedimiento de core: entrada en `registry.json` y objeto en `builtIns` de `CellServer.ts`.

## Qué no va en la célula

- Consultas SQL, reglas de negocio, llamadas HTTP de negocio y decisiones de tenant. Eso va en la molecule.
- El handler solo valida con Zod, llama a un método de la molecule y devuelve contenido MCP.

## Verificación

- `npx tsc --noEmit` desde `packages/core`.
- Pruebas desde la raíz: `npx vitest --run --config packages/core/vitest.config.ts`. Las pruebas `tests/cells/CellComposition.spec.ts` y `tests/cells/ApplicationComposition.spec.ts` comparan la lista de tools; actualiza sus expectativas al añadir o quitar tools.
- Comprueba que `stimulate_differentiation` lista el tipo nuevo solo cuando el perfil lo permite.

## Relaciones

- Ciclo de vida de la mutación: [[biocore-mutation-lifecycle]]
- Qué ve el LLM: [[biocore-what-llm-receives]]

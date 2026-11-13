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
6. Agrega cada herramienta a `packages/core/src/config/tools.json` con una descripción clara. El catálogo de Jev (`config/toolCatalog.ts`) lee ese archivo: sin entrada, Jev nunca propone la herramienta, aunque el LLM sí la vea. Los nombres deben coincidir con los de `registerTool`. El validador de contrato lo comprueba.
7. Si la herramienta modifica datos fuera de la conversación (borrar, escribir archivos, enviar mensajes o llamar APIs que escriben), agrégala a `GUARDED_TOOLS` en `packages/core/src/atoms/executionGuardrail.ts` con nivel `high` o `critical`. Una herramienta protegida que no está registrada en ninguna célula no protege nada: revisa que ambas listas coincidan.
8. Define esquemas de entrada con tipos concretos. No uses `z.array(z.any())` ni `z.record(z.any())` en parámetros que el LLM debe llenar. El conversor a JSON Schema deja los arrays sin `items`, y el validador de proveedores rechaza toda la lista de herramientas. Para parámetros variables, usa `z.array(z.string())` y describe el formato en `.describe()`.
9. Describe en `tools.json` y en `registerTool` qué hace la herramienta y qué no hace, con un ejemplo válido. El LLM elige por esa descripción. Así evitamos intentos con sintaxis no permitida, como `PRAGMA` en `db_query`.

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

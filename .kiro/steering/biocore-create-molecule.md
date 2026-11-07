---
inclusion: manual
---

# Crear una molecule

Una molecule encapsula una capacidad de negocio o de integración. Una cell la usa sin conocer el LLM. En el template, el ejemplo de referencia es `packages/core/src/molecules/ExampleMolecule.ts`, registrado en `createApplicationComposition()`.

## Procedimiento

1. Elige un nombre `PascalCase` con sufijo `Molecule` y crea `packages/core/src/molecules/<Nombre>Molecule.ts`. Para un caso nuevo, copia `ExampleMolecule.ts` y renómbralo; no crees paquetes nuevos.
2. Implementa `IMolecule`: `readonly name`, `readonly version`, `initialize()` para abrir recursos y `dispose()` para liberarlos. No abras BD ni clientes externos en el constructor.
3. Mantén la molecule independiente de otras molecules. Recibe configuración simple o una ruta de recurso por constructor. Para la BD del tenant, pasa `context.tenantDbPath`.
4. Mantén las entidades y métodos públicos del dominio dentro de la molecule. Usa `createLogger("NombreMolecule")`. Valida los datos en el boundary de la herramienta con Zod y usa errores tipados del proyecto.
5. Haz la inicialización y el schema idempotentes (`CREATE TABLE IF NOT EXISTS` en SQLite). Respeta el tenant y no escribas datos de negocio en la BD compartida.
6. Conéctala a una célula en `createApplicationComposition()` (ver [[biocore-create-cell]]). La factory crea la instancia y la registra con `context.trackResource`. El ciclo de vida (`initialize` y `dispose`) lo maneja `CellServer` al mutar; no se agregan campos en `CellServer`.
7. Registra una herramienta MCP por operación pública en `registerTools`. La herramienta valida argumentos, llama al método de la molecule y serializa el resultado. No mueve lógica de negocio al handler.
8. Declara el `type` y los nombres exactos de las tools en `domain-registry.json`. El motor (`registry.json`) no se modifica desde el template.
9. Crea las pruebas en `packages/core/tests/molecules/<Nombre>Molecule.spec.ts`. Usa recursos temporales y llama a `dispose()` en `afterEach`.

## Checklist

- [ ] Contrato `IMolecule` completo y lifecycle probado.
- [ ] Ninguna dependencia entre molecules.
- [ ] Célula, registry y nombres de tools alineados.
- [ ] BD, archivos y clientes se cierran en `dispose()`.
- [ ] `npx tsc --noEmit` y `npx vitest --run --config packages/core/vitest.config.ts` pasan.

## Relaciones

- Crear la célula que la expone: [[biocore-create-cell]]
- Ciclo de vida de la mutación: [[biocore-mutation-lifecycle]]

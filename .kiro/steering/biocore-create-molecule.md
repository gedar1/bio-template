---
inclusion: manual
---

# Crear una molecule

Una molecule encapsula una capacidad de negocio o integración y puede ser usada por una cell sin conocer el LLM. La referencia real es `packages/restaurant/src/molecules/OrderMolecule.ts`; el punto de partida del template hermano es `bio-template/packages/core/src/molecules/ExampleMolecule.ts`.

## Procedimiento

1. Elige un nombre `PascalCase` con sufijo `Molecule` y crea `packages/<paquete>/src/molecules/<Nombre>Molecule.ts`. En el template, renombra `packages/core/src/molecules/ExampleMolecule.ts` en lugar de crear `packages/domain/`.
2. Implementa `IMolecule`: `readonly name`, `readonly version`, `initialize()` para abrir recursos y `dispose()` para liberarlos. No abras BD o clientes externos en el constructor.
3. Mantén la molecule independiente de otras molecules. Recibe configuración simple o una ruta de recurso por constructor; no inyectes otra molecule para encadenar capacidades.
4. Mantén entidades y métodos públicos del dominio en la molecule. Usa `createLogger("NombreMolecule")`; valida datos en el boundary de la herramienta con Zod y usa errores tipados del proyecto cuando corresponda.
5. Haz inicialización y schema idempotentes (`CREATE TABLE IF NOT EXISTS` cuando uses SQLite), respeta el tenant y no escribas en la BD compartida si son datos de negocio.
6. Registra la instancia en `CellServer.ts`: agrega el campo privado, inicialízala en `initializeMolecules(type)` y límpiala en `disposeMolecules()`.
7. Registra una herramienta MCP por operación pública en `registerToolsForType(type)`. La herramienta valida argumentos, llama al método de la molecule y serializa el resultado; no mueve la lógica de negocio al handler.
8. Añade el `type` y los nombres exactos de tools al registry. En BioCore usa `packages/core/src/config/registry.json`; en el template usa `packages/core/src/config/domain-registry.json` y conserva el registry del motor sin cambios.
9. Crea tests en `packages/<paquete>/tests/molecules/<Nombre>Molecule.spec.ts` o en `packages/core/tests/molecules/` para el template. Usa recursos temporales y `afterEach` para llamar `dispose()`.

## Checklist

- [ ] Contrato `IMolecule` completo y lifecycle probado.
- [ ] Ninguna dependencia entre molecules.
- [ ] Cell, registry y nombres de tools están alineados.
- [ ] BD, archivos y clientes se cierran en `dispose()`.
- [ ] `npm test` y `npm run build:ts` pasan.

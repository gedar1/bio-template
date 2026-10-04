---
inclusion: fileMatch
fileMatchPattern: "**/packages/*/src/**"
---

# Límites de arquitectura — BioCore

Estas reglas mantienen separadas las capas del motor y el dominio. Aplican tanto al layout canónico de `bio-core` como al layout mínimo de `bio-template`.

## Dependencias permitidas

```
config / tipos compartidos
          ↑
Atoms → Molecules → Cells → Organisms → Orchestrator / Cortex
                    ↑           ↑
             Registry/config   Strategies (inyectadas por el orquestador)
```

- **Atoms** (`packages/*/src/atoms/`) son funciones puras. No importan molecules, cells, organisms, server ni system; no contienen estado mutable, `this`, timers, filesystem, red, base de datos ni logging con efectos secundarios.
- **Molecules** (`packages/*/src/molecules/`) encapsulan una capacidad de negocio o integración. Implementan `IMolecule` (`name`, `version`, `initialize()`, `dispose()`), gestionan sus propios recursos y no dependen de otra molecule. Pueden usar atoms, tipos, configuración y librerías externas.
- **Cells** (`packages/*/src/cells/`) son servidores MCP dinámicos. `CellServer` instancia y libera molecules, resuelve el registry y registra herramientas. No deben contener reglas de negocio, consultas de dominio ni decisiones de tenant.
- **Organisms** (`packages/*/src/organisms/`) controlan una cell como proceso hijo MCP. Coordinan conexión, estímulo e invocación de herramientas; no implementan operaciones de negocio ni duplican handlers de la cell.
- **Strategies** (`packages/*/src/system/strategies/`) implementan contratos de comportamiento intercambiables, como `IReflexExecutor`, `IHistoryManager` e `IPerfTracker`. Reciben colaboradores por inyección y no deben alcanzar directamente el transporte MCP o una cell concreta.
- **Server** (`packages/*/src/server/`) expone entradas HTTP/MCP y rutas. Valida boundaries con los esquemas existentes y delega en orquestador, servicios o estrategias; no es lugar para lógica de una molecule.
- **Config** (`packages/*/src/config/`) define registry, perfiles, agentes, validadores y adapters de logging. La configuración selecciona capacidades; no ejecuta operaciones de negocio.

## Límite core/dominio

- En `bio-core`, el motor genérico vive en `packages/core/src`; las extensiones de industria viven en otro paquete, por ejemplo `packages/restaurant/src/molecules/`.
- En `bio-template`, el checkout mínimo concentra la extensión en `packages/core/src`: usa `molecules/ExampleMolecule.ts`, `config/domain-registry.json`, `config/domain-profile.ts` y `config/profileRegistry.ts`. No inventes `packages/domain/` si no existe en el checkout.
- El código de dominio puede importar contratos y utilidades públicas de core; core no debe importar una molecule, perfil o agente específico del dominio.
- El registry y el perfil deben describir la misma capacidad: el `type` de la cell, los nombres de tools y `allowedCells` deben coincidir.

## Regla de decisión

Antes de agregar código a una capa, pregunta: ¿es una transformación pura (atom), una capacidad con recursos (molecule), un adaptador MCP (cell), un controlador de proceso (organism), una política intercambiable (strategy), una entrada de transporte (server) o configuración? Si pertenece a otra categoría, muévelo en lugar de ampliar la capa equivocada.

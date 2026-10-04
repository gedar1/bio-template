---
inclusion: manual
---

# Crear una strategy

Una strategy representa un comportamiento intercambiable del sistema y se inyecta en `BaseOrchestrator`. La referencia está en `packages/core/src/system/strategies/`: `IReflexExecutor.ts`, `DefaultReflexExecutor.ts`, `IHistoryManager.ts` e `IPerfTracker.ts`.

## Procedimiento

1. Define primero el contrato `I<Capability>.ts` en `packages/core/src/system/strategies/`. Expón solo operaciones necesarias para el orquestador y documenta lifecycle, entradas, salidas y errores.
2. Implementa `Default<Capability>.ts` junto al contrato. Mantén la estrategia enfocada en una política; no copies métodos del orquestador ni accedas directamente a una cell o al transporte MCP.
3. Inyecta colaboradores por constructor o por llamada, según el lifecycle del contrato. Para callbacks de ejecución/ruteo usa tipos explícitos y evita acoplar la strategy a una implementación concreta de Cortex.
4. Conserva efectos de persistencia, logging y métricas en los adapters existentes. Si necesita una molecule, consume su interfaz/servicio sin hacer que una molecule conozca la strategy.
5. Conecta la implementación en `BaseOrchestrator` mediante la configuración/constructor existente y conserva la implementación por defecto para no cambiar el comportamiento cuando no se inyecta nada.
6. Añade tests unitarios en `packages/core/tests/system/strategies/` para el contrato observable, casos de error, fallback y que los colaboradores reciben los argumentos correctos.

## Caso de referencia

`DefaultReflexExecutor` consulta y guarda reflexes, ejecuta secuencias mediante `ReflexCollaborators`, construye versiones de schema y degrada ante incompatibilidades. Esa lógica está separada de `BaseOrchestrator`; una nueva strategy debe seguir la misma frontera.

## Verificación

Ejecuta `npm test` y `npm run build:ts`. Si la strategy cambia contratos serializados o configuración compartida, revisa también los documentos de `docs/biocore/` sin crear una carpeta de skills.

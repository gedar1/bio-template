---
inclusion: manual
---

# Crear un atom

Un atom es una función pequeña y determinista para una transformación reutilizable. Usa esta guía para agregar uno en BioCore o en el template.

## Procedimiento

1. Define el nombre verbal en camelCase y crea `packages/core/src/atoms/<nombre>.ts` (en un paquete de dominio, usa el directorio de atoms de ese paquete solo si la capacidad es específica del dominio).
2. Escribe una función exportada con entradas y salida explícitas. Mantén la misma entrada para la misma salida, sin leer entorno, reloj, archivos, red, BD ni estado global.
3. No importes desde `molecules`, `cells`, `organisms`, `server` o `system`. Si la función necesita IO o una dependencia viva, no es un atom: extrae un atom puro y deja la integración a una molecule o strategy.
4. Exporta el atom desde `packages/core/src/atoms/index.ts` cuando deba ser consumido por otras capas. No modifiques un barrel sin comprobar sus exports existentes.
5. Añade JSDoc con el contrato, casos límite y un ejemplo cuando la función tenga una semántica no obvia.
6. Crea `packages/core/tests/atoms/<nombre>.spec.ts` siguiendo el patrón de `packages/core/tests/atoms/atoms.spec.ts`. Prueba resultado normal, entradas límite y que la función no dependa de orden o estado previo.

## Integración y comprobación

- Si el atom transforma schemas o herramientas, úsalo desde la capa que ya posee el contexto; no le pases una instancia de `CellServer` o una molecule para evitar invertir el boundary.
- Ejecuta `npm test` para la suite y `npm run build:ts` para validar exports y tipos.
- Revisa que el cambio no agregue archivos runtime (`data/`, `*.db`, `dist/`) ni imports de una capa superior.

## En bio-template

El motor del template ya contiene atoms en `packages/core/src/atoms/`. No los edites para resolver lógica de dominio: un atom específico puede vivir allí si es una utilidad pura compartida por el proyecto, mientras que la operación de negocio debe quedarse en `ExampleMolecule.ts` renombrada.

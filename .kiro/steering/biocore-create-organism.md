---
inclusion: manual
---

# Crear un organism

Un organism es un subagente que controla una cell MCP como proceso hijo. Coordina el transporte y el estímulo; no contiene la lógica de la capacidad.

## Procedimiento

1. Crea `packages/core/src/organisms/<Nombre>Organism.ts` y extiende `BaseOrganisms` de `packages/core/src/organisms/BaseOrganisms.ts`.
2. En el constructor pasa un nombre estable y, si corresponde, `allowedCells`. El perfil/tenant es quien limita las cells; no dupliques esa lista con reglas de negocio dentro del organism.
3. Implementa `process(intention)` para interpretar la intención propia del agente y coordinar `stimulate(type)` y `callTool(name, args)`. Comprueba que `initializeContext()` se ejecutó antes de llamar a la cell.
4. Usa `inspectTools()` para descubrir las herramientas actuales en vez de mantener una lista paralela. Trata la cell como un proceso MCP: el organism no instancia directamente molecules ni registra herramientas.
5. Implementa `detach()` o el cierre que requiera el lifecycle existente sin dejar conexiones abiertas. Los errores de inicialización/mutación deben conservar los errores tipados del core y el contexto del organism.
6. Registra el organism en el orquestador o factory existente solo si el caso de uso lo necesita. No cambies `BaseOrganisms` para agregar comportamiento de una sola extensión.
7. Añade tests con un transporte/mock MCP en `packages/core/tests/organisms/` y cubre: inicialización, estímulo, llamada de herramienta y fallo antes de inicializar.

## Verificación

Ejecuta `npm test` y `npm run build:ts`. Comprueba que una mutación expone únicamente las tools del registry y del perfil activo, y que el organism no contiene SQL, filesystem ni lógica de dominio.

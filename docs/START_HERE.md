# START HERE — Cómo crear un caso de uso con BioCore

Este checkout mínimo coloca la extensión de dominio dentro de `packages/core/src`. Antes de modificar código, revisa el steering kit de `.kiro/steering/`; las guías de creación son manuales y están basadas en las rutas reales del template.

## 1. Verifica el contrato

```bash
npm install
npm run validate-template
```

El validador comprueba solo archivos estructurales, JSON y configuración mínima. No requiere `.env`, credenciales, bases SQLite, `data/`, `dist/` ni datos de negocio. No leas ni agregues esos archivos al contrato.

## 2. Conoce el layout

```
packages/core/src/
├── atoms/                    ← utilidades puras del motor
├── cells/                    ← CellServer y adaptadores MCP
├── config/
│   ├── registry.json         ← registry del motor (no reemplazar)
│   ├── domain-registry.json  ← tipos/tools de tu dominio (editar)
│   ├── domain-profile.ts     ← perfil activo (editar)
│   ├── domain-agent.md       ← prompt del dominio (editar si existe)
│   └── profileRegistry.ts    ← registro de perfiles
├── molecules/
│   └── ExampleMolecule.ts    ← punto de partida del dominio (editar o renombrar)
├── organisms/, server/, system/ ← motor (no modificar sin necesidad)
└── domain-seed.ts            ← semillas del dominio, si el checkout las usa
```

No crees `packages/domain` solo porque aparezca en documentación antigua: este template real usa `packages/core/src`.

## 3. Define tu molécula

Copia o renombra `molecules/ExampleMolecule.ts` y conserva el contrato `IMolecule`: `name`, `version`, `initialize()` y `dispose()`. Inicializa recursos en `initialize()`, libéralos en `dispose()` y no dependas de otra molécula. Cada método público que expongas debe registrarse como herramienta MCP.

Invoca `.kiro/steering/biocore-create-molecule.md` para el procedimiento completo y `.kiro/steering/biocore-boundaries.md` para comprobar que la lógica quedó en la capa correcta.

## 4. Define registry y perfil

Edita `config/domain-registry.json` para declarar el tipo de célula y sus tools. Los nombres deben coincidir con los handlers registrados en `CellServer`. Edita `config/domain-profile.ts` para incluir únicamente las células permitidas y el `agentFile` del dominio. El `type`, los nombres de tools y `allowedCells` deben describir la misma capacidad.

No sustituyas `config/registry.json` del motor durante la personalización. Si una integración requiere tocar `CellServer`, sigue `biocore-create-cell.md` y mantén allí solo orquestación MCP.

## 5. Escribe el agente de dominio

El archivo indicado por `agentFile` debe explicar el rol, vocabulario, flujos y reglas destructivas de tu caso de uso. No pongas secretos ni datos reales en steering, prompts, fixtures o documentación.

## 6. Añade seeds y capacidades opcionales

Si el layout incluye un seed de dominio, define frases cortas y flujos de una sola intención. Activa únicamente las células necesarias (`memory`, `http`, `communication`, `filesystem`, etc.). Las moléculas genéricas del motor siguen siendo reutilizables y no deben copiar lógica entre sí.

## 7. Prueba la extensión

Usa Vitest y recursos temporales para moléculas. Comprueba `name`/`version`, ejecuta `initialize()` y libera siempre con `dispose()`. No uses APIs externas ni credenciales reales en tests.

```bash
npm run validate-template
npm test
npm run build:ts
```

Para cambios de comportamiento del motor, consulta también `.kiro/steering/biocore-testing-validation.md` y ejecuta la verificación completa desde `bio-core`.

## 8. Sincronización con bio-core

No edites manualmente el motor para resolver una diferencia permanente. Desde `bio-core`, la fuente de verdad:

```bash
npm run sync-template
```

El script resuelve `BIO_TEMPLATE_PATH` o `../bio-template`. Copia archivos normales, no symlinks, conserva `domain-*`, `ExampleMolecule.ts` y cualquier archivo de `.kiro/steering` o `.kiro/hooks` cuyo nombre comience por `template-`. También sincroniza el validador en `scripts/`.

## Checklist

```
□ npm run validate-template pasa
□ Personalicé ExampleMolecule.ts o creé una molécula con IMolecule
□ Actualicé domain-registry.json y domain-profile.ts
□ El agentFile existe y no contiene secretos
□ Registré las tools en CellServer solo si son necesarias
□ Añadí tests sin APIs externas, .env, BDs ni datos reales
□ npm test y npm run build:ts pasan
□ La sincronización se ejecuta desde bio-core y conserva template-*
```

---
inclusion: fileMatch
fileMatchPattern: "**/packages/*/{src,tests}/**"
---

# Testing y validación — BioCore

Aplica esta guía al modificar `packages/*/src` o `packages/*/tests`, tanto en `bio-core` como en el layout portable de `bio-template`.

## Antes de probar

- Sigue la convención `packages/core/tests/<capa>/<Componente>.spec.ts` y usa Vitest.
- Atoms: prueba funciones puras y casos límite sin IO.
- Molecules: usa recursos temporales, verifica `name`/`version`, ejecuta `initialize()` y siempre llama `dispose()` en `afterEach`.
- Cells/organisms/strategies: prueba boundaries, mutación, herramientas registradas, inyección y errores; no dependas de APIs externas ni de credenciales reales.

## Verificación requerida de FEAT-001

Desde `bio-core`, ejecuta exactamente:

```bash
npm run build:ts
npm test
```

Después revisa el frontmatter de todos los archivos en `.kiro/steering/`: cada archivo debe tener `inclusion` válido (`always`, `fileMatch`, `manual` o `auto`); todo `fileMatch` debe incluir `fileMatchPattern`; y una guía que requiera invocación explícita debe declarar `inclusion: manual`.

## Validación del template

Cuando el cambio afecta el template y sus dependencias están instaladas:

```bash
npm --prefix ..\\bio-template run validate-template
npm --prefix ..\\bio-template run build:ts
```

No asumas que el checkout mínimo tiene esos scripts o el dashboard instalado. No ejecutes sync, hooks ni validadores que no formen parte de la tarea actual.

## Puerta completa del proyecto

Para cambios que sí afecten comportamiento del monorepo, los comandos adicionales documentados son `npm run build` y `npx tsx scripts/verify-invariants.ts`. `npm run build:ts` y `npm test` siguen siendo el mínimo para una modificación de core.

No incluyas en commits `data/`, `*.db`, `dist/`, `.env` ni archivos generados.

## Resiliencia del runner

- Intenta cada comando de validación como máximo una vez. Si termina con código 130, `^C`, `SIGINT` o sin salida, detén todos los reintentos y clasifícalo como bloqueo de infraestructura.
- No pruebes bash, cmd, `pwd`, PowerShell ni terminales alternativas en bucle para rodear ese bloqueo. Solicita al usuario la salida manual usando los comandos exactos y continúa solo con revisión estática mientras el gate quede no verificado.
- La salida manual pegada por el usuario es evidencia válida del comando indicado, pero no debe presentarse como ejecución del runner del agente.

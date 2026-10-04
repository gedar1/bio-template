# Atoms 🔬

Funciones puras sin estado ni efectos secundarios. La capa más baja de BioCore.

| Archivo | Funciones | Descripción |
|---------|-----------|-------------|
| `schema.ts` | `cleanSchemaForLLM`, `deduplicateTools` | Transformación de schemas JSON |
| `toolFormat.ts` | `formatToolsForAnthropic`, `formatToolsForGemini` | Formateo de tools por provider |
| `modelSelection.ts` | `chooseModel` | Selección de modelo LLM |
| `index.ts` | barrel export | Importa todo desde aquí |

Reglas:
- Sin `this`, sin clases, sin estado
- Sin imports de otras capas de BioCore (excepto tipos)
- Sin efectos secundarios (no logs, no I/O, no fetch)
- Fáciles de testear: input → output

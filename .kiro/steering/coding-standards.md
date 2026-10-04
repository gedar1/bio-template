---
inclusion: fileMatch
fileMatchPattern: "**/packages/*/src/**"
---

# Estándares de Código — BioCore (TypeScript/Node.js)

Fuente completa: #[[file:docs/ai/copilot-instructions.md]]

## Reglas fundamentales

- TypeScript estricto, nunca `any`
- Zod para validación en boundaries (inputs de herramientas MCP, API endpoints)
- Pino para logging (`createLogger("Componente")`), nunca `console.log`
- Errores tipados (`BioCoreError` y subclases), nunca `throw new Error()` genérico
- ESM (`import/export`), nunca CommonJS

## Naming

| Tipo                     | Convención          | Ejemplo                          |
| ------------------------ | ------------------- | -------------------------------- |
| Moléculas                | PascalCase + sufijo | `RedisMolecule`                  |
| Interfaces               | Prefijo `I`         | `IMolecule`, `IDatabase`         |
| Átomos (funciones puras) | camelCase con verbo | `chooseModel()`, `formatTools()` |
| Constantes               | UPPER_SNAKE         | `MAX_RETRIES`                    |
| Archivos de clase        | PascalCase          | `CellServer.ts`                  |
| Archivos de función      | camelCase           | `modelSelection.ts`              |

## Capas y responsabilidades

- **Atoms** (`atoms/`): Funciones puras. Sin `this`, sin estado, sin I/O, sin imports de otras capas.
- **Molecules** (`molecules/`): Lógica de negocio. Implementan `IMolecule`. Sin dependencias entre moléculas.
- **Cells** (`cells/`): Servidor MCP dinámico. Solo orquesta moléculas, no contiene lógica de negocio.
- **Organisms** (`organisms/`): Controlan células como procesos hijo. No ejecutan lógica directamente.
- **System** (`system/`): Orquestador + Cortex. Selección de modelo, chat loops, routing de estímulos.

## Errores

```typescript
import { MoleculeError, ToolExecutionError } from "../errors.js";

// En molécula:
throw new MoleculeError("sqlite", "Conexión fallida", { path: dbPath });

// En herramienta MCP:
throw new ToolExecutionError("scrape_url", "Timeout", { url });
```

## Testing

- Framework: Vitest
- Archivos: `tests/[capa]/NombreComponente.spec.ts`
- Siempre verificar contrato `IMolecule` (name, version)
- Usar `beforeEach`/`afterEach` para setup/cleanup de conexiones

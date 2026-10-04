---
inclusion: auto
description: "Guía para generar documentación HTML usando el Doc Engine basado en JSON + Web Components"
---

# HTML Documentation — Doc Engine

## Sistema

La documentación visual usa un engine basado en JSON + Web Components. NO generar HTML inline con estilos repetidos.

## Estructura

```
docs/
├── _engine/
│   ├── data/           ← JSONs con contenido
│   │   ├── index.json  ← catálogo de docs (sidebar)
│   │   └── {id}.json   ← un archivo por documento
│   ├── docs.css        ← estilos globales
│   ├── components.js   ← Web Components
│   └── renderer.js     ← carga JSON y renderiza
└── viewer.html         ← shell HTML
```

## Reglas

1. **Solo JSON, no Markdown**: La documentación se escribe únicamente como JSON en `docs/_engine/data/`. No generar archivos `.md` en `docs/`. El JSON es la única fuente de verdad.
2. **Registrar en index.json**: Cada doc nuevo debe agregarse al catálogo `docs/_engine/data/index.json`.
3. **No repetir CSS/HTML**: Todo el estilo vive en `docs.css`. Los componentes en `components.js`. El contenido en los JSONs.
4. **Convención de IDs**: usar kebab-case para los IDs de documentos (ej: `architecture`, `execution-flow`, `llm-decision-flow`).
5. **JSON como contexto**: Los steering files que necesiten referenciar documentación técnica deben apuntar al JSON con `#[[file:docs/_engine/data/{id}.json]]` en vez de duplicar la información. Incluir un resumen breve en el steering para contexto rápido.
6. **Diagramas con Mermaid**: Usar `"type": "diagram"` con sintaxis Mermaid para diagramas. No usar ASCII art ni box-drawing characters.

## Formato del JSON

```json
{
  "title": "Título",
  "subtitle": "Descripción breve",
  "date": "Fecha",
  "project": "Nombre del proyecto",
  "sections": [
    { "type": "tipo", "id": "anchor", "title": "Título sección", ... }
  ]
}
```

## Tipos de sección

| type        | Campos requeridos            | Uso               |
| ----------- | ---------------------------- | ----------------- |
| `layers`    | items: [{name, file, desc}]  | Diagrama de capas |
| `table`     | columns: [], rows: [[]]      | Tabla             |
| `decisions` | items: [{mode, title, body}] | Bloques decisión  |
| `code`      | content: "string"            | Código/diagrama   |
| `diagram`   | content: "mermaid syntax"    | Diagrama Mermaid  |
| `callout`   | variant, calloutTitle, body  | Callout           |
| `badges`    | items: ["tag1"]              | Badges inline     |
| `list`      | items: ["item1"]             | Lista             |
| `text`      | content: "html"              | Párrafo           |
| `separator` | —                            | HR                |
| `group`     | children: [sections]         | Anidado           |

Campos opcionales en cualquier sección: `id`, `title`, `level` (2 o 3), `description`.

## Cuándo generar JSON

- Al crear o actualizar documentación en `docs/`
- Cuando el usuario pida documentación visual
- Al completar una feature importante

## Cuándo NO generar JSON

- Para README.md en la raíz
- Para steering files o specs de Kiro
- Para archivos temporales

## Setup en proyecto nuevo

Usar el skill `setup-doc-engine` para instalar el engine completo en un proyecto nuevo.

## Viewer

```cmd
npm run docs
# Abrir: http://localhost:4000/viewer.html#doc-id
```

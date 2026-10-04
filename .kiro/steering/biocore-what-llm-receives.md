---
inclusion: manual
---

# 📤 Exactamente Qué Se Envía al LLM

## La Pregunta

**¿Se envía el registry.json completo al LLM? ¿O solo la información del schema?**

Respuesta: **NO se envía el archivo registry.json. Se envía solo el schema estructurado de las herramientas.**

---

## 🔍 Lo Que Realmente Se Envía

### Paso 1: El Usuario Escribe

```
Usuario: "Scrapea https://example.com y guarda el título en la DB"
```

### Paso 2: UnifiedCortex Prepara la Llamada a la API

```typescript
// En UnifiedCortex.ts línea 100-110

const response = await this.anthropic.messages.create({
  model: "claude-3-5-sonnet-latest",
  max_tokens: 1024,

  // ⭐ ESTO SE ENVÍA AL LLM:
  messages: [
    {
      role: "system",
      content:
        "Eres el Cortex de un sistema biológico BioCore. Puedes mutar tus órganos usando señales de diferenciación.",
    },
    {
      role: "user",
      content: "Scrapea https://example.com y guarda el título en la DB",
    },
  ],

  // ⭐ Y ESTO TAMBIÉN SE ENVÍA AL LLM:
  tools: [
    {
      name: "stimulate_differentiation",
      description:
        "Muta la célula a un perfil especializado con nuevas herramientas. Tipos disponibles: 'sensory': Para leer datos externos: web scraping, APIs REST, feeds RSS. | 'memory': Para persistir y consultar información: bases de datos, archivos JSON, caché. | ...",
      inputSchema: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: [
              "sensory",
              "sensory_advanced",
              "memory",
              "filesystem",
              "communication",
              "versioncontrol",
              "http",
              "system",
              "monitor",
              "undifferentiated",
            ],
            description:
              "'sensory': Para leer datos externos: web scraping, APIs REST, feeds RSS. | 'memory': Para persistir y consultar información: bases de datos, archivos JSON, caché. | ...",
          },
        },
        required: ["type"],
      },
    },
  ],
});
```

---

## 📊 Visualización: Qué Va en Cada Parte

```
┌─────────────────────────────────────────────────────────────────┐
│ LLAMADA A LA API DE CLAUDE/GEMINI                               │
└─────────────────────────────────────────────────────────────────┘

{
  "model": "claude-3-5-sonnet-latest",
  "max_tokens": 1024,

  ┌─────────────────────────────────────────────────────────────┐
  │ PARTE 1: MESSAGES (Historial + Prompt)                      │
  └─────────────────────────────────────────────────────────────┘
  "messages": [
    {
      "role": "system",
      "content": "Eres el Cortex de un sistema biológico BioCore. Puedes mutar tus órganos usando señales de diferenciación."
      ↑
      Esto viene de BaseOrchestrator.constructor()
      NO viene del registry.json
    },
    {
      "role": "user",
      "content": "Scrapea https://example.com y guarda el título en la DB"
      ↑
      Esto es lo que escribió el usuario
    }
  ],

  ┌─────────────────────────────────────────────────────────────┐
  │ PARTE 2: TOOLS (Schema de Herramientas)                     │
  └─────────────────────────────────────────────────────────────┘
  "tools": [
    {
      "name": "stimulate_differentiation",
      "description": "Muta la célula a un perfil especializado con nuevas herramientas. Tipos disponibles: 'sensory': Para leer datos externos: web scraping, APIs REST, feeds RSS. | 'memory': Para persistir y consultar información: bases de datos, archivos JSON, caché. | 'filesystem': Operaciones de archivos: leer, escribir, copiar, mover, listar directorios. | 'communication': Envío de emails, WhatsApp y comunicación externa. | 'versioncontrol': Operaciones Git: commit, push, pull, branches, log. | 'http': Peticiones HTTP avanzadas: GET, POST, PUT, DELETE, upload, download. | 'system': Capacidad Híbrida: Ejecuta herramientas de sistema mediante CLIs. | 'monitor': Monitoreo inteligente: combina scraping, HTTP y sistema para vigilar servicios. | 'undifferentiated': Estado inicial sin capacidades específicas.",
      ↑
      Esto viene de:
      1. registry.json (los tipos y descripciones)
      2. CellServer.setupBaseTools() (construye el schema)
      3. formatToolsForGemini() (formatea para Gemini)

      "inputSchema": {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "sensory",
              "sensory_advanced",
              "memory",
              "filesystem",
              "communication",
              "versioncontrol",
              "http",
              "system",
              "monitor",
              "undifferentiated"
            ],
            ↑
            Estos valores vienen de registry.json

            "description": "'sensory': Para leer datos externos: web scraping, APIs REST, feeds RSS. | 'memory': Para persistir y consultar información: bases de datos, archivos JSON, caché. | ..."
            ↑
            Estas descripciones vienen de registry.json
          }
        },
        "required": ["type"]
      }
    }
  ]
}
```

---

## 🔄 El Flujo Completo: De registry.json a la API

```
┌─────────────────────────────────────────────────────────────┐
│ PASO 1: registry.json (Archivo en Disco)                    │
└─────────────────────────────────────────────────────────────┘

{
  "cells": [
    {
      "type": "sensory",
      "description": "Para leer datos externos: web scraping, APIs REST, feeds RSS.",
      "tools": ["scrape_url", "scrape_metadata", ...]
    },
    {
      "type": "memory",
      "description": "Para persistir y consultar información: bases de datos, archivos JSON, caché.",
      "tools": ["db_query", "db_insert", ...]
    },
    ...
  ]
}
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PASO 2: CellServer.setupBaseTools() (En Memoria)            │
└─────────────────────────────────────────────────────────────┘

Lee registry.json y extrae:
  - validTypes = ["sensory", "memory", "filesystem", ...]
  - typeDescriptions = "'sensory': Para leer datos externos... | 'memory': Para persistir... | ..."

Construye el schema:
{
  name: "stimulate_differentiation",
  description: "Muta la célula... Tipos: 'sensory': web scraping | 'memory': BD | ...",
  inputSchema: {
    properties: {
      type: {
        enum: ["sensory", "memory", ...],
        description: "'sensory': web scraping | 'memory': BD | ..."
      }
    }
  }
}
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PASO 3: formatToolsForGemini() (Conversión de Formato)      │
└─────────────────────────────────────────────────────────────┘

Convierte el schema a formato JSON que Gemini entiende:
{
  "name": "stimulate_differentiation",
  "description": "...",
  "inputSchema": { ... }
}
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PASO 4: genAI.getGenerativeModel({ tools: [...] })          │
└─────────────────────────────────────────────────────────────┘

Envía a la API de Google:
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent

{
  "model": "gemini-2.0-flash",
  "tools": [
    {
      "name": "stimulate_differentiation",
      "description": "...",
      "inputSchema": { ... }
    }
  ],
  "messages": [
    { "role": "user", "content": "Scrapea https://example.com..." }
  ]
}
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PASO 5: Gemini Recibe y Analiza                             │
└─────────────────────────────────────────────────────────────┘

Gemini recibe:
  - El mensaje del usuario
  - El schema de herramientas (con enum + descriptions)
  - NO recibe el archivo registry.json

Gemini razona:
  1. Usuario dice: "Scrapea"
  2. Veo enum: ["sensory", "memory", ...]
  3. Veo description: "'sensory': web scraping"
  4. Decido: stimulate_differentiation({ type: "sensory" })
```

---

## 🎯 Respuesta Directa a Tu Pregunta

**¿Se envía el registry.json completo?**

- **NO**. El archivo registry.json nunca sale del servidor.

**¿Se envía información del registry.json?**

- **SÍ**, pero solo la información relevante, transformada en un schema estructurado.

**¿Qué se envía exactamente?**

- El **schema de la herramienta** con:
  - `name`: "stimulate_differentiation"
  - `description`: Texto que describe qué hace y qué tipos hay
  - `inputSchema`: Objeto JSON con `enum` (valores válidos) y `description` (explicación de cada valor)

**¿Le dice al LLM que mire el registry?**

- **NO**. El LLM nunca sabe que existe un archivo llamado "registry.json".
- El LLM solo ve el schema estructurado que le enviamos.

---

## 💡 Analogía

Es como si le dijeras a alguien:

**Opción 1 (Lo que NO hace BioCore):**

- "Aquí está el archivo registry.json. Léelo y entiende qué hacer."

**Opción 2 (Lo que SÍ hace BioCore):**

- "Tienes una herramienta llamada 'stimulate_differentiation'. Puede recibir estos valores: sensory (para web scraping), memory (para BD), filesystem (para archivos). ¿Cuál necesitas?"

El LLM recibe la **Opción 2**: información clara, estructurada y lista para usar.

---

## 🔍 Dónde Se Transforma registry.json en Schema

```typescript
// En CellServer.ts línea 30-40

const registry = require(join(__dirname, "../config/registry.json")) as {
  cells: CellTypeDefinition[];
};

// ⭐ Aquí se extrae la información del registry
const validTypes = registry.cells.map((c) => c.type) as [string, ...string[]];
const typeDescriptions = registry.cells
  .map((c) => `'${c.type}': ${c.description}`)
  .join(" | ");

// ⭐ Aquí se construye el schema que se envía al LLM
private setupBaseTools() {
  this.server.registerTool(
    "stimulate_differentiation",
    {
      description: `Muta la célula a un perfil especializado con nuevas herramientas. Tipos disponibles: ${typeDescriptions}`,
      inputSchema: {
        type: z.enum(validTypes).describe(typeDescriptions),
      },
    },
    // ...
  );
}
```

**El flujo:**

1. Lee registry.json
2. Extrae `validTypes` y `typeDescriptions`
3. Construye el schema con esa información
4. Envía el schema al LLM (NO el archivo)

---

## 📋 Resumen

| Pregunta                                | Respuesta                           |
| --------------------------------------- | ----------------------------------- |
| ¿Se envía registry.json?                | NO                                  |
| ¿Se envía información de registry.json? | SÍ, transformada en schema          |
| ¿Qué ve el LLM?                         | El schema con enum + descriptions   |
| ¿Sabe el LLM que existe registry.json?  | NO                                  |
| ¿Cómo sabe el LLM qué valores usar?     | Del enum y description en el schema |
| ¿Dónde se transforma?                   | En CellServer.setupBaseTools()      |

**En una línea:**

```
registry.json → CellServer extrae info → construye schema → envía schema al LLM
```

El LLM nunca ve el archivo, solo el schema estructurado.

---

## Relaciones

- Cómo el LLM decide con esa información: [[biocore-llm-decision-flow]]
- Cómo se ejecuta la decisión: [[biocore-execution-flow]]
- Comparación de herramientas SIN vs CON BioCore: [[biocore-tools-comparison]]
- Glosario (Registry, Schema, Átomo): [[biocore-glossary]]

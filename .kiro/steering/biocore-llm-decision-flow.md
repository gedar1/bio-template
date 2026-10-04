---
inclusion: manual
---

# 🧠 Cómo el LLM Sabe Que Debe Usar "sensory"

## La Pregunta Clave

**¿Cómo sabe el LLM que el estímulo es 'sensory' y no 'memory' o 'communication'?**

Respuesta: **El LLM no "sabe" de antemano. Lo aprende del schema de la herramienta que le enviamos.**

---

## 📋 Paso 1: Construcción del Schema en CellServer

Cuando el sistema arranca, `CellServer` construye la herramienta `stimulate_differentiation` con un schema muy específico:

```typescript
// En CellServer.ts línea 82-128

private setupBaseTools() {
  this.server.registerTool(
    "stimulate_differentiation",
    {
      // ⭐ AQUÍ ES LA MAGIA: La descripción lista TODOS los tipos disponibles
      description: `Muta la célula a un perfil especializado con nuevas herramientas.
                    Tipos disponibles: 'sensory': Para leer datos externos: web scraping, APIs REST, feeds RSS. |
                                       'sensory_advanced': Scraping avanzado con paginación, extracción de texto y análisis profundo. |
                                       'memory': Para persistir y consultar información: bases de datos, archivos JSON, caché. |
                                       'filesystem': Operaciones de archivos: leer, escribir, copiar, mover, listar directorios. |
                                       'communication': Envío de emails, WhatsApp y comunicación externa. |
                                       'versioncontrol': Operaciones Git: commit, push, pull, branches, log. |
                                       'http': Peticiones HTTP avanzadas: GET, POST, PUT, DELETE, upload, download. |
                                       'system': Capacidad Híbrida: Ejecuta herramientas de sistema mediante CLIs. |
                                       'monitor': Monitoreo inteligente: combina scraping, HTTP y sistema para vigilar servicios. |
                                       'undifferentiated': Estado inicial sin capacidades específicas.`,

      // ⭐ El schema define qué valores son válidos
      inputSchema: {
        type: z.enum(validTypes).describe(typeDescriptions),
        // validTypes = ["sensory", "sensory_advanced", "memory", "filesystem", ...]
      },
    },
    async ({ type }) => {
      // Ejecuta la mutación
    },
  );
}
```

---

## 🔄 Paso 2: El LLM Recibe la Herramienta

Cuando `UnifiedCortex` llama a `getUnifiedTools()`, obtiene:

```typescript
// En UnifiedCortex.ts línea 56-59

private async getGeminiTools() {
  const unified = await this.getUnifiedTools();
  return formatToolsForGemini(unified);
}
```

Que retorna algo como:

```json
[
  {
    "name": "stimulate_differentiation",
    "description": "Muta la célula a un perfil especializado con nuevas herramientas. Tipos disponibles: 'sensory': Para leer datos externos: web scraping, APIs REST, feeds RSS. | 'memory': Para persistir y consultar información: bases de datos, archivos JSON, caché. | ...",
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
          "description": "'sensory': Para leer datos externos... | 'memory': Para persistir... | ..."
        }
      },
      "required": ["type"]
    }
  }
]
```

---

## 🧠 Paso 3: El LLM Analiza y Decide

Ahora el LLM recibe:

```
USUARIO: "Scrapea https://example.com y guarda el título en la DB"

HERRAMIENTAS DISPONIBLES:
{
  "name": "stimulate_differentiation",
  "description": "Muta la célula a un perfil especializado con nuevas herramientas.
                  Tipos disponibles:
                  - 'sensory': Para leer datos externos: web scraping, APIs REST, feeds RSS.
                  - 'memory': Para persistir y consultar información: bases de datos, archivos JSON, caché.
                  - 'communication': Envío de emails, WhatsApp y comunicación externa.
                  - ..."
  "inputSchema": {
    "properties": {
      "type": {
        "enum": ["sensory", "sensory_advanced", "memory", "filesystem", "communication", ...]
      }
    }
  }
}
```

El LLM **razona así:**

```
1. Usuario dice: "Scrapea https://example.com"
   → Necesito web scraping

2. Veo la descripción de stimulate_differentiation
   → Dice: "'sensory': Para leer datos externos: web scraping, APIs REST, feeds RSS"

3. ¡Perfecto! "sensory" es para web scraping

4. Veo el enum: ["sensory", "sensory_advanced", "memory", ...]
   → "sensory" es un valor válido

5. Decido: Voy a llamar stimulate_differentiation con type="sensory"
```

---

## 📊 Flujo Visual Completo

```
┌─────────────────────────────────────────────────────────────┐
│ PASO 1: CONSTRUCCIÓN DEL SCHEMA (CellServer)                │
└─────────────────────────────────────────────────────────────┘

registry.json:
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
CellServer.setupBaseTools():
  - Lee registry.json
  - Extrae: validTypes = ["sensory", "memory", "filesystem", ...]
  - Extrae: typeDescriptions = "'sensory': Para leer datos externos... | 'memory': Para persistir... | ..."
  - Crea schema con enum y descriptions
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PASO 2: ENVÍO AL LLM (UnifiedCortex)                        │
└─────────────────────────────────────────────────────────────┘

getUnifiedTools() → [
  {
    name: "stimulate_differentiation",
    description: "Muta la célula... Tipos: 'sensory': web scraping | 'memory': BD | ...",
    inputSchema: {
      properties: {
        type: {
          enum: ["sensory", "memory", "filesystem", ...],
          description: "'sensory': web scraping | 'memory': BD | ..."
        }
      }
    }
  }
]
       ↓
formatToolsForGemini(tools) → JSON con schema completo
       ↓
genAI.getGenerativeModel({ tools: [...] })
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PASO 3: LLM RECIBE Y ANALIZA                                │
└─────────────────────────────────────────────────────────────┘

Gemini recibe:
  - Mensaje: "Scrapea https://example.com y guarda en DB"
  - Herramientas: [stimulate_differentiation con schema]

Gemini razona:
  1. "Necesito web scraping"
  2. Veo enum: ["sensory", "memory", "filesystem", ...]
  3. Veo description: "'sensory': Para leer datos externos: web scraping, APIs REST"
  4. ¡Perfecto! "sensory" es para web scraping
  5. Decido: stimulate_differentiation({ type: "sensory" })
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PASO 4: EJECUCIÓN                                           │
└─────────────────────────────────────────────────────────────┘

orchestrator.executeAction("stimulate_differentiation", { type: "sensory" })
  ↓
routeStimulus("sensory")
  ↓
Todos los organismos reciben: stimulate("sensory")
  ↓
CellServer.stimulate_differentiation("sensory")
  ↓
Célula muta: instancia ScraperMolecule, HTTPMolecule
  ↓
Registra herramientas: [scrape_url, extract_links, scrape_metadata, ...]
```

---

## 🎯 La Clave: El Schema Es el Maestro

El LLM **no tiene inteligencia mágica**. Simplemente:

1. **Lee el enum** en el schema: `["sensory", "memory", "filesystem", ...]`
2. **Lee las descripciones** en el schema: `"'sensory': Para leer datos externos: web scraping..."`
3. **Aplica lógica de lenguaje natural** para mapear la solicitud del usuario a la opción correcta

```
Usuario dice: "Scrapea"
Schema dice: "'sensory': web scraping"
LLM conecta: scraping → sensory ✓
```

```
Usuario dice: "Guarda en BD"
Schema dice: "'memory': bases de datos"
LLM conecta: BD → memory ✓
```

---

## 💡 Ejemplo: Cómo Cambiar el Comportamiento

Si quisieras que el LLM elija diferente, solo cambias el registry.json:

**Antes:**

```json
{
  "type": "sensory",
  "description": "Para leer datos externos: web scraping, APIs REST, feeds RSS."
}
```

**Después:**

```json
{
  "type": "sensory",
  "description": "Para leer datos externos: web scraping, APIs REST, feeds RSS, SCRAPING DE REDES SOCIALES, EXTRACCIÓN DE DATOS MASIVOS."
}
```

Ahora el LLM verá "SCRAPING DE REDES SOCIALES" en la descripción y lo considerará para esa tarea.

---

## 🔍 Resumen: Los 3 Componentes del Schema

```typescript
// 1. ENUM: Valores válidos
"enum": ["sensory", "memory", "filesystem", ...]

// 2. DESCRIPTION: Explicación para el LLM
"description": "'sensory': Para leer datos externos: web scraping, APIs REST, feeds RSS. | 'memory': Para persistir y consultar información: bases de datos, archivos JSON, caché. | ..."

// 3. TYPE: Tipo de dato
"type": "string"
```

El LLM usa estos 3 componentes para:

- **Validar** que solo puede elegir valores del enum
- **Entender** qué hace cada valor (description)
- **Razonar** cuál es el más apropiado para la tarea

---

## 🚀 Flujo Resumido en 1 Línea

```
registry.json → CellServer.setupBaseTools() → schema con enum+descriptions →
LLM recibe schema → LLM mapea usuario a enum → LLM elige "sensory"
```

**El LLM "sabe" porque le dijimos exactamente qué opciones tiene y qué hace cada una.**

---

## Relaciones

- Qué recibe el LLM exactamente: [[biocore-what-llm-receives]]
- Cómo se ejecuta después de decidir: [[biocore-execution-flow]]
- Comparación SIN vs CON BioCore: [[biocore-tools-comparison]]
- Glosario (Registry, Célula, Átomo): [[biocore-glossary]]

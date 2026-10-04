---
inclusion: manual
---

# 🔧 Comparación: Carga de Herramientas SIN BioCore vs CON BioCore

## El Escenario

Usuario: "Scrapea https://example.com y guarda el título en la DB"

---

## ❌ SIN BioCore (Enfoque Tradicional)

### Paso 1: Cargar TODAS las Herramientas al Inicio

```typescript
// Sin BioCore: Cargas todas las herramientas de una vez
const tools = [
  {
    name: "scrape_url",
    description: "Scrapea una URL",
    inputSchema: { ... }
  },
  {
    name: "extract_links",
    description: "Extrae links de una página",
    inputSchema: { ... }
  },
  {
    name: "scrape_metadata",
    description: "Extrae metadata de una página",
    inputSchema: { ... }
  },
  {
    name: "extract_images",
    description: "Extrae imágenes de una página",
    inputSchema: { ... }
  },
  {
    name: "fetch_api",
    description: "Hace peticiones HTTP",
    inputSchema: { ... }
  },
  {
    name: "db_query",
    description: "Ejecuta queries en BD",
    inputSchema: { ... }
  },
  {
    name: "db_insert",
    description: "Inserta datos en BD",
    inputSchema: { ... }
  },
  {
    name: "db_find",
    description: "Busca datos en BD",
    inputSchema: { ... }
  },
  {
    name: "db_update",
    description: "Actualiza datos en BD",
    inputSchema: { ... }
  },
  {
    name: "db_delete",
    description: "Elimina datos en BD",
    inputSchema: { ... }
  },
  {
    name: "read_file",
    description: "Lee un archivo",
    inputSchema: { ... }
  },
  {
    name: "write_file",
    description: "Escribe un archivo",
    inputSchema: { ... }
  },
  {
    name: "delete_file",
    description: "Elimina un archivo",
    inputSchema: { ... }
  },
  {
    name: "list_files",
    description: "Lista archivos en un directorio",
    inputSchema: { ... }
  },
  {
    name: "send_email",
    description: "Envía un email",
    inputSchema: { ... }
  },
  {
    name: "send_whatsapp",
    description: "Envía un WhatsApp",
    inputSchema: { ... }
  },
  {
    name: "git_commit",
    description: "Hace un commit en Git",
    inputSchema: { ... }
  },
  {
    name: "git_push",
    description: "Hace push en Git",
    inputSchema: { ... }
  },
  {
    name: "git_pull",
    description: "Hace pull en Git",
    inputSchema: { ... }
  },
  {
    name: "execute_cli",
    description: "Ejecuta comandos CLI",
    inputSchema: { ... }
  },
  // ... 30 herramientas más
];

// Envía al LLM
const response = await anthropic.messages.create({
  model: "claude-3-5-sonnet-latest",
  max_tokens: 1024,
  messages: [
    {
      role: "user",
      content: "Scrapea https://example.com y guarda el título en la DB"
    }
  ],
  tools: tools  // ⭐ 50+ herramientas de una vez
});
```

### Paso 2: LLM Ve TODAS las Herramientas

```
El LLM recibe:
┌─────────────────────────────────────────────────────────────┐
│ HERRAMIENTAS DISPONIBLES (50+)                              │
├─────────────────────────────────────────────────────────────┤
│ 1. scrape_url                                               │
│ 2. extract_links                                            │
│ 3. scrape_metadata                                          │
│ 4. extract_images                                           │
│ 5. fetch_api                                                │
│ 6. db_query                                                 │
│ 7. db_insert                                                │
│ 8. db_find                                                  │
│ 9. db_update                                                │
│ 10. db_delete                                               │
│ 11. read_file                                               │
│ 12. write_file                                              │
│ 13. delete_file                                             │
│ 14. list_files                                              │
│ 15. send_email                                              │
│ 16. send_whatsapp                                           │
│ 17. git_commit                                              │
│ 18. git_push                                                │
│ 19. git_pull                                                │
│ 20. execute_cli                                             │
│ ... 30 más                                                  │
└─────────────────────────────────────────────────────────────┘

Problemas:
❌ Context window desperdiciado (50+ herramientas)
❌ LLM confundido (¿cuál usar?)
❌ Más tokens gastados
❌ Más lento
❌ Más caro
```

### Paso 3: LLM Decide (Con Confusión)

```
LLM piensa:
"Usuario dice 'scrapea'... tengo 50 opciones:
- scrape_url ✓
- extract_links (también scraping?)
- scrape_metadata (también scraping?)
- fetch_api (también puede scrapear?)
- execute_cli (también puede scrapear?)

¿Cuál uso? Voy a usar scrape_url porque es la más obvia."

Gemini retorna:
{
  "functionCalls": [
    {
      "name": "scrape_url",
      "args": { "url": "https://example.com", "schema": {...} }
    }
  ]
}
```

### Paso 4: Ejecuta Scraping

```
Ejecuta scrape_url → Obtiene datos
```

### Paso 5: LLM Continúa (Sigue Viendo TODAS las Herramientas)

```
LLM recibe resultado del scraping y piensa:
"Ahora necesito guardar en BD... tengo 50 opciones:
- db_insert ✓
- db_query (también puede insertar?)
- db_update (también puede guardar?)
- execute_cli (también puede guardar?)

¿Cuál uso? Voy a usar db_insert."

Gemini retorna:
{
  "functionCalls": [
    {
      "name": "db_insert",
      "args": { "table": "scraped_data", "data": {...} }
    }
  ]
}
```

### Paso 6: Ejecuta Inserción

```
Ejecuta db_insert → Guarda en BD
```

### Resumen SIN BioCore

```
┌─────────────────────────────────────────────────────────────┐
│ FLUJO SIN BIOCORE                                           │
├─────────────────────────────────────────────────────────────┤
│ 1. Cargar 50+ herramientas                                  │
│ 2. Enviar al LLM                                            │
│ 3. LLM ve 50+ herramientas (confusión)                      │
│ 4. LLM elige scrape_url                                     │
│ 5. Ejecuta scrape_url                                       │
│ 6. LLM sigue viendo 50+ herramientas                        │
│ 7. LLM elige db_insert                                      │
│ 8. Ejecuta db_insert                                        │
│ 9. Fin                                                      │
│                                                             │
│ Problemas:                                                  │
│ ❌ 50+ herramientas siempre disponibles                     │
│ ❌ Context window desperdiciado                             │
│ ❌ LLM confundido                                           │
│ ❌ Más tokens = más caro                                    │
│ ❌ Más lento                                                │
└─────────────────────────────────────────────────────────────┘
```

---

## ✅ CON BioCore (Enfoque Inteligente)

### Paso 1: Cargar SOLO la Herramienta de Mutación

```typescript
// Con BioCore: Solo cargas stimulate_differentiation
const tools = [
  {
    name: "stimulate_differentiation",
    description: "Muta la célula a un perfil especializado con nuevas herramientas.
                  Tipos disponibles:
                  'sensory': Para leer datos externos: web scraping, APIs REST, feeds RSS. |
                  'memory': Para persistir y consultar información: bases de datos, archivos JSON, caché. |
                  'filesystem': Operaciones de archivos: leer, escribir, copiar, mover, listar directorios. |
                  'communication': Envío de emails, WhatsApp y comunicación externa. |
                  'versioncontrol': Operaciones Git: commit, push, pull, branches, log. |
                  'http': Peticiones HTTP avanzadas: GET, POST, PUT, DELETE, upload, download. |
                  'system': Capacidad Híbrida: Ejecuta herramientas de sistema mediante CLIs. |
                  'monitor': Monitoreo inteligente: combina scraping, HTTP y sistema para vigilar servicios.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["sensory", "memory", "filesystem", "communication", "versioncontrol", "http", "system", "monitor"],
          description: "'sensory': web scraping | 'memory': BD | 'filesystem': archivos | ..."
        }
      },
      required: ["type"]
    }
  }
];

// Envía al LLM
const response = await anthropic.messages.create({
  model: "claude-3-5-sonnet-latest",
  max_tokens: 1024,
  messages: [
    {
      role: "user",
      content: "Scrapea https://example.com y guarda el título en la DB"
    }
  ],
  tools: tools  // ⭐ Solo 1 herramienta
});
```

### Paso 2: LLM Ve SOLO 1 Herramienta

```
El LLM recibe:
┌─────────────────────────────────────────────────────────────┐
│ HERRAMIENTAS DISPONIBLES (1)                                │
├─────────────────────────────────────────────────────────────┤
│ 1. stimulate_differentiation                                │
│    - sensory: web scraping                                  │
│    - memory: BD                                             │
│    - filesystem: archivos                                   │
│    - communication: emails/WhatsApp                         │
│    - versioncontrol: Git                                    │
│    - http: peticiones HTTP                                  │
│    - system: comandos CLI                                   │
│    - monitor: monitoreo                                     │
└─────────────────────────────────────────────────────────────┘

Ventajas:
✅ Context window optimizado (1 herramienta)
✅ LLM claro (solo 1 opción)
✅ Menos tokens gastados
✅ Más rápido
✅ Más barato
```

### Paso 3: LLM Decide (Sin Confusión)

```
LLM piensa:
"Usuario dice 'scrapea'... tengo 1 opción:
- stimulate_differentiation con type='sensory' (web scraping)

¡Perfecto! Voy a usar sensory."

Gemini retorna:
{
  "functionCalls": [
    {
      "name": "stimulate_differentiation",
      "args": { "type": "sensory" }
    }
  ]
}
```

### Paso 4: Sistema Muta

```
UnifiedCortex.executeAction("stimulate_differentiation", { type: "sensory" })
  ↓
BaseOrchestrator.routeStimulus("sensory")
  ↓
BaseOrganisms.stimulate("sensory")
  ↓
CellServer.stimulate_differentiation("sensory")
  ↓
Instancia: ScraperMolecule, HTTPMolecule
Registra: scrape_url, extract_links, scrape_metadata, extract_images, fetch_api
```

### Paso 5: LLM Recibe NUEVAS Herramientas (Solo las Relevantes)

```
UnifiedCortex.getUnifiedTools() retorna:
[
  {
    name: "stimulate_differentiation",
    description: "...",
    inputSchema: { ... }
  },
  {
    name: "scrape_url",
    description: "Scrapea una URL",
    inputSchema: { ... }
  },
  {
    name: "extract_links",
    description: "Extrae links de una página",
    inputSchema: { ... }
  },
  {
    name: "scrape_metadata",
    description: "Extrae metadata de una página",
    inputSchema: { ... }
  },
  {
    name: "extract_images",
    description: "Extrae imágenes de una página",
    inputSchema: { ... }
  },
  {
    name: "fetch_api",
    description: "Hace peticiones HTTP",
    inputSchema: { ... }
  }
]

El LLM recibe:
┌─────────────────────────────────────────────────────────────┐
│ HERRAMIENTAS DISPONIBLES (6)                                │
├─────────────────────────────────────────────────────────────┤
│ 1. stimulate_differentiation (para mutar)                   │
│ 2. scrape_url (para scrapear)                               │
│ 3. extract_links (para extraer links)                       │
│ 4. scrape_metadata (para extraer metadata)                  │
│ 5. extract_images (para extraer imágenes)                   │
│ 6. fetch_api (para peticiones HTTP)                         │
└─────────────────────────────────────────────────────────────┘

Ventajas:
✅ Solo 6 herramientas relevantes (no 50+)
✅ LLM claro (solo opciones de scraping)
✅ Menos tokens gastados
✅ Más rápido
✅ Más barato
```

### Paso 6: LLM Decide Usar Scraping

```
LLM piensa:
"Ahora tengo herramientas de scraping. Voy a usar scrape_url."

Gemini retorna:
{
  "functionCalls": [
    {
      "name": "scrape_url",
      "args": { "url": "https://example.com", "schema": {...} }
    }
  ]
}
```

### Paso 7: Ejecuta Scraping

```
Ejecuta scrape_url → Obtiene datos
```

### Paso 8: LLM Continúa (Ahora Necesita Guardar en BD)

```
LLM piensa:
"Ahora necesito guardar en BD. Tengo 1 opción:
- stimulate_differentiation con type='memory' (BD)

¡Perfecto! Voy a usar memory."

Gemini retorna:
{
  "functionCalls": [
    {
      "name": "stimulate_differentiation",
      "args": { "type": "memory" }
    }
  ]
}
```

### Paso 9: Sistema Muta Nuevamente

```
UnifiedCortex.executeAction("stimulate_differentiation", { type: "memory" })
  ↓
BaseOrchestrator.routeStimulus("memory")
  ↓
BaseOrganisms.stimulate("memory")
  ↓
CellServer.stimulate_differentiation("memory")
  ↓
Cierra: ScraperMolecule, HTTPMolecule
Instancia: SQLiteMolecule
Registra: db_query, db_insert, db_find, db_update, db_delete, create_table
```

### Paso 10: LLM Recibe NUEVAS Herramientas (Solo las de BD)

```
UnifiedCortex.getUnifiedTools() retorna:
[
  {
    name: "stimulate_differentiation",
    description: "...",
    inputSchema: { ... }
  },
  {
    name: "db_query",
    description: "Ejecuta queries en BD",
    inputSchema: { ... }
  },
  {
    name: "db_insert",
    description: "Inserta datos en BD",
    inputSchema: { ... }
  },
  {
    name: "db_find",
    description: "Busca datos en BD",
    inputSchema: { ... }
  },
  {
    name: "db_update",
    description: "Actualiza datos en BD",
    inputSchema: { ... }
  },
  {
    name: "db_delete",
    description: "Elimina datos en BD",
    inputSchema: { ... }
  },
  {
    name: "create_table",
    description: "Crea una tabla en BD",
    inputSchema: { ... }
  }
]

El LLM recibe:
┌─────────────────────────────────────────────────────────────┐
│ HERRAMIENTAS DISPONIBLES (7)                                │
├─────────────────────────────────────────────────────────────┤
│ 1. stimulate_differentiation (para mutar)                   │
│ 2. db_query (para queries)                                  │
│ 3. db_insert (para insertar)                                │
│ 4. db_find (para buscar)                                    │
│ 5. db_update (para actualizar)                              │
│ 6. db_delete (para eliminar)                                │
│ 7. create_table (para crear tablas)                         │
└─────────────────────────────────────────────────────────────┘

Ventajas:
✅ Solo 7 herramientas relevantes (no 50+)
✅ LLM claro (solo opciones de BD)
✅ Menos tokens gastados
✅ Más rápido
✅ Más barato
```

### Paso 11: LLM Decide Usar Inserción

```
LLM piensa:
"Ahora tengo herramientas de BD. Voy a usar db_insert."

Gemini retorna:
{
  "functionCalls": [
    {
      "name": "db_insert",
      "args": { "table": "scraped_data", "data": {...} }
    }
  ]
}
```

### Paso 12: Ejecuta Inserción

```
Ejecuta db_insert → Guarda en BD
```

### Resumen CON BioCore

```
┌─────────────────────────────────────────────────────────────┐
│ FLUJO CON BIOCORE                                           │
├─────────────────────────────────────────────────────────────┤
│ 1. Cargar 1 herramienta (stimulate_differentiation)         │
│ 2. Enviar al LLM                                            │
│ 3. LLM ve 1 herramienta (claro)                             │
│ 4. LLM elige stimulate_differentiation("sensory")           │
│ 5. Sistema muta a sensory                                   │
│ 6. LLM recibe 6 herramientas de scraping                    │
│ 7. LLM elige scrape_url                                     │
│ 8. Ejecuta scrape_url                                       │
│ 9. LLM elige stimulate_differentiation("memory")            │
│ 10. Sistema muta a memory                                   │
│ 11. LLM recibe 7 herramientas de BD                         │
│ 12. LLM elige db_insert                                     │
│ 13. Ejecuta db_insert                                       │
│ 14. Fin                                                     │
│                                                             │
│ Ventajas:                                                   │
│ ✅ 1 herramienta al inicio (no 50+)                         │
│ ✅ Context window optimizado                                │
│ ✅ LLM claro en cada paso                                   │
│ ✅ Menos tokens = más barato                                │
│ ✅ Más rápido                                               │
│ ✅ Escalable (agregar nueva molécula = 30 min)              │
└─────────────────────────────────────────────────────────────┘
```

---

## 📊 Comparación Visual

```
┌─────────────────────────────────────────────────────────────┐
│ SIN BIOCORE                                                 │
├─────────────────────────────────────────────────────────────┤
│ Inicio:     50+ herramientas                                │
│ Paso 1:     50+ herramientas                                │
│ Paso 2:     50+ herramientas                                │
│ Paso 3:     50+ herramientas                                │
│ Fin:        50+ herramientas                                │
│                                                             │
│ Tokens gastados: ALTO                                       │
│ Velocidad: LENTA                                            │
│ Costo: ALTO                                                 │
│ Claridad del LLM: BAJA                                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ CON BIOCORE                                                 │
├─────────────────────────────────────────────────────────────┤
│ Inicio:     1 herramienta                                   │
│ Paso 1:     1 herramienta                                   │
│ Paso 2:     6 herramientas (sensory)                        │
│ Paso 3:     7 herramientas (memory)                         │
│ Fin:        7 herramientas                                  │
│                                                             │
│ Tokens gastados: BAJO                                       │
│ Velocidad: RÁPIDA                                           │
│ Costo: BAJO                                                 │
│ Claridad del LLM: ALTA                                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎯 Resumen de Diferencias

| Aspecto                       | SIN BioCore   | CON BioCore    |
| ----------------------------- | ------------- | -------------- |
| **Herramientas al inicio**    | 50+           | 1              |
| **Herramientas en cada paso** | 50+ (siempre) | 1-7 (dinámico) |
| **Context window**            | Desperdiciado | Optimizado     |
| **Confusión del LLM**         | Alta          | Baja           |
| **Tokens gastados**           | Muchos        | Pocos          |
| **Velocidad**                 | Lenta         | Rápida         |
| **Costo**                     | Alto          | Bajo           |
| **Escalabilidad**             | Difícil       | Fácil          |
| **Mantenibilidad**            | Difícil       | Fácil          |

---

## 💡 La Clave

**SIN BioCore:** El LLM ve todas las herramientas siempre. Es como darle un menú de 50 platos cuando solo necesita 2.

**CON BioCore:** El LLM ve solo las herramientas relevantes en cada momento. Es como darle un menú de 2 platos cuando necesita 2.

**Resultado:** BioCore es más eficiente, más rápido y más barato.

---

## Relaciones

- Cómo el LLM decide qué herramienta usar: [[biocore-llm-decision-flow]]
- Qué recibe el LLM: [[biocore-what-llm-receives]]
- Ciclo de vida de la mutación: [[biocore-mutation-lifecycle]]
- Arquitectura general: [[biocore-architecture]]

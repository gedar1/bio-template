# 📚 Catálogo de Reflexes Atómicos — BioCore

**Versión:** 1.0  
**Fecha:** Octubre 2026  
**Estado:** En producción (101 reflexes en biocore.db)

---

## Introducción

BioCore implementa **reflexes atómicos**: cada reflex representa UNA sola acción (una célula activada, una herramienta ejecutada). Esto permite:

- ✅ Precisión de routing semántico (Jev confidence +15%)
- ✅ Reutilización de componentes sin duplicación
- ✅ Escalada controlada al LLM cuando es necesario
- ✅ Aprendizaje procedural automático (reflexes compuestos generados post-execution)

**Reflexes compuestos** (ej: scraping + guardar en BD) se crean automáticamente DESPUÉS de que el usuario ejecuta una secuencia de 2+ acciones con éxito, no se precarga.

---

## Estructura de un Reflex

```typescript
{
  id: number;                    // ID único en BD
  task_summary: string;          // Descripción clara, única, sin ambigüedad
  sequence: string;              // "mutate:cell->tool"
  success_count: number;         // Veces que se ejecutó exitosamente
  failure_count: number;         // Veces que falló
  created_at: number;            // Timestamp UNIX
  steps_json: object;            // Metadata + user_intents
  embedding: string;             // Vector 384D (multilingüe, local, $0)
}
```

**Ejemplo:**
```json
{
  "id": 77,
  "task_summary": "Guarda un registro en la base de datos",
  "sequence": "mutate:memory->db_insert",
  "success_count": 0,
  "failure_count": 0,
  "created_at": 1729290275,
  "steps_json": {
    "description": "Inserta un nuevo registro en la tabla especificada",
    "user_intents": ["guardalo en la bd", "almacena esto", "inserta en la tabla"],
    "is_atomic": true
  }
}
```

---

## Catálogo por Célula

### 1. MEMORY (Base de Datos SQLite)

| ID | Task Summary | Sequence | Tool | User Intents |
|----|---|---|---|---|
| 50 | Consulta registros de la base de datos | `mutate:memory->db_query` | `db_query` | "busca en la bd", "consulta la tabla", "dame los registros" |
| 51 | Guarda un registro en la base de datos | `mutate:memory->db_insert` | `db_insert` | "guardalo en la bd", "almacena esto", "inserta en la tabla" |
| 52 | Actualiza registros en la base de datos | `mutate:memory->db_update` | `db_update` | "actualiza el registro", "cambia el valor", "modifica en la bd" |
| 53 | Busca un registro específico en la base de datos | `mutate:memory->db_find` | `db_find` | "encuentra este registro", "busca por id", "dame el cliente" |

**Cuándo usar:**
- Usuario menciona: BD, base de datos, tabla, registros, SQL
- No menciona: scraping, archivos, HTTP, emails
- Reflex recomendado: atómico `db_query` o `db_insert`

---

### 2. SENSORY (Web Scraping)

| ID | Task Summary | Sequence | Tool | User Intents |
|----|---|---|---|---|
| 54 | Extrae contenido de una página web | `mutate:sensory->scrape_url` | `scrape_url` | "scrapeá la web", "extrae el contenido", "dame el html", "scrapea esta url" |
| 55 | Extrae todos los links de una página | `mutate:sensory->extract_links` | `extract_links` | "extrae los links", "dame todos los urls", "qué urls hay", "lista de enlaces" |
| 56 | Extrae metadata de una página web | `mutate:sensory->scrape_metadata` | `scrape_metadata` | "extrae metadata", "dame el título", "thumbnail", "open graph" |

**Cuándo usar:**
- Usuario menciona: web, página, URL, scrape, contenido HTML
- No menciona: guardar, API, archivo
- Reflex recomendado: `scrape_url` (más común)

**Nota:** Reflexes como "scrapeá y guardalo en la BD" (ID 2, original) son COMPUESTOS. Jev los evita cuando hay opciones atómicas.

---

### 3. FILESYSTEM (Lectura/Escritura de Archivos)

| ID | Task Summary | Sequence | Tool | User Intents |
|----|---|---|---|---|
| 57 | Lee contenido de un archivo | `mutate:filesystem->read_file` | `read_file` | "lee el archivo", "abre y muestra", "lee el contenido", "muestra el fichero" |
| 58 | Escribe contenido en un archivo | `mutate:filesystem->write_file` | `write_file` | "crea un archivo", "escribe en archivo", "guarda en archivo", "escribí este contenido" |
| 59 | Lista archivos en un directorio | `mutate:filesystem->list_files` | `list_files` | "lista los archivos", "qué archivos hay", "muestra el directorio", "ls el folder" |
| 60 | Copia un archivo | `mutate:filesystem->copy_file` | `copy_file` | "copia este archivo", "duplica el fichero", "haz una copia" |
| 61 | Mueve o renombra un archivo | `mutate:filesystem->move_file` | `move_file` | "mueve el archivo", "renombra el fichero", "mv al destino" |

**Cuándo usar:**
- Usuario menciona: archivo, fichero, directorio, ruta, carpeta, read/write
- Reflex recomendado: `read_file` o `write_file`

---

### 4. HTTP (Peticiones a APIs)

| ID | Task Summary | Sequence | Tool | User Intents |
|----|---|---|---|---|
| 62 | Realiza petición HTTP GET | `mutate:http->http_get` | `http_get` | "llamá a esta api", "consultá el endpoint", "hazme un get", "fetch url" |
| 63 | Realiza petición HTTP POST | `mutate:http->http_post` | `http_post` | "envía estos datos", "hazme un post", "actualiza vía api", "post a endpoint" |
| 64 | Realiza petición HTTP PUT | `mutate:http->http_put` | `http_put` | "actualiza el endpoint", "put estos datos", "reemplaza el recurso" |
| 65 | Descarga archivo de una URL | `mutate:http->http_download` | `http_download` | "descargá este archivo", "baja el fichero", "download url", "bajá el zip" |

**Cuándo usar:**
- Usuario menciona: API, endpoint, HTTP, GET, POST, download, fetch
- Reflex recomendado: `http_get` (consulta), `http_post` (envío), `http_download` (archivos)

---

### 5. COMMUNICATION (Email / WhatsApp)

| ID | Task Summary | Sequence | Tool | User Intents |
|----|---|---|---|---|
| 66 | Envía email vía Gmail | `mutate:communication->send_email` | `send_email` | "envía un email", "manda un correo", "notifica por email", "enviar mensaje" |
| 67 | Envía mensaje por WhatsApp | `mutate:communication->send_whatsapp` | `send_whatsapp` | "envía un whatsapp", "manda un mensaje", "notifica whatsapp" |

**Cuándo usar:**
- Usuario menciona: email, correo, whatsapp, mensaje, notificación
- Reflex recomendado: según medio

---

### 6. VERSIONCONTROL (Git)

| ID | Task Summary | Sequence | Tool | User Intents |
|----|---|---|---|---|
| 68 | Muestra estado del repositorio git | `mutate:versioncontrol->git_status` | `git_status` | "muestra el estado de git", "qué cambios hay", "git status", "cambios pendientes" |
| 69 | Hace commit de cambios en git | `mutate:versioncontrol->git_commit` | `git_commit` | "hazme commit", "guarda los cambios", "commit esto", "crea un commit" |
| 70 | Sube cambios al repositorio remoto | `mutate:versioncontrol->git_push` | `git_push` | "sube a git", "push", "envía los cambios", "publica los cambios" |
| 71 | Baja cambios del repositorio remoto | `mutate:versioncontrol->git_pull` | `git_pull` | "baja los cambios", "pull", "actualiza el repo", "sincroniza" |
| 72 | Crea rama en git | `mutate:versioncontrol->git_branch` | `git_branch` | "crea una rama", "nueva branch", "branch develop" |

**Cuándo usar:**
- Usuario menciona: git, repositorio, commit, push, pull, branch
- Reflex recomendado: `git_commit` (más común), `git_push` (frecuente)

**Nota:** Reflex ID 10-13 (original "haz commit y push...") son COMPUESTOS. Se crean post-execution si usuario hace ambos.

---

### 7. SYSTEM (Comandos CLI)

| ID | Task Summary | Sequence | Tool | User Intents |
|----|---|---|---|---|
| 73 | Obtiene información del sistema | `mutate:system->system_info` | `system_info` | "info del sistema", "cuánta memoria hay", "recursos disponibles", "system info" |
| 74 | Ejecuta comando CLI del sistema | `mutate:system->execute_cli` | `execute_cli` | "ejecuta este comando", "corre npm run", "hazme un ls", "terminal esto" |
| 75 | Verifica si comando está instalado | `mutate:system->check_command` | `check_command` | "verifica si npm está", "tengo instalado node", "existe python" |

**Cuándo usar:**
- Usuario menciona: comando, CLI, terminal, npm, python, recursos
- Reflex recomendado: `system_info` (diagnostics), `execute_cli` (tareas)

---

## Reflexes Originales (Ahora Duplicados/Compuestos)

Los 49 reflexes precargados originales (IDs 1-49) siguen en la BD pero **ya no son preferidos** por Jev:

| Grupo | IDs | Ejemplo | Tipo | Acción |
|---|---|---|---|---|
| Scrape + DB | 1-6 | "scrapea esta URL y guardala en la base de datos" | Compuesto | Marcar como `is_compound=true` (futuro) |
| Git workflow | 10-13 | "haz commit y push de los cambios" | Compuesto | Marcar como `is_compound=true` |
| HTTP + DB | 30-33 | "llama a esta API y guarda la respuesta en la BD" | Compuesto | Marcar como `is_compound=true` |
| Filesystem | 22-29 | "lee el contenido del archivo" | Atómico | Duplicados de ID 57-61 |
| Sistema | 18-21 | "muestra la información del sistema" | Atómico | Duplicados de ID 73 |

**Plan futuro:** Migrar compuestos a columna `is_compound` y usarla en Jev ranking para desdeñarlos cuando haya atómicos.

---

## Flujo de Routing Semántico (Dos Fases)

```
1️⃣ FASE 1: Fast Search (local, sin tokens)
   ├─ Normalizar input: "guardala en la bd"
   ├─ Embeddings local (384D, $0)
   ├─ HNSW search: Top 15 candidatos
   └─ Resultado: candidatos ordenados por similitud coseno

2️⃣ FASE 2: Jev Re-ranking (con tokens)
   ├─ Batch 10 preguntas: "¿Este reflex resuelve la intención?"
   ├─ Jev `noul` scoring: 0-1 para cada reflex
   ├─ Convertir 0-1 → 0-100 confidence
   └─ Top match: ID 77 "Guarda un registro" con 89% confidence

3️⃣ CLASIFICACIÓN de Confiabilidad
   ├─ ≥ 70% → "high" (ejecutar directo, 0 tokens)
   ├─ 50-70% → "medium" (HINT mode: inyectar contexto)
   └─ < 50% → "low" (escalada al LLM, crear reflex nuevo)
```

**Resultados antes vs después:**

| Input | Antes (ID 2) | Después (ID 77) |
|---|---|---|
| "guardala en la bd" | Confidence 74%, compuesto | **Confidence 89%, atómico** ✅ |
| Células | sensory→scrape_url→memory→db_insert | memory→db_insert |
| Precisión | Incluye scraping innecesario | Exacto |

---

## Cómo Crear Reflexes Atómicos (Proceso)

### Paso 1: Identificar la herramienta base
```
¿Qué herramienta ejecuta el usuario?
  → db_insert? → Memory
  → scrape_url? → Sensory
  → send_email? → Communication
```

### Paso 2: Escribir task_summary clara
```
❌ MALO:   "scrapeá y guardalo"              (ambiguo, duplicado)
✅ BUENO:  "Extrae contenido de una página" (preciso, único)
```

### Paso 3: Definir user_intents
```json
{
  "user_intents": [
    "scrapea la web",
    "extrae el contenido",
    "dame el html",
    "scrapea esta url"
  ]
}
```

### Paso 4: Insertar en BD
```bash
python3 scripts/seed-atomic-reflexes.py
```

---

## Integración con Jev

Jev evalúa cada reflex con la pregunta:

> **¿Este reflex resuelve exactamente lo que el usuario pide?**

Para reflex ID 77 ("Guarda un registro en la base de datos"):
- User: "guardala en la bd"
- Jev evaluación: "Sí, 0.89 (89%)"
- Resultado: **Top match con alta confianza**

Para reflex ID 2 (original, compuesto):
- User: "guardala en la bd"
- Jev evaluación: "Probablemente, pero incluye scraping... 0.74 (74%)"
- Resultado: **Penalty por componentes innecesarios**

---

## Métricas de Éxito (Octubre 2026)

| Métrica | Meta | Resultado |
|---------|------|-----------|
| Total reflexes | 100+ | ✅ 101 |
| Reflexes atómicos | 25+ | ✅ 26 |
| Precisión Jev (top match) | +80% confidence | ✅ 89% (fue 74%) |
| Reliability "high" | ≥ 70% | ✅ 89% |
| Sin escalada al LLM | Input "guardala en la bd" | ✅ Ejecuta ID 77 directo |

---

## Próximos Pasos

### Corto Plazo (Noviembre)
- [ ] Testear los 26 reflexes atómicos con Jev en 20+ casos de uso
- [ ] Marcar reflexes originales compuestos con `is_compound=true`
- [ ] Documentar thresholds dinámicos (adaptative threshold 0.80-1.0)

### Mediano Plazo (Diciembre)
- [ ] Generación automática de reflexes compuestos post-execution
- [ ] Temporal decay: penalizar reflexes sin usar > 30 días
- [ ] Reliability boost: +5% confidence si reflex tiene 10+ éxitos

### Largo Plazo (2027)
- [ ] HNSW index para O(log n) en lugar de O(n)
- [ ] Tool extraction: penalizar reflexes con herramientas no mencionadas
- [ ] Multi-language balancing: español = inglés en confianza

---

## Referencias

- **Ubicación BD:** `c:\Users\GermanDarioArbelaez\Documents\project-agent\bio-template\biocore.db`
- **Script seed:** `packages/core/scripts/seed-atomic-reflexes.py`
- **Código routing:** `packages/core/src/server/TenantManager.ts` (métodos: `evaluateSemanticRoute`, `callSemanticRouter`, `fastSearchReflexes`, `jevRerank`)
- **Config tools:** `packages/core/src/config/tools.json`
- **Endpoint:** `POST /api/semantic_route` (requiere `TYPESAFE_API_KEY` para Jev)

---

**Mantenedor:** Equipo BioCore  
**Última actualización:** 2026-10-19  
**Estado:** ✅ En producción

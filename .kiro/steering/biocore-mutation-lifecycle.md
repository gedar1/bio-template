---
inclusion: manual
---

# 🔄 BioCore - Ciclo de Vida de una Mutación

## Diagrama de Estados

```
                    stimulate("sensory")
                          ↓
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ undifferentiated │───→│    sensory        │───→│    memory         │
│                  │    │ ScraperMolecule   │    │ DatabaseMolecule  │
│ Sin moléculas    │    │ HTTPMolecule      │    │                   │
│ Sin herramientas │    │ scrape_url        │    │ db_query          │
│                  │    │ extract_links     │    │ db_insert         │
└──────────────────┘    └──────────────────┘    └──────────────────┘
                              ↑                        ↓
                              │    stimulate("sensory") │
                              └────────────────────────┘
                                stimulate("memory")
```

Cada transición ejecuta el mismo ciclo:

## Pasos de la Mutación

```
1. disposeMolecules()
   → Cierra conexiones abiertas (BD, HTTP, etc.)
   → Libera referencias a moléculas anteriores
   → Limpia herramientas MCP registradas

2. currentType = nuevoTipo
   → Actualiza el estado interno de la célula

3. resolveTools(tipo, registry)
   → Lee registry.json
   → Resuelve herencia (si tiene parent)
   → Retorna lista de herramientas

4. initializeMolecules(tipo)
   → Instancia las moléculas necesarias
   → Cada tipo tiene sus moléculas específicas

5. registerToolsForType(tipo)
   → Registra herramientas MCP en el servidor
   → Cada herramienta tiene name, description, inputSchema

6. Si tiene parent: repite 4 y 5 para el parent
   → Herencia: sensory_advanced hereda de sensory
```

## Qué Moléculas se Instancian por Tipo

| Tipo           | Moléculas                       | Herramientas                                                         |
| -------------- | ------------------------------- | -------------------------------------------------------------------- |
| sensory        | ScraperMolecule, HTTPMolecule   | scrape_url, extract_links, scrape_metadata, fetch_api                |
| memory         | DatabaseMolecule (SQLite)       | db_query, db_insert, db_find, db_update, db_delete, create_table     |
| filesystem     | FileSystemMolecule              | read_file, write_file, delete_file, list_files, copy_file            |
| communication  | GmailMolecule, WhatsAppMolecule | send_email, send_bulk_email, send_whatsapp                           |
| versioncontrol | GitMolecule                     | git_init, git_add, git_commit, git_push, git_status, git_log         |
| http           | HTTPMolecule                    | http_get, http_post, http_put, http_delete, http_download            |
| system         | SystemMolecule                  | execute_cli, run_ffmpeg, run_imagemagick, check_command, system_info |

## Relaciones

- El estímulo que dispara la mutación viene de [[biocore-stimulus-sources]]
- El flujo completo de ejecución está en [[biocore-execution-flow]]
- Cómo el LLM ve las herramientas después de mutar está en [[biocore-what-llm-receives]]
- La comparación de herramientas antes/después está en [[biocore-tools-comparison]]
- Definición de cada componente en [[biocore-glossary]]

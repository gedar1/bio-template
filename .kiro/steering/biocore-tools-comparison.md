---
inclusion: manual
---

# Herramientas cargadas: sin mutación frente a con mutación

## Caso de referencia

Usuario: "Scrapea https://example.com y guarda el título en la base de datos."

## Qué cambia

Sin mutación, todas las herramientas de todas las células permitidas se enviarían al LLM en cada petición. Con mutación, el LLM recibe el tipo activo y dos herramientas de control.

## Cifras del registro

`registry.json` declara 24 nombres de herramienta únicos entre todas sus células. Las herramientas de `monitor` repiten nombres de otras células, así que no suman. `domain-registry.json` agrega sus propias herramientas (`create_record`, `get_record`, `list_records`, `update_record_status`, `delete_record`).

Cantidad de herramientas declaradas por tipo, según `registry.json`:

| Tipo             | Herramientas declaradas                              |
| ---------------- | ---------------------------------------------------- |
| `sensory`        | 3 (`scrape_url`, `extract_links`, `scrape_metadata`) |
| `memory`         | 3 (`db_query`, `db_insert`, `db_find`)               |
| `filesystem`     | 3 (`read_file`, `write_file`, `list_files`)          |
| `communication`  | 2 (`send_email`, `send_whatsapp`)                    |
| `versioncontrol` | 2 (`git_status`, `git_commit`)                       |
| `http`           | 2 (`http_get`, `http_post`)                          |
| `system`         | 3 (`execute_cli`, `check_command`, `system_info`)    |
| `realtime`       | 6 (`ws_*`)                                           |

Una herramienta declarada sin handler registrado no llega al LLM. La cifra anterior es la declarada, no la expuesta en runtime.

## Sin mutación

El LLM recibe 24 herramientas declaradas más `stimulate_differentiation` en cada vuelta del bucle. Entre ellas hay herramientas que se parecen, como `execute_cli` y `http_get`. El modelo debe distinguirlas sin contexto de tarea.

## Con mutación

El LLM recibe `stimulate_differentiation` y las herramientas del tipo activo: entre 2 y 6 según el tipo. Para el caso de referencia, el flujo real es:

1. Si el gate de cadenas detecta `scrape_url→db_insert` con similitud ≥ 0.7, la tarea se resuelve sin LLM, y la lista de herramientas no interviene.
2. Si no la detecta, el LLM ve solo `stimulate_differentiation` y elige `sensory`. Después ve 3 herramientas de scraping y llama a `scrape_url`.
3. Para guardar, el LLM elige `memory`. Después ve 3 herramientas de base de datos y llama a `db_insert`.

El paso 2 y el paso 3 son turnos extra del bucle, cada uno con una llamada al proveedor.

## Compromiso

| Aspecto                         | Sin mutación                        | Con mutación                                                                               |
| ------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------ |
| Herramientas por petición       | 24 declaradas más una               | Una de control y 2 a 6 del tipo activo                                                     |
| Llamadas al proveedor por tarea | Una, si el modelo elige bien        | Una más por cada mutación                                                                  |
| Riesgo principal                | Elegir entre herramientas parecidas | Mutar antes de poder usar la herramienta                                                   |
| Tareas que cruzan tipos         | Una sola lista                      | Requiere mutaciones secuenciales. El gate cubre el caso conocido de `scrape_url→db_insert` |

## Costo

El repositorio no mide el tamaño en tokens de la lista de herramientas. Los logs de Jev reportan entre 550 y 700 tokens de entrada por llamada, pero esa cifra no separa el catálogo de otras partes del prompt. Antes de usar un número de costo para decidir, hay que medirlo con peticiones reales.

## Relaciones

- Cómo decide el LLM: [[biocore-llm-decision-flow]]
- Qué recibe el LLM: [[biocore-what-llm-receives]]
- Ciclo de vida de la mutación: [[biocore-mutation-lifecycle]]
- Arquitectura general: [[biocore-architecture]]

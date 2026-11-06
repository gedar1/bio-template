---
inclusion: manual
---

# 🎯 BioCore - Decisiones Arquitectónicas

## Decisión 1: Metáfora biológica sobre hexagonal

**Contexto:** Se evaluó si usar arquitectura hexagonal formal con Ports & Adapters.

**Decisión:** Mantener la metáfora biológica.

**Razón:** BioCore ya tiene la esencia de hexagonal (interfaces como puertos, moléculas como adaptadores) pero con nombres biológicos que son más intuitivos. Hexagonal formal agregaría ~60 archivos sin valor funcional.

**Relacionado:** [[biocore-architecture]]

---

## Decisión 2: Mutación dinámica sobre carga estática

**Contexto:** La mayoría de frameworks cargan todas las herramientas al inicio.

**Decisión:** Cargar solo `stimulate_differentiation` al inicio y mutar bajo demanda.

**Razón:** Reduce context window del LLM, menos tokens, menos confusión, más barato.

**Relacionado:** [[biocore-tools-comparison]]

---

## Decisión 3: Agnóstico a la fuente del estímulo

**Contexto:** BioCore podría estar acoplado al LLM como fuente única de estímulos.

**Decisión:** `routeStimulus()` acepta `string | IStimulus` de cualquier fuente.

**Razón:** Permite automatizaciones sin LLM (scheduler, webhook, CLI), reduce costos, aumenta flexibilidad.

**Relacionado:** [[biocore-stimulus-sources]]

---

## Decisión 4: IStimulus para trazabilidad

**Contexto:** No había forma de saber de dónde venía un estímulo.

**Decisión:** Agregar interfaz `IStimulus` con `source`, `metadata`, `timestamp`. Retrocompatible con string.

**Razón:** Trazabilidad en logs y métricas sin romper código existente.

**Relacionado:** [[biocore-stimulus-sources]], [[biocore-execution-flow]]

---

## Decisión 5: Comunicación entre organismos (pendiente)

**Contexto:** Los organismos solo se comunican via el orquestador central.

**Decisión:** No implementar comunicación directa entre organismos por ahora.

**Razón:** No hay caso de uso real que lo requiera todavía. Cuando aparezca (ETL masivo, pipelines sin LLM), se agrega `routeSignal()`.

**Relacionado:** [[biocore-architecture]]

---

## Decisión 6: BioCore como motor de automatización

**Contexto:** BioCore se percibía como "framework de LLM".

**Decisión:** Posicionar como motor de automatización con LLM opcional.

**Razón:** El Scheduler, las moléculas y routeStimulus ya soportan automatizaciones sin LLM. El LLM es solo una fuente más de estímulos.

**Relacionado:** [[biocore-stimulus-sources]], [[biocore-glossary#Estímulo (IStimulus)]]

---

## Decisión 7: Jev elige sobre tools.json, no sobre reflexes guardados

**Contexto:** la selección usaba los reflexes de la base como criterios. Con tres reflexes, Jev solo veía tres opciones y no podía proponer cadenas nuevas.

**Decisión:** Jev recibe como criterios las herramientas de `config/tools.json` que pertenecen a las células permitidas del tenant (`config/toolCatalog.ts`). Los reflexes se guardan como historial.

**Razón:** el catálogo real es lo que el tenant puede ejecutar. Un reflex guardado solo refleja lo que ya se hizo.

**Relacionado:** [[biocore-jev-pre-routing]]

---

## Decisión 8: Siguiente paso en una segunda llamada a Jev

**Contexto:** `reflexes_anatomic` y `next_step` iban en paralelo con el mismo estado. `next_step` no conocía el primer paso y repetía `scrape_url` con confianza 0.46.

**Decisión:** dos llamadas secuenciales. La segunda recibe el primer paso como dato y no lo incluye entre las opciones. La opción `ninguno` indica que la tarea termina con el primer paso.

**Razón:** las preguntas independientes no pueden depender una de otra. Una llamada extra por mensaje es el costo aceptado.

**Relacionado:** [[biocore-jev-pre-routing]]

---

## Decisión 9: El gate de cadenas vive en UnifiedCortex

**Contexto:** `CellRouter` descartaba la cadena cuando la secuencia era multi-célula, y `executeDetectedChain` solo se llamaba desde el endpoint de semantic route.

**Decisión:** el gate se evalúa en `UnifiedCortex.runConversation`, después de `queryReflex` y antes del LLM. Por ahora cubre solo `scrape_url→db_insert`.

**Razón:** es el único punto donde el chat tiene la sugerencia de Jev y puede responder sin LLM. Extender el gate a más cadenas se hace una a una, con validación.

**Relacionado:** [[biocore-jev-pre-routing]]

---

## Decisión 10: Pendientes en memoria detrás de una interfaz

**Contexto:** cuando falta la URL, hay que recordar la ejecución hasta la siguiente respuesta del usuario.

**Decisión:** `IPendingChainStore` en `system/strategies/` con una implementación en memoria de 24 horas. `UnifiedCortex` la recibe por opciones.

**Razón:** las pendientes son estado de ejecución, no conversación. Se migrarán a base de datos cuando el historial de ejecuciones se persista, sin tocar el gate.

**Relacionado:** [[biocore-jev-pre-routing]]

---

## Decisión 11: Tabla fija de destino por ahora

**Contexto:** `database_insert` necesita una tabla y el mensaje del usuario no siempre la trae.

**Decisión:** `jev_chain_results` fija para el primer corte. Más adelante la tabla se valida por tarea (por ejemplo, una compra de tomates va a una tabla de stock).

**Razón:** el primer corte valida el flujo, no el modelo de datos del negocio.

**Relacionado:** [[biocore-jev-pre-routing]]

---

## Decisión 12: Sin umbrales de reflex

**Contexto:** los reflexes tenían umbral adaptativo, mínimo de éxitos y un modo `reflex` que ejecutaba la secuencia guardada sin consultar a Jev. Con Jev eligiendo sobre `tools.json`, esos umbrales decidían sobre historial, no sobre la intención del usuario.

**Decisión:** se eliminaron el umbral adaptativo, el mínimo de éxitos, el umbral de similitud para hint, el modo `reflex` y el fallback estructurado. Se conserva la confianza mínima del primer paso de Jev (0.7) como guardia, porque sin ella el gate ejecutaría cadenas con confianza baja.

**Razón:** una sugerencia de Jev no trae pasos reutilizables. Ejecutar por similitud con historial habría repetido una cadena sin confirmar la intención actual.

**Relacionado:** [[biocore-jev-pre-routing]], [[biocore-glossary]]

---

## Decisión 13: Datos del negocio en una base por tenant

**Contexto:** la molécula de memoria del tenant usaba la base compartida (`DATABASE_PATH`), así que los datos del negocio no estaban aislados.

**Decisión:** `db_*` usa `data/tenants/<tenant>.db`. El esquema del negocio lo define el perfil o paquete de dominio y se crea al crear el tenant. Las rutas relativas se resuelven desde la raíz del proyecto.

**Razón:** aislamiento por cliente, y una tabla que no existe no puede responder una pregunta de inventario.

**Relacionado:** [[biocore-architecture]]

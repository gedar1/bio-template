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

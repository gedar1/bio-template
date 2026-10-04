---
inclusion: manual
---

# Lecciones Aprendidas — Errores a Evitar

Fuente completa: #[[file:docs/architecture/LESSONS_LEARNED.md]]

## Reglas críticas

1. **LLM analiza, código ejecuta** — Acciones críticas (alertas, pagos, borrado) nunca dependen de que el LLM elija la herramienta correcta. El código muta y ejecuta de forma determinística.

2. **Monitoreo en dos niveles** — HTTP GET directo sin LLM (99% de checks). Solo escalar al LLM cuando hay error real.

3. **Gemini: historial empieza con `user`** — Filtrar mensajes `system` del historial antes de enviar a Gemini.

4. **Refresh post-mutación** — Después de mutar, recrear el chat de Gemini con herramientas frescas. Sin esto, el LLM sigue viendo solo `stimulate_differentiation`.

5. **Dispose antes de mutar** — `disposeMolecules()` cierra conexiones del perfil anterior. Sin esto: memory leaks.

6. **Funciones puras → atoms** — Si no usa `this` ni tiene efectos secundarios, va en `atoms/`. No como método privado de una clase.

7. **Streaming: tool calls primero, texto después** — Resolver todas las tool calls sin streaming, luego enviar respuesta final por chunks.

8. **Docker: copiar JSON manualmente** — TypeScript no copia archivos JSON al compilar. Copiar `registry.json` explícitamente en Dockerfile.

9. **Registry: usar herencia** — Campo `parent` en registry.json evita duplicar listas de herramientas. `resolveTools()` resuelve recursivamente.

10. **Multi-tenancy: tenants dedicados para alertas** — Usar tenants efímeros para tareas del scheduler, evitar contaminar historial de tenants reales.

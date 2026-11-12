---
inclusion: manual
---

# Lecciones Aprendidas — Errores a Evitar

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

11. **Módulos: no leer `process.env` al cargar.** Los imports se evalúan antes que `dotenv.config()` del punto de entrada. Una constante `ENABLE_EMBEDDINGS = process.env.X` queda con el valor por defecto aunque el `.env` diga otra cosa. Leer dentro de una función (`isEmbeddingsEnabled()`).

12. **`npm start` corre `dist/`.** `tsc --noEmit` valida tipos pero no actualiza `dist/`. Después de cambiar `packages/core/src`, correr `npm run build:ts` antes de probar en el chat. Un cambio que "no hace efecto" casi siempre es un `dist` viejo.

13. **Esquemas de herramientas: el LLM rechaza keywords que el SDK agrega.** Gemini no acepta `$schema` ni `additionalProperties` dentro de `parameters`. `toolSchema` (`.strict()`) rechaza `execution`, que el SDK de MCP agrega a cada herramienta. Limpiar en `deduplicateTools`, `cleanSchemaForLLM` y `formatToolsForGemini`.

14. **Nombres de herramientas: el código manda.** `registry.json` y `tools.json` pueden tener nombres que no existen en código (`scrape_multiple_pages`, `extract_text`, `analyze_page` estaban en el registry sin implementación). Usar `registerTool("nombre", ...)` como fuente. `scripts/validate-template-contract.ts` falla si un nombre de `tools.json` o del registry no está registrado.

15. **Claves foráneas de métricas.** `platform_metrics.tenant_id` referencia `platform_tenants`. Si el tenant no está registrado, cada métrica falla con `FOREIGN KEY constraint failed`, aunque el chat funcione. Registrar el tenant al arrancar. Revisar también el `CHECK` de perfiles antes de usar un perfil nuevo.

16. **Reflex: formatos de secuencia distintos.** Los reflexes guardados usan `->` y Jev usa `→`. Normalizar antes de comparar (`sequenceKey` en `atoms/chainSpec.ts`).

17. **Preguntas paralelas a Jev no se ven entre sí.** Si una pregunta depende de la respuesta de otra, hacer dos llamadas secuenciales. Una pregunta de "siguiente paso" sin el primer paso repite el primero.

18. **Cadena de un solo tipo de célula.** Una célula tiene un solo tipo activo. Una ejecución que usa dos tipos (`sensory` y `memory`) muta entre pasos. Si el perfil no permite un tipo, la mutación se rechaza: revisar `allowedCells` antes de depurar la cadena.

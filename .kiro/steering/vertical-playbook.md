---
inclusion: manual
---

# Playbook para construir una vertical sobre bio-template

Úsalo cuando vayas a crear un producto para una industria (contabilidad, clínicas, flotas, etc.) sobre `bio-template`. Es un proceso de desarrollo. No es el prompt del agente que atiende a los usuarios: ese vive en `domain-agent.md` del perfil.

Este documento describe el proceso. Las reglas de negocio de cada industria las define un experto del negocio, no este playbook. Si una regla no viene del experto, márcala como supuesto.

## Principios

1. **El motor no conoce la industria.** Lo específico vive en el perfil, las células de dominio, las moléculas y el dashboard del vertical. Si una regla de negocio aparece en `packages/core/src/system` o `atoms`, está en el lugar equivocado.
2. **Diseño antes de código.** Un documento corto en `docs/` con entidades, estados, herramientas y guardrails, revisado antes de implementar. Para cambios de varios archivos, esto es obligatorio.
3. **Guardrails en código, no en el prompt.** El LLM puede intentar cualquier herramienta que esté expuesta. La protección real va en el handler, en el validador o en el estado del dato. El prompt ayuda, pero no es una barrera.
4. **Prompt corto.** Cada llamada al LLM paga el prompt, las herramientas y el historial. Las instrucciones precisas van en las descripciones de las herramientas. El prompt del agente se limita a tono, idioma y reglas de negocio que no caben en una herramienta.
5. **Medir antes de optimizar.** Jev y los umbrales se calibran con casos etiquetados, no con intuición. Ver la sección de Jev.

## Fase 0: entrevista de dominio

Antes de tocar código, responde con el experto del negocio:

- **Actores:** quién usa el sistema y qué puede hacer cada uno (cliente, operador, administrador, validador).
- **Entidades:** qué cosas se registran y qué las identifica (un comprobante, un paciente, un vehículo).
- **Estados:** por cada entidad, el ciclo de vida. Ejemplo: `cargado → leído → revisado → aprobado → exportado`. Qué transiciones necesitan una persona.
- **Reglas que no se pueden inferir:** montos, fechas límite, categorías permitidas, qué dato es obligatorio.
- **Datos sensibles:** qué información personal o financiera entra al sistema y si puede salir del servidor (por ejemplo, a un proveedor de IA).
- **Quién valida:** el responsable del negocio que revisa los resultados. Sin esa persona, no hay criterio de aceptación.

Sin estas respuestas no pasas a la fase 1.

## Fase 1: documento de diseño

Un archivo en `docs/` con:
- Entidades y estados (de la fase 0).
- Herramientas propuestas, con nombre, célula y parámetros.
- Qué decide Jev y qué decide código.
- Guardrails por herramienta: qué la bloquea, qué pide confirmación, qué nunca hace.
- Decisiones abiertas, marcadas como tales.

Revísalo con el experto antes de implementar. Registra las decisiones en `docs/DECISIONS-AND-CONFIG.md`.

## Fase 2: modelo de datos

- Una molécula por entidad, o por agregado, con `initialize()` y `dispose()`.
- Tablas con `CREATE TABLE IF NOT EXISTS`. Las migraciones que cambian columnas necesitan respaldo previo. No repitas el error de `ReflexMolecule.runMigration()`, que borra tablas en cada arranque.
- Los estados se modelan como valores válidos en el código y en la base, no como texto libre.
- Nombres de tabla y columna validados con `isSqlIdentifier` si vienen de fuera.

## Fase 3: herramientas

- Cada herramienta pertenece a una célula. Su nombre coincide en el registry, en `tools.json` y en el handler. `validate-template` lo verifica.
- Las descripciones incluyen qué hace, qué no hace y un ejemplo válido. Ejemplo que funcionó: la descripción de `db_query` indica cómo listar tablas y columnas, y eso evitó intentos con `PRAGMA`.
- Esquemas de entrada explícitos. Evita `z.array(z.any())`: el conversor a JSON Schema lo deja sin `items` y el validador de proveedores rechaza la lista de herramientas completa.
- Las herramientas de escritura validan estado antes de actuar. Una factura en `aprobado` no vuelve a `leído` desde el LLM.

## Fase 4: perfil

En `config/` del vertical:
- `allowedCells`: solo las células que el caso necesita. Menos células, menos superficie.
- `chains`: secuencias fijas, sin LLM. Cada paso con su célula, y `requires` solo con extractores disponibles (hoy: `url` y `text`). Si una cadena necesita un documento, primero hay que agregar el extractor.
- `agentFile`: prompt corto.

## Fase 5: guardrails

Para cada herramienta que modifica datos, responde por escrito:
- ¿Qué la puede activar? (el LLM, una cadena, un endpoint).
- ¿Qué valida antes de ejecutar?
- ¿Requiere confirmación humana? Si el dato afecta un reporte o un pago, la respuesta debe ser sí.
- ¿Puede borrar? Si sí, ¿con confirmación explícita y registro?

Los guardrails se prueban con casos negativos: intentos de borrar, de escribir fuera de estado, de leer otro tenant. No basta con probar el caso feliz.

## Fase 6: Jev y el LLM

- **Jev elige** la herramienta o la célula. Nunca ejecuta por sí mismo.
- **Siempre debe existir una salida de "ninguna"** en las preguntas de selección. Sin ella, Jev elige alguna herramienta aunque la solicitud esté fuera de alcance. Lo vimos con preguntas sobre el clima.
- **Los umbrales se calibran** con 30 casos etiquetados por el experto: acción esperada por mensaje. Con 6 casos no hay calibración.
- **Caso borde** (Noul) separó bien las preguntas complejas en nuestras pruebas. La claridad (Score) indica datos faltantes, pero no alcance: una pregunta fuera de dominio puede tener claridad alta.
- **Lectura de valores abiertos** (montos, NIT, fechas) no se resuelve con Jev. Jev sirve cuando las opciones son finitas. Para valores abiertos hace falta OCR o un modelo de visión, y después Jev puede validar el resultado.
- **Documentos e imágenes**: revisar primero la política de datos del proveedor y los límites de tamaño. Antes de construir, valida con un caso real.

## Fase 7: dashboard

- Cada perfil declara sus secciones. Hoy el dashboard solo tiene el perfil `domain`, así que este punto es una brecha: hay que definir cómo registra un vertical sus paneles antes de construir la UI.
- Los paneles técnicos (circuit breakers, logs, reflexes) se muestran solo a plataforma.
- El panel del vertical consume las rutas del propio tenant, con el rol mínimo que corresponda.

## Fase 8: validación

Antes de cada entrega, en este orden:
1. `npx tsc --noEmit` en core y en dashboard.
2. `npm run validate-template`.
3. Tests de core, incluidos los de los guardrails del vertical.
4. Un smoke test de cadenas con puerto simulado.
5. Una prueba en vivo con backend levantado, con un tenant de prueba y una base temporal (`DATABASE_PATH` y `DATABASE_DIR` apuntando fuera de `data/`).

Si una prueba en vivo se hace con base temporal, bórrala al terminar.

## Fase 9: entrega

- Ramas: `feature/*` hacia `develop`, luego `pre-prod` y `main`. Ver el flujo de PR.
- Tag en `main` por cada despliegue (`vMAYOR.MENOR.PARCHE`), con `package.json` actualizado en el mismo PR.
- Después de un hotfix en `main`, sincroniza hacia `pre-prod` y `develop`.

## Lista de verificación

- [ ] Entrevista de dominio con el experto, con actores, entidades, estados y reglas.
- [ ] Documento de diseño en `docs/`, revisado.
- [ ] Decisiones registradas en `DECISIONS-AND-CONFIG.md`.
- [ ] Moléculas con estados válidos y migraciones con respaldo.
- [ ] Herramientas con nombre consistente, descripciones con ejemplos y esquemas explícitos.
- [ ] Perfil con células mínimas, cadenas declaradas y prompt corto.
- [ ] Guardrails en código, con pruebas negativas.
- [ ] Jev con salida de "ninguna" y umbrales calibrados con casos etiquetados.
- [ ] Dashboard con secciones del vertical, sin paneles técnicos para tenants.
- [ ] Validaciones de la fase 8 en limpio.
- [ ] Ramas y tag según el flujo de entrega.

## Referencias en este repositorio

- `biocore-create-cell.md`, `biocore-create-molecule.md`, `biocore-create-profile.md`: cómo agregar piezas al motor.
- `biocore-execution-flow.md` y `biocore-jev-pre-routing.md`: cómo se ejecuta un mensaje.
- `biocore-boundaries.md`: qué puede importar cada capa.
- `biocore-testing-validation.md`: cómo probar.
- `docs/ARQUITECTURA-Y-PLAN.md`: pendientes del motor.
- `docs/DECISIONS-AND-CONFIG.md`: decisiones tomadas.

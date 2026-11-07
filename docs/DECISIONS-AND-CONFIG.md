# Decisiones y configuración de bio-template

Este documento registra las decisiones de arquitectura tomadas hasta ahora, cómo se configura el template para cada negocio y qué queda pendiente. Está pensado para que cualquiera que clone el template entienda por qué está como está.

Última actualización: flujo de cadenas con Jev sobre `tools.json` y gate `scrape_url→db_insert` verificado en el chat, registro del tenant `default` y migración de `platform_tenants`, `ENABLE_EMBEDDINGS` leído en tiempo de ejecución, y limpieza de exports internos.

---

## 1. Qué es bio-template

Un template base para desplegar un motor de automatización con herramientas dinámicas (BioCore). Se usa de dos formas:

- **Como upstream:** el núcleo (`packages/core`) y el dashboard (`packages/dashboard`) se mantienen en un solo lugar.
- **Como base de cada negocio:** cada negocio es un despliegue propio, creado a partir del template, que cambia solo configuración y, si hace falta, un paquete vertical de dominio.

No se bifurca el código por negocio. Las correcciones del núcleo se traen al despliegue de cada negocio con un `pull` del upstream.

---

## 2. Vocabulario

| Término                       | Significado                                                                                                                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plataforma**                | Tú, como dueño del template. Administra cuentas y registros de clientes cuando el despliegue está en modo `studio`.                                                                                                         |
| **Estudio**                   | La cuenta del negocio que administra clientes. Ejemplo: el estudio contable de un amigo. Es el dueño de sus credenciales.                                                                                                   |
| **Roles**                     | `platform_owner` (opera el despliegue), `studio_admin` (contador, previsto), `tenant_owner` (dueño de un negocio cliente), `operator` y `viewer` (personal y consulta dentro de un tenant). Son nombres de rol, no de modo. |
| **Tenant (cliente)**          | Unidad de negocio con datos aislados: su propia BD, su chat y su historial. En un restaurante con un solo local, el tenant es el propio restaurante.                                                                        |
| **Perfil (`TENANT_PROFILE`)** | Define herramientas, tablas y el agente `.md` de una industria (`restaurant`, `dev`, etc.).                                                                                                                                 |
| **Modo (`DEPLOYMENT_MODE`)**  | `studio` (varios clientes gestionados desde plataforma) o `single` (un solo negocio).                                                                                                                                       |

Nota: los roles se renombraron en el código. `super_admin` pasó a `platform_owner` y el `admin` de tenant pasó a `tenant_owner`. El rol del contador (`studio_admin`) todavía no está implementado. Ver `AUTH-Y-API-KEYS.md`.

---

## 3. Decisiones tomadas

### 3.1 Un solo código base con configuración por despliegue

**Decisión:** no crear forks ni eliminar código multi-tenant por negocio. Cada negocio se configura con variables de entorno y un paquete vertical opcional.

**Motivo:** un fork por negocio duplica las correcciones de seguridad y de bugs. Con un solo código base, una corrección se aplica una vez.

**Alternativa descartada:** borrar la parte multi-tenant de cada clon. Se descartó por el motivo anterior.

### 3.2 Modo de despliegue `DEPLOYMENT_MODE`

- Valores: `studio` (por defecto) y `single`.
- En `single`, la API de plataforma (`isPlatformEnabled()`) queda deshabilitada aunque exista `PLATFORM_SECRET`. Las rutas `platform/*` responden 503.
- En el dashboard, la pestaña **Platform** se oculta.
- El aislamiento de datos y la autenticación siguen activos en ambos modos.
- Por defecto es `studio`, así el comportamiento existente no cambia.

Archivos: `packages/core/src/config/deploymentMode.ts`, `packages/core/src/server/middleware/platformAuth.ts`, `packages/dashboard/src/utils/deploymentMode.ts`, `packages/dashboard/src/components/SectionNav/index.tsx`.

### 3.3 Historial de chat privado

**Decisión:** el historial de conversación solo se entrega con un JWT de tenant. El admin **no** puede leer la conversación de un cliente.

**Motivo:** las preguntas de un cliente pueden revelar su intención y su información. Es privada por diseño.

**Cambio:** en `DashboardRoutes.ts`, la ruta `history` ya no toma `body.tenantId` ni acepta tokens de plataforma o `API_SECRET`. Responde `ACCESS_DENIED`.

### 3.4 Datos de negocio visibles para el admin (pendiente)

**Decisión:** el admin del estudio sí ve los datos de negocio de sus clientes (gastos, facturas, pedidos). Lo que no ve es la conversación.

**Requisito previo, no implementado:** cada tenant necesita un `ownerId` (cuenta del estudio) en el registro. Sin eso, el sistema no puede verificar que un admin es dueño de un cliente.

### 3.5 Chat de ejecuciones (dashboard)

- Chat en `components/ExecutionChat`, montado dentro de `WorkspaceShell` (esquina inferior derecha).
- Hoy usa datos **mock** (`mockExecution.ts`). Los tiempos mínimos por etapa son el perceived delay; son valores de prueba.
- El estado se calcula con un reducer puro (`executionReducer.ts`). Al conectar el backend solo cambia la fuente de eventos.
- Los textos son de lenguaje de negocio. Los nombres técnicos de herramientas se traducen en `toolLabels.ts`.
- Los spinners SVG se muestran con `Spinner` usando el SVG como máscara, para que tomen el color de Tailwind. Como `<img>`, el `fill="currentColor"` se veía negro.

### 3.6 Cadenas de herramientas: Jev elige, el código ejecuta

**Decisión:** Jev elige la cadena sobre las herramientas de `tools.json` que pertenecen a las células permitidas del tenant (`config/toolCatalog.ts`). Los reflexes guardados ya no son criterios de selección.

- Jev hace dos llamadas secuenciales: primer paso sobre el catálogo completo, y luego siguiente paso con el primero como dato y sin repetirlo. Las preguntas no pueden ir en paralelo, porque `next_step` depende de `first_step`.
- Una sugerencia de Jev nunca se ejecuta en modo `reflex`: no trae pasos. Solo sirve como pista o para el gate `scrape_url→db_insert`.
- El gate pide la URL cuando falta, guarda la ejecución pendiente 24 horas y ejecuta sin LLM. El detalle está en `.kiro/steering/biocore-jev-pre-routing.md`.
- Los reflexes se siguen guardando como historial en `data/biocore.db`, solo con la secuencia de herramientas y sin el texto del usuario en claro.

**Motivo:** con los reflexes como criterios, Jev veía tres opciones y no podía elegir una cadena nueva. Con `tools.json` ve el catálogo real del tenant.

**Nombres:** `tools.json` solo contiene herramientas registradas en código. Se valida con `scripts/validate-template-contract.ts`. Los nombres de la célula son los que Jev recibe (`db_insert`, no `database_insert`).

### 3.7 SQLite para el volumen previsto

**Decisión:** SQLite con un archivo por tenant y WAL. Suficiente para un estudio con decenas de clientes.

**Cuándo cambiar a Postgres:** varias instancias del backend escribiendo a la misma BD, o despliegues en varias máquinas. Por eso el acceso a cada tenant debe ir detrás de un repositorio.

### 3.8 Separación frontend / backend

**Decisión:** no separar en servicios por ahora. Los paquetes ya están separados en código (`core`, `dashboard`), y el frontend solo consume HTTP.

**Cuándo separar:** cuando se necesite servir el dashboard desde CDN, cuando un equipo distinto mantenga la UI, o cuando haga falta más de una instancia del backend para el mismo estudio.

### 3.9 Una instancia por estudio o por negocio

Cada estudio o negocio es un despliegue completo del template. Así el aislamiento entre estudios es total y el admin no necesita gestionar propietarios dentro de una misma instancia.

### 3.10 Bases de datos: compartida y una por tenant

Hay dos tipos de base, y cada dato va en una sola:

| Base           | Archivo                                             | Contenido                                                                                                                                       |
| -------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Compartida** | `data/biocore.db` (`DATABASE_PATH`)                 | Plataforma: `platform_tenants`, `platform_metrics`, `platform_alerts`, `platform_audit`. Reflexes (historial de cadenas). Estado de plantillas. |
| **Por tenant** | `data/tenants/<tenant>.db` (`DATABASE_DIR/tenants`) | Datos del negocio: inventario, pedidos, `jev_chain_results` y cualquier tabla que use `db_insert`, `db_query` o `db_find`.                      |

**Decisión:** la molécula de memoria del tenant (`db_*`) usa la base del tenant, pasada por `CellServer` como `context.tenantDbPath`. Antes usaba `DATABASE_PATH`, así que los datos del negocio quedaban en la compartida.

**Esquema del negocio:**

- Lo define el perfil o el paquete del dominio, en un `initialize()` idempotente (`CREATE TABLE IF NOT EXISTS`), como ya hace `ExampleMolecule`.
- Se crea al crear el tenant, no en la primera pregunta. Una tabla que no existe no puede responder.
- Ejemplo para un restaurante: `inventory(item, quantity, unit, updated_at)`.
- Jev elige herramientas de dominio (por ejemplo `inventory_stock(item)`), no tablas. Las herramientas genéricas `db_*` reciben la tabla de quien pregunta y no son el camino del negocio.
- Si la tabla está vacía, la respuesta dice que no hay registros. No inventa cantidades.
- Pendiente: las herramientas de dominio aún no están en el catálogo de Jev.

**Rutas:** las rutas relativas de `DATABASE_PATH` y `DATABASE_DIR` se resuelven desde la raíz del proyecto (`resolveDataPath` en `atoms/paths.ts`), no desde el directorio de trabajo del proceso. Antes, un proceso lanzado desde `packages/core` creaba su propio `data/`. Se eliminó esa copia sobrante.

### 3.11 Reflexes: sin umbrales de modo

**Decisión:** se eliminaron los umbrales de reflex: el adaptativo, el mínimo de éxitos (`MIN_SUCCESS_COUNT`), el umbral de similitud para hint y el modo `reflex`. También se eliminó el fallback estructurado (`selectReflex`, `selectStructuredFallback`) y el margen de ambigüedad.

**Qué se conserva:**

- La confianza mínima del primer paso de Jev (`REFLEX_SELECTION_THRESHOLD = 0.7`). Es una guardia: sin ella, el gate ejecutaría cadenas con confianza baja.
- El umbral del gate `scrape_url→db_insert` (`CHAIN_MIN_SIMILARITY = 0.7`).
- El conteo de éxito en la tabla `reflexes`, como historial. Ya no decide nada.

**Retirado después:** `executeReflex` con sus versiones de esquema, el índice vectorial, los embeddings y las dependencias `@xenova/transformers` y `hnswlib-node`. La columna `embedding` de `reflexes` queda vacía, por compatibilidad con la tabla existente.

---

## 4. Configuración

### 4.1 Variables de entorno del backend (`.env` en la raíz)

Se copian desde `.env.example`. Nunca se versiona el `.env` real.

| Variable            | Valor por defecto        | Para qué                                                       |
| ------------------- | ------------------------ | -------------------------------------------------------------- |
| `DEPLOYMENT_MODE`   | `studio`                 | `studio` o `single`. Ver 3.2.                                  |
| `TENANT_PROFILE`    | `domain` (en el example) | Perfil de industria del despliegue.                            |
| `PLATFORM_SECRET`   | vacío                    | Activa la API de plataforma (solo en modo `studio`).           |
| `TYPESAFE_API_KEY`  | vacío                    | Jev. Sin ella, el pre-routing y el guardrail se degradan.      |
| `GOOGLE_API_KEY`    | —                        | Gemini (proveedor primario).                                   |
| `ANTHROPIC_API_KEY` | —                        | Claude (fallback).                                             |
| `NVIDIA_API_KEY`    | vacío                    | NVIDIA NIM (fallback).                                         |
| `LLM_PROVIDER`      | `unified`                | Proveedor inicial.                                             |
| `DATABASE_TYPE`     | `sqlite`                 | Tipo de base de datos.                                         |
| `DATABASE_PATH`     | `./biocore.db`           | BD compartida. Se recomienda `./data/biocore.db`.              |
| `DATABASE_DIR`      | `./data`                 | Directorio de BDs por tenant.                                  |
| `ENABLE_EMBEDDINGS` | `true`                   | Obsoleta: ya no tiene efecto. La búsqueda semántica se retiró. |
| `PORT`              | `3000`                   | Puerto del backend.                                            |
| `API_SECRET`        | vacío                    | Vacío = sin autenticación (solo desarrollo).                   |

### 4.2 Variables del dashboard (`packages/dashboard/.env`)

| Variable               | Valor               | Para qué                                                       |
| ---------------------- | ------------------- | -------------------------------------------------------------- |
| `VITE_DEPLOYMENT_MODE` | `studio` o `single` | Debe coincidir con `DEPLOYMENT_MODE`. Se define en build time. |

### 4.3 Pasos para crear un despliegue nuevo

1. Copiar el template a una carpeta nueva o crear un repositorio a partir de él.
2. Copiar `.env.example` a `.env` y llenar las claves.
3. Definir `DEPLOYMENT_MODE` y `TENANT_PROFILE`.
4. Copiar `packages/dashboard/.env.example` a `packages/dashboard/.env` y definir `VITE_DEPLOYMENT_MODE` con el mismo valor.
5. Si el negocio necesita reglas propias (pedidos, citas), agregar un paquete vertical como `packages/restaurant`, sin modificar el núcleo.
6. Verificar: `npm run build` en `packages/core` y en `packages/dashboard`, y `npm test` en `packages/core`.
7. Para traer mejoras del núcleo, hacer `pull` del upstream.

### 4.4 Reglas de configuración

- Las credenciales van solo en `.env`, nunca en el código ni en el repositorio.
- La configuración de negocio (perfil, marca, modo) va en variables, no en ramas.
- Cambiar `DEPLOYMENT_MODE` requiere reiniciar el backend y reconstruir el dashboard.

---

## 5. Pendiente

Ordenado por prioridad:

1. **Cerrar rutas de datos por tenant.** Aplicar la misma regla que `history` a `chat`, `tools`, `perf`, `mutations`, `reflex`, `tenant-profile`, `orders/*` e `inventory/alerts`. Para datos de negocio, permitir también el JWT del admin dueño del tenant cuando exista `ownerId`.
2. **Cerrar rutas de plataforma.** `tenants` lista todos los clientes sin autenticación. `template/execute` ejecuta pasos desde el cuerpo sin validación visible. `logs` y `logs/stream` no tienen control por tenant. Deben quedar solo para super admin.
3. **Revisar `SchedulerRoutes`.** Usa el mismo `resolveTenantId` con fallback al cuerpo.
4. **Agregar `ownerId` al registro de tenants** para el modelo estudio → clientes.
5. **Gestión de credenciales por estudio.** Claves de LLM, Jev, Gmail y WhatsApp guardadas cifradas, con clave maestra `BIOCORE_SECRET_KEY`. Mostrar solo los últimos 4 caracteres. Override opcional por tenant.
6. **Panel de negocio por perfil dentro de `WorkspaceShell`.** Registro de perfiles (`perfil → paneles y etiquetas`) que reemplace el `switch` de `DomainWidgets`.
7. **Streaming en el chat.** El chat de ejecuciones ya usa `POST /api/chat`. `POST /api/chat/stream` no pasa por el gate de cadenas, así que una ejecución por streaming no pide la URL.
8. **Quitar el overlay temporal.** `WorkspaceShell` ya está montado en `App.tsx`; falta integrarlo al layout real.

---

## 6. Deuda técnica y riesgos conocidos

- **`ReflexMolecule.runMigration()` borra `reflexes_atomic` y `reflex_dependencies` en cada arranque**, sin respaldo. Es correcto mientras esas tablas estén vacías u obsoletas, pero debería retirarse una vez confirmado el estado de todas las BDs.
- **`data/biocore.db`** se copió desde la raíz. Confirmar que el archivo de la raíz ya no se usa antes de borrarlo.
- **Lint:** `SectionNav/index.tsx` exporta constantes junto al componente y genera 3 errores de `react-refresh/only-export-components`. Vienen del código original. Mover las constantes a un archivo aparte.
- **Ruta semántica retirada.** `POST /api/platform/semantic_route`, `TenantManager.evaluateSemanticRoute` y su pipeline de ranking se eliminaron. Con ellos se fueron la herramienta `execute_detected_chain`, `ReflexOrchestrator` y `types/semantic.ts`. El chat no cambió: sigue usando el gate de `UnifiedCortex`.
- **Perfiles de plataforma.** El template solo tiene el perfil `domain`. Se retiraron `dev`, `restaurant`, `clinic` y `ecommerce` del esquema, de los tipos del dashboard y de las rutas de plantillas y agentes. Los endpoints de restaurante de `DashboardRoutes` eran stubs que devolvían listas vacías, y también se retiraron. Los casos de uso futuros deben agregar su perfil y sus widgets. Las instalaciones existentes conservan en `platform_tenants` el `CHECK` anterior, que acepta esos valores; no se migró la tabla.
- **Seed de reflexes retirado.** `reflexSeed.ts` insertaba flujos sintéticos en el historial. Se retiró el seed del arranque y la columna `arg_templates_json` de `reflexes`; la base se respaldó antes de eliminarla.
- **`dist/system/pendingChainStore.*`** quedó de la ubicación anterior del store. Se elimina al limpiar `dist`.
- **Limpieza de código sin uso.** `knip` está configurado en `packages/core/knip.json`. Quedan exports sin uso (grupo A) y `PersistentHistory.ts` pendientes de decisión. `@opentelemetry/sdk-trace-base` está declarado pero no se importa directamente.

---

## 7. Qué está verificado y qué no

**Verificado por build, tests o lint:**

- Core compila y los 88 tests pasan tras cada cambio de backend.
- Dashboard compila (`tsc -b` y `vite build`).
- Cierre de `history` y modo `single` compilan y no rompen tests existentes.

**No verificado:**

- Comportamiento en navegador de los componentes del chat y del modo `single`.
- Respuesta real de la ruta `history` contra un servidor levantado.
- Que el selector de tenants se oculte en modo `single`.
- Ruta de streaming (`/api/chat/stream`) con el flujo de cadenas.
- Gemini: la API key configurada no es válida, así que las respuestas libres del LLM no se probaron.

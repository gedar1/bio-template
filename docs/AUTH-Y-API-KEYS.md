# Autenticación, roles y API keys

Este documento describe qué credencial usa cada rol, dónde se genera, dónde se guarda y qué puede hacer. Refleja el código tal como está hoy. Donde el estado actual no cumple lo que debería, lo marco explícitamente en la sección 6.

Última actualización: tras abrir la compuerta global a JWT válidos y añadir el control de acceso por ruta (`requestAccess.ts`).

---

## 1. Resumen

Hay cuatro tipos de credencial. Cada una tiene un ámbito distinto:

| Credencial        | Quién la usa                                         | Ámbito                                                                 | Se genera con                    |
| ----------------- | ---------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------- |
| `PLATFORM_SECRET` | Tú, dueño del template                               | Plataforma completa                                                    | Variable de entorno del backend  |
| JWT de plataforma | Tú, en el panel de plataforma                        | Todas las rutas, todos los tenants                                     | Login con `PLATFORM_SECRET`      |
| `API_SECRET`      | Servidor, integraciones y el dashboard en modo admin | Todas las rutas. Requiere `tenantId` en el cuerpo para datos de tenant | Variable de entorno del backend  |
| API key de tenant | Un cliente o una cuenta que administra un tenant     | Solo su tenant, y solo en las rutas de datos del tenant                | Plataforma, con `regenerate-key` |
| JWT de tenant     | Lo obtiene quien tiene la API key de tenant          | Solo su tenant                                                         | Login con la API key de tenant   |

Las claves de LLM y de Jev no son de rol: son del despliegue. Se describen en la sección 4.

---

## 2. Roles

### 2.1 Super admin (plataforma)

- **Quién:** tú, como dueño del template.
- **Credencial:** `PLATFORM_SECRET` en el `.env` del backend. Con ella se obtiene un JWT de plataforma con `role: platform_owner`, válido 24 horas.
- **Qué puede:** todas las rutas `platform/*`, listar tenants, métricas de cualquier tenant, logs y las rutas de datos de cualquier tenant pasando `tenantId`.
- **Cómo entra:** `POST /api/platform/auth/login` con `{ "secret": "<PLATFORM_SECRET>" }`.
- **Deshabilitado en modo `single`:** no existe la API de plataforma.

### 2.2 Admin del despliegue (API_SECRET)

- **Quién:** el operador del servidor o el dashboard cuando se usa como administrador técnico.
- **Credencial:** `API_SECRET` en el `.env` del backend. Se envía como `Authorization: Bearer <API_SECRET>`, o como `?apiKey=` para SSE.
- **Qué puede:** igual que el super admin en las rutas de datos, pero el tenant lo indica el cliente en el cuerpo (`tenantId`). No tiene nombre de usuario: todo quien tenga la clave es el mismo actor.
- **Recomendación:** úsalo para operación del servidor, no como clave de usuario final.

### 2.3 Dueño del tenant (`tenant_owner`)

- **Quién:** el dueño de un negocio cliente. En un restaurante con un solo local, es el dueño del restaurante. En contabilidad, es el dueño de la empresa cliente del contador.
- **Ejemplos:** el dueño de una ferretería que aprueba pagos e invita a su personal; el dueño de un restaurante que cambia precios y gestiona al equipo.
- **Credencial:** API key de tenant (ver sección 3). Con ella el login emite un JWT con `role: "tenant_owner"`.
- **Qué puede:** las rutas del propio tenant: `chat`, `history`, `tools`, `perf`, `mutations`, `reflex`, `tenant-profile`, `orders/*`, `inventory/alerts`, `template/execute`.
- **Qué no puede:** otros tenants, `tenants`, `logs`, `monitor/*`, `registry`, `circuit-breaker`, ni ninguna ruta `platform/*`.

### 2.4 Operador y viewer de tenant

- **Quién:** personal del negocio con menos permisos. Por ejemplo, el asistente del contador o un cajero.
- **Credencial:** la misma API key de tenant, con `role: "operator"` o `role: "viewer"` en el login.
- **Qué puede:** las mismas rutas del tenant que el admin.
- **Estado:** la restricción por rol **no está implementada en el servidor** (ver sección 6). Hoy el rol solo condiciona la interfaz del dashboard.

### 2.5 Cliente final

- **Quién:** la persona que usa el chat del negocio (por ejemplo, el cliente del contador que pregunta por sus gastos).
- **Credencial:** la API key de su tenant, o un JWT de tenant entregado por el admin del tenant.
- **Qué puede:** solo el chat y el historial de su tenant. El historial es privado: solo lo recibe quien tiene JWT de ese tenant.

### 2.6 Estudio (cuenta que agrupa clientes)

- **Rol previsto:** `studio_admin`. Es el contador que administra a todos sus clientes: ve su contabilidad y gestiona sus tenants, pero no opera la infraestructura.
- **Estado:** no implementado, y no se implementará por ahora. Con un despliegue por estudio, el contador es `platform_owner` de su propia instancia. Lo que ve de negocio (sus clientes, la contabilidad consolidada) lo define el perfil del negocio, no el rol.
- **Criterio para implementarlo:** cuando ocurra una de estas situaciones:
  1. Otra persona opera la infraestructura de la instancia y el contador no debe tener acceso técnico.
  2. Varios estudios comparten una misma instancia, y hace falta `ownerId` para aislarlos.
  3. Entra personal del estudio con acceso solo de negocio.
- **Nota:** ocultar un panel en el dashboard no quita el permiso. El control real está en el servidor.
- **Mientras tanto**, un contador con varios clientes puede usar:
  - el JWT de plataforma, si tú le das acceso (ve todos los tenants), o
  - una API key de tenant por cada cliente (un login por cliente).
- **Cuando exista `ownerId`:** el contador tendrá su propia credencial y verá solo sus tenants.

---

## 3. Flujo de API keys de tenant

1. **Generar:** el super admin ejecuta `POST /api/platform/tenants` (crea el tenant y devuelve la clave) o `POST /api/platform/tenants/regenerate-key` (rota la clave). Ambas aceptan `api_key_role` (`viewer`, `operator` o `tenant_owner`; por defecto `tenant_owner`), que es el **rol máximo** de esa clave. La clave se muestra **una sola vez**.
2. **Guardar:** el servidor guarda solo el hash (scrypt) en `platform_tenants.api_key_hash`. La clave en claro no se puede recuperar.
3. **Entregar:** la clave se entrega al admin del tenant por un canal seguro. Nunca por el repositorio ni por un chat.
4. **Login:** `POST /api/tenant/auth/login` con `{ "api_key": "..." }` y opcionalmente `"role"`. El rol efectivo es el menor entre el pedido y el máximo de la clave; sin `role`, se usa el máximo. La respuesta incluye `role` con el valor otorgado. Pedir más de lo permitido no falla: se otorga el máximo y se deja un aviso en el log.
5. **Rotar:** `regenerate-key` invalida la clave anterior. Si la clave se filtra, rótala de inmediato.

Un tenant inactivo (`status = inactive`) no puede iniciar sesión.

---

## 4. Dónde va cada credencial

### 4.1 Backend (`.env` en la raíz, nunca en el repositorio)

| Variable            | Qué es                         | Quién la lee                                 |
| ------------------- | ------------------------------ | -------------------------------------------- |
| `PLATFORM_SECRET`   | Secreto de login de plataforma | `platformAuth.ts`                            |
| `API_SECRET`        | Clave de servidor              | `apiAuth.ts`, `tenantAuth.ts`                |
| `TYPESAFE_API_KEY`  | Jev                            | Varios módulos de `atoms/` y `TenantManager` |
| `GOOGLE_API_KEY`    | Gemini                         | `llmConfig.ts`                               |
| `ANTHROPIC_API_KEY` | Claude                         | `llmConfig.ts`                               |
| `NVIDIA_API_KEY`    | NVIDIA NIM                     | `llmConfig.ts`                               |
| `DEPLOYMENT_MODE`   | `studio` o `single`            | `deploymentMode.ts`                          |
| `TENANT_ID`         | Tenant único en `single`       | `deploymentMode.ts`                          |

### 4.2 Base de datos

- Las API keys de tenant **no** se guardan en `.env`. Viven en `platform_tenants.api_key_hash`, como hash.
- Las credenciales de LLM por estudio o por tenant **todavía no existen**. Hoy todas son globales del despliegue.

### 4.3 Dashboard (`packages/dashboard/.env` y navegador)

| Dónde                                                       | Qué guarda                                                 | Notas                                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| `VITE_DEPLOYMENT_MODE`, `VITE_TENANT_ID`, `VITE_BRAND_NAME` | Configuración visual                                       | Son públicas: quedan dentro del bundle.                           |
| `localStorage["biocore-api-key"]`                           | `API_SECRET` cuando el dashboard se usa como admin técnico | Se envía como `Bearer`.                                           |
| `sessionStorage["biocore_tenant_jwt"]`                      | JWT de tenant                                              | Lo usa `RoleContext` para el rol. Se pierde al cerrar la pestaña. |

**Regla:** nunca pongas secretos en variables `VITE_*`. Se incluyen en el JavaScript que descarga el navegador.

---

## 5. Qué ve cada credencial en cada ruta

| Ruta                                               | Sin credencial | API key de tenant / JWT de tenant | `API_SECRET`      | JWT de plataforma |
| -------------------------------------------------- | -------------- | --------------------------------- | ----------------- | ----------------- |
| `chat`, `history`                                  | Denegado       | Su tenant                         | Tenant del cuerpo | Tenant del cuerpo |
| `template/execute`                                 | Denegado       | Su tenant                         | Tenant del cuerpo | Tenant del cuerpo |
| `tools`, `perf`, `mutations`, `reflex`, `orders/*` | Denegado (401) | Su tenant                         | Tenant del cuerpo | Tenant del cuerpo |
| `tenants`                                          | Denegado       | Denegado                          | Permitido         | Permitido         |
| `logs`                                             | Denegado       | Denegado                          | Permitido         | Permitido         |
| `monitor/*`, `registry`, `circuit-breaker`         | Denegado (401) | Denegado                          | Permitido         | Permitido         |
| `platform/*`                                       | Denegado       | Denegado                          | Según la ruta     | Permitido         |

"Denegado (401)" significa que la compuerta global rechaza la petición antes de llegar a la ruta. "Denegado" sin código significa que la ruta responde `ACCESS_DENIED`.

Cuando `API_SECRET` no está configurado, el sistema está abierto en desarrollo: todas las rutas responden sin credencial. Ver sección 6.

---

## 6. Estado actual y brechas

Estas son las brechas que conviene conocer antes de usar el template con clientes reales:

1. **Rol máximo por clave (corregido).** El rol máximo se guarda en `platform_tenants.api_key_role` al crear o rotar la clave. El login solo puede bajarlo. Las claves creadas antes de este cambio quedan en `viewer`: hay que rotarlas para asignarles el rol correcto. _Pendiente de prueba en ejecución._
2. **El rol no se aplica en el servidor.** Solo se distinguen dos niveles: tenant y plataforma. Un `viewer` puede llamar a `template/execute` si su token pasa la compuerta. Falta una tabla de permisos por rol y endpoint.
3. **Sin `API_SECRET`, todo queda abierto.** Es el comportamiento de desarrollo. En producción debe configurarse. Falta que el servidor se niegue a arrancar en `NODE_ENV=production` sin `API_SECRET`.
4. **El JWT de plataforma entra a todas las rutas,** incluidas las que aún aceptan `tenantId` del cuerpo (`tools`, `perf`, `mutations`, `reflex`, `orders/*`). Es lo esperado para el super admin, pero el admin de un estudio no debe heredarlo.
5. **`monitor/*`, `registry`, `circuit-breaker` y `mutations/trigger`** no están restringidos por rol. Hoy los puede usar cualquier JWT de plataforma o la clave de servidor.
6. **`DASHBOARD_ROLE`** acepta `platform_owner`, `tenant_owner`, `operator` y `viewer`. Los nombres anteriores (`super_admin`, `admin`) se aceptan con un aviso en el log, para no romper los `.env` existentes. Es el rol por defecto del dashboard, no un control de acceso por usuario.
7. **El SSE de logs** (`/api/logs/stream`) solo acepta `API_SECRET`, por header o por `?apiKey=`. Un JWT de plataforma no puede usarlo.

---

## 7. Diseño objetivo

- **Roles guardados en el servidor:** cada clave de tenant tiene un rol asignado al crearla. El login solo puede bajar el rol, nunca subirlo.
- **Permisos por rol y endpoint:** una tabla explícita (`tenant_owner`, `operator`, `viewer` → endpoints permitidos). Reemplaza la lista `TENANT_ENDPOINTS` actual, que hoy no distingue roles.
- **`ownerId` en tenants:** el admin de un estudio ve solo sus tenants. Sus credenciales son JWT de estudio, no de plataforma.
- **Fail-closed en producción:** sin `API_SECRET`, el servidor no arranca si `NODE_ENV=production`.
- **Credenciales de LLM y Jev por estudio**, con override opcional por tenant, cifradas con `BIOCORE_SECRET_KEY`.
- **Rotación y revocación** desde el panel de plataforma, con registro de quién hizo qué.

---

## 8. Checklist para un despliegue nuevo

1. Crear `.env` desde `.env.example`.
2. Definir `API_SECRET` con un valor largo y aleatorio. Guardarlo en un gestor de secretos, no en el repositorio.
3. Definir `PLATFORM_SECRET` solo si este despliegue administra clientes (`DEPLOYMENT_MODE=studio`). En `single`, no hace falta.
4. Definir las claves de LLM y `TYPESAFE_API_KEY` según los proveedores que uses.
5. Crear la API key de cada tenant con `platform/tenants` y entregarla por un canal seguro.
6. Crear o rotar la clave del tenant con `api_key_role` acorde al uso (`tenant_owner` solo para el dueño). Las claves anteriores a este cambio quedan en `viewer` hasta rotarlas.
7. En el dashboard, configurar `VITE_*` solo con valores no secretos.

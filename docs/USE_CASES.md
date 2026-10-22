# BioCore: Casos de Uso

Casos de uso organizados por estado de implementación. BioCore es un motor de automatización autónomo con memoria procedural — no requiere LLM para tareas conocidas.

---

## Parte 1: Casos Implementados y Ejecutables HOY

Estos casos funcionan con las moléculas existentes (HTTP, FileSystem, SQLite, Gmail, Git, Scraper, System, WhatsApp, WebSocket) y la infraestructura actual (Scheduler, MonitorTask, Reflex, Dashboard).

---

### 🚨 Caso 1: Sistema de Monitoreo y Alertas Inteligentes

**Estado: ✅ IMPLEMENTADO Y EN PRODUCCIÓN**

**Problema**: Monitorear endpoints y alertar solo cuando sea crítico, sin inundar al equipo con falsos positivos.

**Componentes usados:**

| Componente            | Rol                               | ¿Usa LLM?            |
| --------------------- | --------------------------------- | -------------------- |
| Scheduler             | Dispara checks cada N minutos     | ❌                   |
| HTTPMolecule          | Health checks a endpoints         | ❌                   |
| ScraperMolecule       | Monitorea páginas de status       | ❌                   |
| GeminiCortex          | Analiza si el problema es crítico | ✅ Solo si hay fallo |
| GmailMolecule         | Envía alertas filtradas           | ❌                   |
| DatabaseMolecule      | Registra historial de incidentes  | ❌                   |
| Dashboard (LogsPanel) | Visualiza logs en tiempo real     | ❌                   |

**Flujo real (validado en producción):**

```
Scheduler cada 2 minutos:
  → HTTP GET a endpoints configurados
  → Si responde 200 → registra OK, no hace nada
  → Si falla:
    → LLM analiza: ¿Es crítico o falsa alarma?
    → Si crítico → Gmail envía alerta
    → Registra en DB para historial
    → Dashboard muestra en Logs Panel en tiempo real
```

**Cómo configurarlo:**

```
Desde el Dashboard > Operations > Scheduler:
  1. Seleccionar template "HTTP Health Check"
  2. Llenar URL y intervalo
  3. El sistema monitorea automáticamente
```

**Valor demostrado:** Reduce alertas de 200/día a ~10 reales. El LLM discrimina entre "Error 500 en endpoint de testing" (ignora) y "Error 500 en pagos" (alerta crítica).

---

### 🔐 Caso 2: Backup Inteligente con Git

**Estado: ✅ EJECUTABLE**

**Problema**: Hacer backups automáticos y detectar cambios importantes sin intervención humana.

**Componentes usados:**

| Componente         | Rol                                 | ¿Usa LLM?   |
| ------------------ | ----------------------------------- | ----------- |
| FileSystemMolecule | Detecta cambios en archivos         | ❌          |
| GitMolecule        | Commits automáticos                 | ❌          |
| LLM (opcional)     | Genera commit messages descriptivos | ✅ Opcional |
| GmailMolecule      | Alerta de backups críticos          | ❌          |

**Flujo:**

```
Scheduler o estímulo manual:
  → Muta a "filesystem" → detecta archivos modificados
  → Muta a "versioncontrol" → git add + commit
  → Si cambio es en config crítica → email al equipo
  → Reflex aprende: "backup de X" → ejecuta sin LLM la próxima vez
```

---

### 🌍 Caso 3: Web Scraper con Detección de Cambios

**Estado: ✅ EJECUTABLE**

**Problema**: Monitorear sitios web y alertar cuando publican contenido nuevo relevante.

**Componentes usados:**

| Componente       | Rol                          | ¿Usa LLM? |
| ---------------- | ---------------------------- | --------- |
| ScraperMolecule  | Extrae contenido de sitios   | ❌        |
| DatabaseMolecule | Compara con versión anterior | ❌        |
| LLM              | Filtra: ¿Es relevante?       | ✅        |
| GmailMolecule    | Envía digest                 | ❌        |

**Ejemplo real:**

```
"Avísame cuando publiquen nuevas ofertas en Y Combinator"

BioCore (cada 4 horas):
  1. Scrapea la página de jobs
  2. Compara con versión guardada en DB
  3. Detecta 5 nuevas ofertas
  4. LLM filtra: Solo 2 son para "Senior Backend"
  5. Email: "2 nuevas ofertas relevantes"

Después de 3 ejecuciones exitosas:
  → Reflex aprende el flujo
  → Ejecuta sin LLM (0 tokens) las siguientes veces
```

---

### 📊 Caso 4: Dashboard Reporting Automatizado

**Estado: ✅ EJECUTABLE**

**Problema**: Generar reportes combinando múltiples fuentes de datos sin intervención manual.

**Componentes usados:**

| Componente         | Rol                       | ¿Usa LLM?   |
| ------------------ | ------------------------- | ----------- |
| HTTPMolecule       | Extrae métricas de APIs   | ❌          |
| DatabaseMolecule   | Consulta datos internos   | ❌          |
| ScraperMolecule    | Analiza competencia       | ❌          |
| FileSystemMolecule | Genera reporte            | ❌          |
| GmailMolecule      | Envía a stakeholders      | ❌          |
| LLM                | Genera análisis narrativo | ✅ Opcional |

---

### 📚 Caso 5: Documentación Automática de Código

**Estado: ✅ EJECUTABLE**

**Problema**: Mantener documentación técnica actualizada automáticamente.

**Flujo:**

```
"Documenta el módulo src/biocore/molecules/"

BioCore:
  1. Lee archivos .ts del directorio (FileSystem)
  2. LLM analiza: interfaces, métodos, dependencias
  3. Genera README.md con tabla de métodos y ejemplos
  4. Commit automático (Git): "docs: auto-generate molecules documentation"
  5. Email al tech lead: "Documentación actualizada"
```

---

### ⚡ Caso 6: Health Check Cascading (Sin LLM)

**Estado: ✅ EJECUTABLE**

**Problema**: Monitorear endpoints y auto-diagnosticar fallos sin depender de un LLM para cada ping.

**Flujo (95% sin LLM):**

```
Scheduler cada 30s:
  → HTTP ping a 20 endpoints
  → Si falla:
    → SystemMolecule: traceroute, netstat (diagnóstico)
    → DatabaseMolecule: registra incidente
    → GmailMolecule: envía alerta
    → Si no se resuelve en 10 min → escala al LLM
```

---

### 🗑️ Caso 7: Rotación de Logs y Limpieza (Sin LLM)

**Estado: ✅ EJECUTABLE — 0 tokens**

**Flujo:**

```
Scheduler diario 3:00 AM:
  → FileSystem: lista archivos .log > 30 días
  → System: comprime con gzip
  → FileSystem: mueve a /archive
  → Database: registra auditoría
  → Gmail: reporte "150MB liberados, 23 archivos archivados"
```

---

### 🔧 Caso 8: Auto-healing de Servicios (Sin LLM)

**Estado: ✅ EJECUTABLE — 0 tokens**

**Flujo:**

```
Monitor detecta servicio caído:
  → System: restart del servicio
  → HTTP: health check post-restart
  → Si responde → registra recuperación, notifica
  → Si NO responde → rollback a versión anterior
  → Si sigue caído → ALERTA CRÍTICA: intervención manual
```

---

### 🚀 Caso 9: Orquestador de Deploy (Híbrido)

**Estado: ✅ EJECUTABLE**

**Flujo:**

```
Webhook de GitHub (push a main):
  → Git: pull en staging
  → System: ejecuta tests (npm test)
  → Si pasan:
    → System: deploy a producción
    → HTTP: smoke tests post-deploy
    → Database: registra deploy
    → Gmail: "Deploy v1.2.3 exitoso"
  → Si fallan:
    → LLM analiza output de tests
    → Gmail: diagnóstico al dev que hizo push
```

---

## Parte 2: Casos Nuevos (Emergieron del Dashboard Evolution)

Estos casos no existían antes y fueron habilitados por la implementación del Dashboard con roles, templates, SSE, y paneles de sistema.

---

### 🖥️ Caso 10: Operaciones sin CLI

**Estado: ✅ IMPLEMENTADO**

**Problema**: Un operador necesita gestionar el sistema sin acceso SSH al servidor.

**Habilitado por:** Dashboard + Roles + Templates + Scheduler Panel

**Flujo:**

```
Operador (rol: operator) desde el navegador:
  → Crea tarea desde template "HTTP Health Check"
  → Pausa/reanuda tareas del scheduler
  → Ve actividad en tiempo real
  → NO puede invocar tools ni forzar mutaciones (restricción de rol)
```

---

### 🧠 Caso 11: Aprendizaje Observable

**Estado: ✅ IMPLEMENTADO**

**Problema**: Un admin quiere ver cómo el sistema aprende y optimiza su uso de tokens.

**Habilitado por:** Reflex Panel + métricas de PerfMonitor

**Flujo:**

```
Admin observa en Intelligence > Reflex:
  → Hit rate subiendo (60% → 85% en una semana)
  → Token savings acumulándose (12,000 tokens ahorrados)
  → Lista de reflexes con success count y threshold
  → Puede invalidar un reflex que ya no aplica
```

---

### 🔍 Caso 12: Debugging Visual

**Estado: ✅ IMPLEMENTADO**

**Problema**: Correlacionar una mutación con los logs que la causaron sin acceder al servidor.

**Habilitado por:** Mutation Timeline + Logs SSE + Circuit Breaker Panel

**Flujo:**

```
Admin en System:
  → Ve en Mutation Timeline: "sensory → memory" a las 14:32
  → Cambia a Logs Panel: filtra por timestamp 14:32
  → Ve los logs del Cortex decidiendo la mutación
  → Circuit Breaker muestra que Gemini estaba en OPEN (429)
  → Conclusión: el sistema usó fallback correctamente
```

---

### ⚙️ Caso 13: Automatización sin Código

**Estado: ✅ IMPLEMENTADO**

**Problema**: Crear tareas programadas sin escribir JSON, código, ni usar el REPL.

**Habilitado por:** Template Selector + Scheduler Panel

**Flujo:**

```
Operador:
  1. Dashboard > Operations > Scheduler
  2. Click en "Database Backup" template
  3. Llena: table="users", outputPath="./backups/"
  4. Envía → tarea registrada con intervalo de 1 hora
  5. Ve ejecuciones en Activity Panel
```

---

## Parte 3: Casos Futuros (Requieren Moléculas Adicionales)

Estos casos son viables arquitectónicamente pero necesitan moléculas que aún no existen.

---

### 🛎️ Caso 14: Asistente de E-Commerce Multi-Canal

**Requiere:** CartMolecule, StockMolecule, integración con plataformas de e-commerce

**Complejidad:** Media

**Concepto:** Atender al cliente en WhatsApp, Email y Web con una misma IA. El transporte SSE ya existe — falta la lógica de negocio de carrito/inventario.

---

### 🏢 Caso 15: Recruiting Automatizado

**Requiere:** Integración LinkedIn API (restrictiva), CVParserMolecule

**Complejidad:** Alta (API de LinkedIn es difícil de obtener)

**Concepto:** Screening automático de candidatos, matching con job descriptions, emails automáticos.

---

### 📈 Caso 16: Análisis Financiero

**Requiere:** Integración con APIs financieras (Alpha Vantage, Yahoo Finance)

**Complejidad:** Baja (es HTTP puro, solo falta configurar)

**Concepto:** Rastrear inversiones, analizar noticias, generar reportes semanales con sentimiento de mercado.

---

### 🧪 Caso 17: QA Testing Automatizado

**Requiere:** Puppeteer/Playwright CLI integration

**Complejidad:** Media

**Concepto:** Post-deploy, navegar el sitio, capturar screenshots, comparar con versión anterior, detectar regresiones visuales.

---

### 📨 Caso 18: Slack/Discord Notifications

**Requiere:** SlackMolecule o DiscordMolecule

**Complejidad:** Baja (APIs bien documentadas)

**Concepto:** Gateway de notificaciones multi-canal. Hoy solo hay Gmail y WhatsApp — agregar Slack/Discord amplía los canales.

---

### ☁️ Caso 19: Cloud Storage (S3)

**Requiere:** S3Molecule (AWS SDK)

**Complejidad:** Baja

**Concepto:** Backup a la nube, procesamiento de archivos grandes, CDN upload automático.

---

### 🔁 Caso 20: Sincronización entre Sistemas

**Requiere:** Solo las moléculas existentes (HTTP + DB)

**Complejidad:** Baja — es orquestación pura

**Concepto:** Webhook de sistema A → lee datos → escribe en sistema B → confirma. LLM solo para resolver conflictos de merge.

---

### 💰 Caso 21: Reconciliación Financiera

**Requiere:** Integración con API bancaria

**Complejidad:** Media (APIs bancarias varían por país/banco)

**Concepto:** Cruzar extractos bancarios con facturas. 95% programático, LLM solo para discrepancias.

---

### 📉 Caso 22: Bot de Precios Competitivos

**Requiere:** API de e-commerce propio para actualizar precios

**Complejidad:** Media

**Concepto:** Scrapear precios de competidores cada hora, ajustar automáticamente, LLM solo para anomalías (>20% de cambio).

---

## Parte 4: Casos Aspiracionales (Verticales de Industria)

Estos casos demuestran la versatilidad de la arquitectura pero requieren moléculas especializadas y posiblemente integraciones complejas.

| #   | Caso                      | Vertical              | Moléculas faltantes                                                  |
| --- | ------------------------- | --------------------- | -------------------------------------------------------------------- |
| 23  | Investigación Empresarial | Business Intelligence | SocialMolecule (LinkedIn)                                            |
| 24  | Asistente Médico          | Salud                 | Base de conocimiento médica                                          |
| 25  | NPCs Inteligentes         | Gaming                | Integración con game engine                                          |
| 26  | Contenido para Redes      | Marketing             | APIs de redes sociales                                               |
| 27  | Asistente de RRHH         | Recursos Humanos      | LinkedIn API, Calendar API                                           |
| 28  | Tutor Educativo           | Educación             | Content management                                                   |
| 29  | Asistente Legal           | Legal                 | Base de regulaciones                                                 |
| 30  | Monitoreo Agrícola        | Agricultura           | APIs de clima especializadas                                         |
| 31  | Gestión de Citas          | Salud                 | Calendar API, SMS                                                    |
| 32  | Asistente Restaurantes    | Hospitality           | ✅ IMPLEMENTADO (OrderMolecule, InventoryMolecule, DeliveryMolecule) |
| 33  | Asistente Inmobiliario    | Real Estate           | APIs de portales inmobiliarios                                       |

Todos siguen el mismo patrón: estímulo → mutación → molécula → resultado. La arquitectura no cambia — solo se agregan moléculas.

---

## Parte 5: Caso Implementado — Restaurante (Multi-Industria)

### 🍔 Caso 32: Asistente de Restaurante

**Estado: ✅ IMPLEMENTADO**

**Problema**: Gestionar pedidos, inventario y entregas de un restaurante desde un chat o dashboard.

**Componentes usados:**

| Componente            | Rol                           | ¿Usa LLM?      |
| --------------------- | ----------------------------- | -------------- |
| OrderMolecule         | Crear/listar/cancelar pedidos | ❌             |
| InventoryMolecule     | Stock, alertas, descuento     | ❌             |
| DeliveryMolecule      | Asignar repartidor, rastrear  | ❌             |
| WhatsAppMolecule      | Notificar al cliente          | ❌             |
| LLM (Nemotron/Gemini) | Interpretar lenguaje natural  | ✅ Primera vez |
| Reflex                | Reutilizar flujos aprendidos  | ❌             |

**Flujo real (validado):**

```
"Crea un pedido de 2 hamburguesas para mesa 4"

BioCore:
  → mutate:orders → create_order({items: [{name: "hamburguesa", quantity: 2}], table: "4"})
  → mutate:inventory → decrease_stock({name: "carne", amount: 2})
  → Respuesta: "Pedido #1 creado. Stock descontado."

Segunda vez (Reflex):
  → Ejecuta la misma secuencia sin LLM (0 tokens)
```

**Configuración:**

- `TENANT_PROFILE=restaurant` en `.env`
- Agente de dominio: `config/agents/restaurant-agent.md`
- Templates: Crear Pedido, Verificar Stock, Asignar Entrega, Resumen de Ventas, etc.
- BD aislada: `data/tenants/{restaurante}.db`

**Herramientas disponibles:**

| Célula        | Herramientas                                                                              |
| ------------- | ----------------------------------------------------------------------------------------- |
| orders        | `create_order`, `update_order_status`, `list_orders`, `cancel_order`, `daily_summary`     |
| inventory     | `check_stock`, `upsert_inventory`, `list_inventory`, `low_stock_alerts`, `decrease_stock` |
| delivery      | `assign_delivery`, `track_delivery`, `estimate_time`, `mark_delivered`                    |
| communication | `send_whatsapp`, `send_email`                                                             |

**Valor:** Un restaurante puede gestionar pedidos, inventario y entregas desde un chat en lenguaje natural, con aprendizaje automático de flujos repetidos.

---

## El Patrón Común

```
Usuario/Evento/Scheduler/Webhook
    → stimulate_differentiation(tipo)    ← selecciona especialidad
    → Célula muta                        ← carga herramientas relevantes
    → Molécula ejecuta                   ← lógica de negocio
    → Reflex aprende                     ← 0 tokens la próxima vez
    → Resultado al usuario/sistema
```

Lo que cambia entre caso y caso son las **Moléculas** y el **registry.json**. El framework nunca cambia.

---

## Cuándo Usar Cada Patrón

| Patrón                             | Cuándo                                                   | Casos                |
| ---------------------------------- | -------------------------------------------------------- | -------------------- |
| **100% sin LLM**                   | Flujo predecible, alto volumen, repetitivo               | 6, 7, 8              |
| **Híbrido (LLM solo excepciones)** | Reglas claras con casos borde impredecibles              | 1, 3, 9              |
| **LLM + Reflex**                   | Primera vez usa LLM, después 0 tokens                    | 3, 4, 5              |
| **100% con LLM**                   | Tareas creativas, análisis de texto, decisiones ambiguas | Casos aspiracionales |

### Regla Simple

> Si puedes escribir el flujo como un `if/else`, no necesitas LLM.
> Si necesitas "pensar", "interpretar" o "crear", sí.
> Si ya lo hiciste una vez con LLM, el Reflex lo repite sin tokens.

### Ventaja Competitiva

A diferencia de LangChain o CrewAI que **requieren** un LLM para funcionar:

- ✅ BioCore ejecuta pipelines completos sin LLM (casos 6-8)
- ✅ Usa LLM solo cuando agrega valor real (casos 1, 3, 9)
- ✅ Aprende y elimina el LLM de flujos repetidos (Reflex)
- ✅ Reduce costos de LLM un 80-95% en pipelines híbridos

**BioCore no es un framework de LLM. Es un motor de automatización que opcionalmente piensa.**

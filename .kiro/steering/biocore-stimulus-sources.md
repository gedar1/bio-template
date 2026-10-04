---
inclusion: manual
---

# 🎯 BioCore es Agnóstica a la Fuente del Estímulo

## La Verdad Arquitectónica

**BioCore NO está acoplado al LLM.** El estímulo puede venir de cualquier lugar:

```
┌─────────────────────────────────────────────────────────────┐
│ FUENTES POSIBLES DE ESTÍMULO                                │
├─────────────────────────────────────────────────────────────┤
│ 1. LLM (Gemini/Claude)          ← Lo que vimos hasta ahora  │
│ 2. Input del usuario (CLI)      ← Comando directo           │
│ 3. API REST                     ← Petición HTTP             │
│ 4. Frontend (UI)                ← Click en botón            │
│ 5. Log/Evento                   ← Trigger automático        │
│ 6. Scheduler/Cron               ← Ejecución programada      │
│ 7. Webhook                      ← Evento externo            │
│ 8. Base de datos                ← Cambio en BD              │
│ 9. Sistema de archivos          ← Cambio en archivo         │
│ 10. Otro organismo              ← Comunicación inter-órganos │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔄 El Punto de Entrada: routeStimulus()

La clave es que **routeStimulus()** es agnóstica:

```typescript
// En BaseOrchestrator.ts

public async routeStimulus(type: string): Promise<void> {
  const validated = StimulusTypeSchema.parse(type);
  // type puede ser: "sensory", "memory", "filesystem", etc.

  // ⭐ NO IMPORTA DE DÓNDE VENGA EL ESTÍMULO
  // Solo importa QUÉ tipo es

  await this.perf.measure("mutation", async () => {
    log.info({ stimulus: validated }, "Difundiendo señal de diferenciación");

    const stimulationTasks = this.organisms.map((org) => org.stimulate(validated));
    await Promise.all(stimulationTasks);

    log.info({ stimulus: validated }, "Sistema reconfigurado");
  });
}
```

**routeStimulus() no pregunta:** "¿De dónde vino este estímulo?"
**routeStimulus() solo ejecuta:** "Muta a este tipo"

---

## 📊 Ejemplos: Diferentes Fuentes, Mismo Resultado

### Ejemplo 1: Estímulo del LLM (Lo que vimos)

```typescript
// UnifiedCortex.runGeminiLoop()
const calls = result.response.functionCalls();
// calls = [{ name: "stimulate_differentiation", args: { type: "sensory" } }]

await this.executeAction(call.name, call.args);
// → executeAction("stimulate_differentiation", { type: "sensory" })
// → routeStimulus("sensory")
// → Célula muta a sensory
```

### Ejemplo 2: Estímulo del Usuario (CLI)

```typescript
// Usuario escribe en terminal
// $ biocore mutate sensory

// En main.ts o CLI handler
const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin });

rl.question("Ingresa estímulo: ", async (stimulus) => {
  // stimulus = "sensory"

  // ⭐ MISMO CÓDIGO QUE EL LLM
  await orchestrator.routeStimulus(stimulus);
  // → Célula muta a sensory
});
```

### Ejemplo 3: Estímulo de API REST

```typescript
// POST /api/mutate
// Body: { "type": "sensory" }

app.post("/api/mutate", async (req, res) => {
  const { type } = req.body;
  // type = "sensory"

  try {
    // ⭐ MISMO CÓDIGO QUE EL LLM
    await orchestrator.routeStimulus(type);
    res.json({ success: true, message: `Mutado a ${type}` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
```

### Ejemplo 4: Estímulo del Frontend (UI)

```typescript
// En dashboard/src/components/MutationPanel.tsx

export function MutationPanel() {
  const [selectedType, setSelectedType] = useState('sensory');

  const handleMutate = async () => {
    // Usuario hace click en botón "Mutar a Sensory"

    const response = await fetch('/api/mutate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: selectedType })
      // type = "sensory"
    });

    // ⭐ MISMO CÓDIGO QUE EL LLM
    // → routeStimulus("sensory")
    // → Célula muta a sensory
  };

  return (
    <div>
      <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)}>
        <option value="sensory">Scraping</option>
        <option value="memory">Base de Datos</option>
        <option value="filesystem">Archivos</option>
        <option value="communication">Emails/WhatsApp</option>
      </select>
      <button onClick={handleMutate}>Mutar</button>
    </div>
  );
}
```

### Ejemplo 5: Estímulo de Log/Evento

```typescript
// En HealthServer.ts o MonitorTask.ts

// Monitoreo automático
setInterval(async () => {
  const systemHealth = await checkSystemHealth();

  if (systemHealth.cpuUsage > 80) {
    // ⭐ TRIGGER AUTOMÁTICO
    await orchestrator.routeStimulus("monitor");
    // → Célula muta a monitor
    // → Comienza monitoreo intensivo
  }
}, 5000);
```

### Ejemplo 6: Estímulo de Scheduler

```typescript
// En Scheduler.ts

// Cada día a las 2 AM, ejecuta backup
scheduler.schedule("0 2 * * *", async () => {
  // ⭐ TRIGGER PROGRAMADO
  await orchestrator.routeStimulus("filesystem");
  // → Célula muta a filesystem
  // → Ejecuta herramientas de archivos para backup
});
```

### Ejemplo 7: Estímulo de Webhook

```typescript
// POST /webhook/github
// GitHub envía evento cuando hay push

app.post("/webhook/github", async (req, res) => {
  const event = req.body;

  if (event.action === "push") {
    // ⭐ TRIGGER EXTERNO
    await orchestrator.routeStimulus("versioncontrol");
    // → Célula muta a versioncontrol
    // → Ejecuta herramientas de Git
  }

  res.json({ ok: true });
});
```

### Ejemplo 8: Estímulo de Base de Datos

```typescript
// En DatabaseMolecule.ts

// Trigger en BD: cuando se inserta un registro en "tasks"
database.on("insert:tasks", async (record) => {
  if (record.type === "scrape") {
    // ⭐ TRIGGER DE BD
    await orchestrator.routeStimulus("sensory");
    // → Célula muta a sensory
    // → Ejecuta scraping automático
  }
});
```

### Ejemplo 9: Estímulo de Sistema de Archivos

```typescript
// En FileSystemMolecule.ts

// Trigger: cuando se crea un archivo .task
fs.watch("./tasks", async (eventType, filename) => {
  if (filename.endsWith(".task")) {
    // ⭐ TRIGGER DE ARCHIVO
    await orchestrator.routeStimulus("filesystem");
    // → Célula muta a filesystem
    // → Procesa el archivo
  }
});
```

### Ejemplo 10: Estímulo de Otro Organismo

```typescript
// En BaseOrganisms.ts

// Un organismo puede estimular a otro
public async communicateWithOrganism(targetOrganism: string, stimulus: string) {
  // ⭐ TRIGGER INTER-ÓRGANOS
  await this.orchestrator.routeStimulus(stimulus);
  // → Célula muta
  // → Ejecuta acción coordinada
}
```

---

## 🎯 Diagrama: Múltiples Fuentes, Un Destino

```
┌──────────────┐
│ LLM (Gemini) │
└──────┬───────┘
       │ "sensory"
       │
┌──────────────┐
│ CLI (Usuario)│
└──────┬───────┘
       │ "sensory"
       │
┌──────────────┐
│ API REST     │
└──────┬───────┘
       │ "sensory"
       │
┌──────────────┐
│ Frontend (UI)│
└──────┬───────┘
       │ "sensory"
       │
┌──────────────┐
│ Log/Evento   │
└──────┬───────┘
       │ "sensory"
       │
┌──────────────┐
│ Scheduler    │
└──────┬───────┘
       │ "sensory"
       │
┌──────────────┐
│ Webhook      │
└──────┬───────┘
       │ "sensory"
       │
┌──────────────┐
│ Base de Datos│
└──────┬───────┘
       │ "sensory"
       │
┌──────────────┐
│ File System  │
└──────┬───────┘
       │ "sensory"
       │
┌──────────────┐
│ Otro Órgano  │
└──────┬───────┘
       │ "sensory"
       │
       ↓
┌─────────────────────────────────────────┐
│ BaseOrchestrator.routeStimulus("sensory")│
└─────────────────────────────────────────┘
       │
       ↓
┌─────────────────────────────────────────┐
│ BaseOrganisms.stimulate("sensory")       │
└─────────────────────────────────────────┘
       │
       ↓
┌─────────────────────────────────────────┐
│ CellServer.stimulate_differentiation()   │
└─────────────────────────────────────────┘
       │
       ↓
┌─────────────────────────────────────────┐
│ Célula Muta a "sensory"                 │
│ - Instancia: ScraperMolecule            │
│ - Registra: scrape_url, extract_links   │
└─────────────────────────────────────────┘
```

---

## 💡 La Clave: Separación de Concerns

```typescript
// ❌ ACOPLADO (Malo)
if (source === "llm") {
  await routeStimulus(stimulus);
} else if (source === "api") {
  await routeStimulus(stimulus);
} else if (source === "cli") {
  await routeStimulus(stimulus);
}

// ✅ DESACOPLADO (Bueno - BioCore)
await routeStimulus(stimulus);
// No importa la fuente, el resultado es el mismo
```

---

## 🏗️ Arquitectura: Agnóstica a la Fuente

```
┌─────────────────────────────────────────────────────────────┐
│ CAPA DE ENTRADA (Agnóstica)                                 │
├─────────────────────────────────────────────────────────────┤
│ - LLM                                                       │
│ - CLI                                                       │
│ - API REST                                                  │
│ - Frontend                                                  │
│ - Log/Evento                                                │
│ - Scheduler                                                 │
│ - Webhook                                                   │
│ - Base de Datos                                             │
│ - File System                                               │
│ - Otro Órgano                                               │
└─────────────────────────────────────────────────────────────┘
                         ↓
                    (Todas convergen)
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ CAPA DE ORQUESTACIÓN (Agnóstica)                            │
├─────────────────────────────────────────────────────────────┤
│ BaseOrchestrator.routeStimulus(type)                        │
│ - Valida el tipo                                            │
│ - Difunde a organismos                                      │
│ - No pregunta de dónde vino                                 │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ CAPA DE EJECUCIÓN (Agnóstica)                               │
├─────────────────────────────────────────────────────────────┤
│ CellServer.stimulate_differentiation(type)                  │
│ - Muta según el tipo                                        │
│ - Instancia moléculas                                       │
│ - Registra herramientas                                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎯 Casos de Uso Reales

### Caso 1: Dashboard + LLM

```
Usuario hace click en "Scrapear" en el dashboard
  ↓
Frontend envía POST /api/mutate { type: "sensory" }
  ↓
API llama orchestrator.routeStimulus("sensory")
  ↓
Célula muta a sensory
  ↓
LLM recibe herramientas de scraping
  ↓
LLM ejecuta scraping automáticamente
```

### Caso 2: Scheduler + Automático

```
Scheduler dispara a las 2 AM
  ↓
Llama orchestrator.routeStimulus("filesystem")
  ↓
Célula muta a filesystem
  ↓
Ejecuta backup automático
  ↓
Sin intervención del LLM
```

### Caso 3: Webhook + Automático

```
GitHub envía webhook (push)
  ↓
Webhook handler llama orchestrator.routeStimulus("versioncontrol")
  ↓
Célula muta a versioncontrol
  ↓
Ejecuta operaciones Git automáticamente
  ↓
Sin intervención del LLM
```

### Caso 4: Log + Automático

```
Sistema detecta CPU alta
  ↓
Log trigger llama orchestrator.routeStimulus("monitor")
  ↓
Célula muta a monitor
  ↓
Comienza monitoreo intensivo
  ↓
Sin intervención del LLM
```

---

## 🚀 Implicaciones Arquitectónicas

### 1. BioCore es Agnóstica al LLM

```typescript
// BioCore funciona SIN LLM
const orchestrator = new BaseOrchestrator();
await orchestrator.routeStimulus("sensory");
// ✅ Funciona perfectamente
```

### 2. BioCore es Agnóstica a la Interfaz

```typescript
// Funciona con CLI, API, Frontend, etc.
// El código es el mismo
await orchestrator.routeStimulus(stimulus);
```

### 3. BioCore es Agnóstica al Trigger

```typescript
// Funciona con LLM, Scheduler, Webhook, etc.
// El código es el mismo
await orchestrator.routeStimulus(stimulus);
```

### 4. BioCore es Agnóstica a la Fuente

```typescript
// Funciona con cualquier fuente
// El código es el mismo
await orchestrator.routeStimulus(stimulus);
```

---

## 💡 Conclusión

**BioCore NO es un "sistema de LLM con mutación".**

**BioCore es un "sistema de mutación dinámica que OPCIONALMENTE puede usar LLM".**

La arquitectura es:

- ✅ Agnóstica a la fuente del estímulo
- ✅ Agnóstica al LLM
- ✅ Agnóstica a la interfaz
- ✅ Agnóstica al trigger

**El LLM es solo UNA de las muchas formas de generar estímulos.**

Otros sistemas pueden:

- Usar BioCore sin LLM
- Usar BioCore con múltiples LLMs
- Usar BioCore con triggers automáticos
- Usar BioCore con interfaces manuales
- Combinar todo lo anterior

**BioCore es agnóstica. El estímulo puede venir de cualquier lugar.**

---

## Relaciones

- Cómo se ejecuta el estímulo: [[biocore-execution-flow]]
- Ciclo de vida de la mutación: [[biocore-mutation-lifecycle]]
- Decisión de ser agnóstico: [[biocore-decisions]]
- Glosario (IStimulus, Orquestador): [[biocore-glossary]]
- Arquitectura general: [[biocore-architecture]]

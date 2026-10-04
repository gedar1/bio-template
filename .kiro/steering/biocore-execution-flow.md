---
inclusion: manual
---

# 🚀 Cómo Se Ejecuta el Estímulo: De la Decisión del LLM a la Mutación

## La Pregunta

**¿Cómo ejecuta el LLM la respuesta? Si decide "sensory", ¿cómo se ejecuta eso?**

Respuesta: **El LLM no ejecuta nada. El LLM solo retorna un "tool call" con el nombre de la herramienta y los argumentos. El programa es quien ejecuta.**

---

## 📊 Flujo Completo: De Principio a Fin

```
┌─────────────────────────────────────────────────────────────┐
│ PASO 1: USUARIO ESCRIBE                                     │
└─────────────────────────────────────────────────────────────┘

Usuario: "Scrapea https://example.com y guarda el título en la DB"
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PASO 2: UNIFIEDCORTEX ENVÍA AL LLM                          │
└─────────────────────────────────────────────────────────────┘

UnifiedCortex.chat(userMessage)
  ↓
runGeminiLoop(text)
  ↓
createGeminiChat()
  ↓
genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
  tools: [
    {
      name: "stimulate_differentiation",
      description: "Muta la célula... Tipos: 'sensory': web scraping | 'memory': BD | ...",
      inputSchema: { enum: ["sensory", "memory", ...] }
    }
  ]
})
  ↓
chat.sendMessage("Scrapea https://example.com y guarda el título en la DB")
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PASO 3: LLM ANALIZA Y DECIDE                                │
└─────────────────────────────────────────────────────────────┘

Gemini recibe:
  - Mensaje: "Scrapea https://example.com y guarda el título en la DB"
  - Herramientas: [stimulate_differentiation con schema]

Gemini razona:
  1. "Usuario dice 'scrapea' → necesito web scraping"
  2. "Veo enum: ['sensory', 'memory', ...]"
  3. "Veo description: 'sensory': web scraping"
  4. "¡Perfecto! Voy a usar sensory"

Gemini retorna:
{
  "functionCalls": [
    {
      "name": "stimulate_differentiation",
      "args": {
        "type": "sensory"
      }
    }
  ]
}
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PASO 4: UNIFIEDCORTEX RECIBE EL TOOL CALL                   │
└─────────────────────────────────────────────────────────────┘

En UnifiedCortex.runGeminiLoop() línea 160-170:

let result = await chat.sendMessage(text);
let calls = result.response.functionCalls();
// calls = [{ name: "stimulate_differentiation", args: { type: "sensory" } }]

while (calls && calls.length > 0) {
  for (const call of calls) {
    // ⭐ AQUÍ COMIENZA LA EJECUCIÓN
    const out = await this.executeAction(call.name, call.args);
    // call.name = "stimulate_differentiation"
    // call.args = { type: "sensory" }
  }
}
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PASO 5: EXECUTEACTION DECIDE QUÉ HACER                      │
└─────────────────────────────────────────────────────────────┘

En BaseOrchestrator.executeAction() línea 88-95:

public async executeAction(name: string, args: any): Promise<string> {
  log.info({ tool: name }, "Ejecutando acción");

  // ⭐ AQUÍ DETECTA QUE ES UNA MUTACIÓN
  if (name === "stimulate_differentiation") {
    await this.routeStimulus(args.type);
    // args.type = "sensory"
    return "Sistema mutado exitosamente. Nuevas herramientas disponibles.";
  }

  // Si fuera otra herramienta, la ejecutaría aquí
  // ...
}
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PASO 6: ROUTESTIMULUS DIFUNDE LA MUTACIÓN                   │
└─────────────────────────────────────────────────────────────┘

En BaseOrchestrator.routeStimulus() línea 50-65:

public async routeStimulus(type: string): Promise<void> {
  const validated = StimulusTypeSchema.parse(type);
  // validated = "sensory"

  await this.perf.measure("mutation", async () => {
    log.info({ stimulus: validated }, "Difundiendo señal de diferenciación");

    // ⭐ AQUÍ DIFUNDE A TODOS LOS ORGANISMOS
    const stimulationTasks = this.organisms.map((org) => org.stimulate(validated));
    await Promise.all(stimulationTasks);
    // Cada organismo recibe: stimulate("sensory")

    log.info({ stimulus: validated }, "Sistema reconfigurado");
  });
}
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PASO 7: ORGANISMO RECIBE EL ESTÍMULO                        │
└─────────────────────────────────────────────────────────────┘

En BaseOrganisms.stimulate() línea 50-60:

public async stimulate(customType: string): Promise<void> {
  if (!this.cell) throw new MutationError(...);

  this.log.info({ stimulus: customType }, "Estímulo recibido, mutando");
  // customType = "sensory"

  // ⭐ AQUÍ ENVÍA EL ESTÍMULO AL CELLSERVER (proceso hijo)
  await this.cell.callTool({
    name: "stimulate_differentiation",
    arguments: { type: customType }
    // arguments: { type: "sensory" }
  });

  await new Promise(resolve => setTimeout(resolve, 500));
  this.log.info({ stimulus: customType }, "Genoma MCP modificado");
}
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PASO 8: CELLSERVER RECIBE EL ESTÍMULO (Proceso Hijo)        │
└─────────────────────────────────────────────────────────────┘

En CellServer.setupBaseTools() línea 82-128:

private setupBaseTools() {
  this.server.registerTool(
    "stimulate_differentiation",
    { ... },
    async ({ type }) => {
      // type = "sensory"

      // ⭐ AQUÍ COMIENZA LA MUTACIÓN REAL
      await this.disposeMolecules();
      // Cierra moléculas del estado anterior

      this.currentType = type;
      // this.currentType = "sensory"

      const resolvedToolNames = resolveTools(type, registry.cells);
      // resolvedToolNames = ["scrape_url", "scrape_metadata", "extract_links", ...]

      await this.initializeMolecules(type);
      // Instancia: ScraperMolecule, HTTPMolecule

      this.registerToolsForType(type);
      // Registra las herramientas MCP

      log.info({ type: this.currentType }, "Mutación exitosa");
      return {
        content: [{
          type: "text",
          text: `Célula diferenciada exitosamente como '${type}'.`
        }]
      };
    }
  );
}
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PASO 9: CELLSERVER INSTANCIA LAS MOLÉCULAS                  │
└─────────────────────────────────────────────────────────────┘

En CellServer.initializeMolecules() línea 157-210:

private async initializeMolecules(type: string): Promise<void> {
  // type = "sensory"

  if (type === "sensory") {
    // ⭐ AQUÍ SE CREAN LAS MOLÉCULAS
    this.scraper = new ScraperMolecule();
    this.http = new HTTPMolecule();

    this.log.info({ type }, "Moléculas instanciadas");
  } else if (type === "memory") {
    this.database = new SQLiteMolecule();
  } else if (type === "communication") {
    this.gmail = new GmailMolecule();
    this.whatsapp = new WhatsAppMolecule();
  }
  // ... más tipos
}
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PASO 10: CELLSERVER REGISTRA LAS HERRAMIENTAS MCP            │
└─────────────────────────────────────────────────────────────┘

En CellServer.registerToolsForType() línea 211-238:

private registerToolsForType(type: string): void {
  // type = "sensory"

  if (type === "sensory") {
    // ⭐ AQUÍ SE REGISTRAN LAS HERRAMIENTAS
    this.registerScraperTools();
    // Registra: scrape_url, extract_links, scrape_metadata, extract_images

    this.registerHTTPTools();
    // Registra: fetch_api
  }
}

En CellServer.registerScraperTools() línea 453-503:

private registerScraperTools(): void {
  this.server.registerTool(
    "scrape_url",
    {
      description: "Scrapea una URL y extrae datos según un schema",
      inputSchema: { ... }
    },
    async ({ url, schema }) => {
      // ⭐ AQUÍ SE EJECUTA LA HERRAMIENTA
      const result = await this.scraper!.scrape(url, schema);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );
}
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PASO 11: UNIFIEDCORTEX OBTIENE NUEVAS HERRAMIENTAS          │
└─────────────────────────────────────────────────────────────┘

De vuelta en UnifiedCortex.runGeminiLoop() línea 170-180:

if (mutated) {
  log.info("Mutación detectada, refrescando herramientas");

  // ⭐ AQUÍ OBTIENE LAS NUEVAS HERRAMIENTAS
  const toolNames = (await this.getUnifiedTools()).map(t => t.name);
  // toolNames = ["stimulate_differentiation", "scrape_url", "extract_links", "scrape_metadata", ...]

  const continueMsg = `Sistema mutado. Herramientas: ${toolNames.join(", ")}. Continúa la tarea original.`;

  // ⭐ AQUÍ ENVÍA AL LLM LAS NUEVAS HERRAMIENTAS
  result = await chat.sendMessage(continueMsg);
}
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PASO 12: LLM RECIBE NUEVAS HERRAMIENTAS Y CONTINÚA           │
└─────────────────────────────────────────────────────────────┘

Gemini recibe:
  - Mensaje: "Sistema mutado. Herramientas: stimulate_differentiation, scrape_url, extract_links, scrape_metadata, fetch_api. Continúa la tarea original."
  - Herramientas: [
      stimulate_differentiation,
      scrape_url,
      extract_links,
      scrape_metadata,
      extract_images,
      fetch_api
    ]

Gemini razona:
  1. "Ahora tengo herramientas de scraping"
  2. "Usuario quería scrapear https://example.com"
  3. "Voy a usar scrape_url"

Gemini retorna:
{
  "functionCalls": [
    {
      "name": "scrape_url",
      "args": {
        "url": "https://example.com",
        "schema": { "title": "string", "description": "string" }
      }
    }
  ]
}
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PASO 13: UNIFIEDCORTEX EJECUTA SCRAPE_URL                   │
└─────────────────────────────────────────────────────────────┘

De vuelta en UnifiedCortex.runGeminiLoop():

for (const call of calls) {
  const out = await this.executeAction(call.name, call.args);
  // call.name = "scrape_url"
  // call.args = { url: "https://example.com", schema: {...} }
}

En BaseOrchestrator.executeAction():

// No es stimulate_differentiation, así que busca el organismo que la tiene
for (const org of this.organisms) {
  const tools = await org.inspectTools();
  if (tools && tools.some((t: any) => t.name === "scrape_url")) {
    // ⭐ ENCONTRÓ EL ORGANISMO QUE TIENE scrape_url
    const result = await org.callTool("scrape_url", args);
    return JSON.stringify(result);
  }
}

En BaseOrganisms.callTool():

public async callTool(name: string, args: Record<string, any>): Promise<any> {
  // ⭐ ENVÍA A CELLSERVER
  const result = await this.cell.callTool({ name, arguments: args });
  return result;
}

En CellServer (proceso hijo):

// CellServer ya tiene scrape_url registrada
// Ejecuta la herramienta:
async ({ url, schema }) => {
  const result = await this.scraper!.scrape(url, schema);
  // ⭐ AQUÍ SCRAPEA LA URL
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}

ScraperMolecule.scrape():
  1. Descarga HTML con HTTPMolecule
  2. Parsea con Cheerio
  3. Extrae datos según schema
  4. Retorna: { title: "Example Domain", description: "..." }
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PASO 14: RESULTADO VUELVE AL LLM                            │
└─────────────────────────────────────────────────────────────┘

UnifiedCortex recibe el resultado:
{ title: "Example Domain", description: "..." }

Envía al LLM:
{
  "functionResponse": {
    "name": "scrape_url",
    "response": { "content": "{ \"title\": \"Example Domain\", \"description\": \"...\" }" }
  }
}

Gemini recibe el resultado y continúa...
```

---

## 🎯 Resumen: Los 3 Actores

| Actor             | Responsabilidad             | Ejemplo                                                               |
| ----------------- | --------------------------- | --------------------------------------------------------------------- |
| **LLM (Gemini)**  | Decide qué herramienta usar | "Voy a usar stimulate_differentiation con type='sensory'"             |
| **UnifiedCortex** | Ejecuta la decisión del LLM | Llama a executeAction("stimulate_differentiation", {type: "sensory"}) |
| **CellServer**    | Ejecuta la herramienta real | Instancia ScraperMolecule y registra scrape_url                       |

---

## 🔄 El Ciclo Completo

```
1. LLM DECIDE
   ↓
2. UNIFIEDCORTEX EJECUTA
   ↓
3. CELLSERVER MUTA
   ↓
4. NUEVAS HERRAMIENTAS DISPONIBLES
   ↓
5. LLM RECIBE NUEVAS HERRAMIENTAS
   ↓
6. LLM DECIDE USAR NUEVA HERRAMIENTA
   ↓
7. UNIFIEDCORTEX EJECUTA
   ↓
8. CELLSERVER EJECUTA LA HERRAMIENTA
   ↓
9. RESULTADO VUELVE AL LLM
   ↓
10. LLM CONTINÚA O TERMINA
```

---

## 💡 Punto Clave: El LLM No Ejecuta Nada

El LLM **solo retorna un JSON** con:

```json
{
  "name": "stimulate_differentiation",
  "args": { "type": "sensory" }
}
```

El programa es quien:

1. Recibe ese JSON
2. Valida que sea correcto
3. Ejecuta la acción
4. Retorna el resultado al LLM

**El LLM es como un "cerebro" que toma decisiones. El programa es el "cuerpo" que las ejecuta.**

---

## 📍 Dónde Ocurre Cada Paso

| Paso | Archivo             | Línea | Función                         |
| ---- | ------------------- | ----- | ------------------------------- |
| 1    | UnifiedCortex.ts    | 160   | runGeminiLoop()                 |
| 2    | UnifiedCortex.ts    | 165   | chat.sendMessage()              |
| 3    | (API de Gemini)     | -     | LLM retorna tool call           |
| 4    | UnifiedCortex.ts    | 168   | result.response.functionCalls() |
| 5    | UnifiedCortex.ts    | 172   | executeAction()                 |
| 6    | BaseOrchestrator.ts | 88    | executeAction()                 |
| 7    | BaseOrchestrator.ts | 50    | routeStimulus()                 |
| 8    | BaseOrganisms.ts    | 50    | stimulate()                     |
| 9    | CellServer.ts       | 82    | setupBaseTools()                |
| 10   | CellServer.ts       | 157   | initializeMolecules()           |
| 11   | CellServer.ts       | 211   | registerToolsForType()          |
| 12   | UnifiedCortex.ts    | 175   | getUnifiedTools()               |
| 13   | UnifiedCortex.ts    | 180   | chat.sendMessage()              |

---

## 🚀 Flujo Resumido en 1 Línea

```
LLM decide → UnifiedCortex ejecuta → CellServer muta → Nuevas herramientas → LLM continúa
```

**El LLM es el "pensador", el programa es el "ejecutor".**

---

## 🧠 Flujo Alternativo: Memoria Refleja (Bypass del LLM)

Cuando el usuario envía un mensaje similar a uno que ya se resolvió exitosamente, el sistema puede ejecutar la secuencia directamente sin invocar al LLM:

```
┌─────────────────────────────────────────────────────────────┐
│ FLUJO REFLEX (0 tokens)                                     │
└─────────────────────────────────────────────────────────────┘

1. Usuario: "Scrapea https://otro.com y guarda en tabla products"
       ↓
2. chatStream() → trackInput()
       ↓
3. queryReflex():
   - normalizeForEmbedding("scrapea una URL y guarda en tabla")
   - computeEmbedding() → vector 384 dims
   - findSimilar() → HNSW index → candidatos
   - compositeScore = similarity × temporalDecay × reliabilityBoost
   - adaptiveThreshold(successCount, failureCount)
   - mode = "reflex" (sim ≥ threshold, éxitos ≥ 3)
       ↓
4. executeReflex():
   - checkSchemaVersions() → compatible ✓
   - extractParamsFromText() → { url: "https://otro.com", table: "products" }
   - interpolateTemplate(template, params):
     - $URL → "https://otro.com"
     - $TABLE → "products"
   - Ejecuta secuencia:
     a. routeStimulus("sensory")
     b. executeAction("scrape_url", { url: "https://otro.com" })
     c. routeStimulus("memory")
     d. executeAction("db_insert", { table: "products", data: <output de b> })
   - chainOutputTo: output de scrape_url → data de db_insert
       ↓
5. markSuccess() → refuerza el reflex
       ↓
6. yield resultado al usuario (0 tokens LLM consumidos)
```

### Degradación (Fallback al LLM)

Si el reflex no puede ejecutarse, degrada gracefully:

| Causa                                   | Acción                                   |
| --------------------------------------- | ---------------------------------------- |
| Params faltantes (`$URL` no encontrada) | Degrada a HINT_Mode → LLM guiado         |
| Schema version mismatch                 | Degrada a HINT_Mode → LLM guiado         |
| Error en ejecución de paso              | Marca reflex como fallido → LLM completo |
| Similitud < threshold                   | HINT_Mode o NORMAL según umbral          |

---

## Relaciones

- Cómo el LLM decide qué estímulo usar: [[biocore-llm-decision-flow]]
- Qué recibe el LLM exactamente: [[biocore-what-llm-receives]]
- Fuentes posibles de estímulo: [[biocore-stimulus-sources]]
- Ciclo de vida de la mutación: [[biocore-mutation-lifecycle]]
- Glosario de componentes: [[biocore-glossary]]

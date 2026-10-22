# JEV - Sistema 1 AI Evaluator

JEV es tu IA de Sistema 1 diseñada para evaluar queries (preguntas/instrucciones) contra reflexes y proporcionar veredictos tentativas rápidos y precisos.

## 📁 Archivos Creados

### 1. **jev-schema.json**
Define la estructura de evaluación que JEV debe usar:
- **cell_type**: Qué tipo de célula (sensory, filesystem, versioncontrol, etc.)
- **operation_type**: Tipo de operación (read, write, execute, combine)
- **persistence_required**: ¿Necesita guardar en BD?
- **complexity_score**: Complejidad (single, chained, complex)
- **automation_readiness**: ¿Es claro y automatizable?
- **confidence_level**: Confianza en la evaluación (Low, Medium, High)
- **tentative_verdict**: Veredicto (execute, queue, review, reject)

### 2. **jev-queries-examples.json**
7 ejemplos de queries que JEV debería evaluar, incluyendo:
- Caso simple: scrape and store ✅
- Caso de archivos: scrape and save to file ✅
- Caso de git: commit and push ✅
- Caso ambiguo: health check (Medium confidence) ⚠️
- Caso vago: "muestra los datos" (Low confidence) ❌
- Caso claro: download and store ✅
- Caso incompleto: send email (needs content) ⚠️

### 3. **jev-playground-ready.json**
Versión consolidada lista para usar en el **Anthropic Playground** o similar.
Incluye:
- Schema completo de evaluación
- Ejemplos de tests
- Proceso paso a paso de razonamiento
- Instrucciones de playground

## 🎯 Cómo Usar en el Playground

### Opción 1: Anthropic Playground
1. Ve a https://console.anthropic.com/
2. Abre el Playground
3. Copia el contenido de `jev-playground-ready.json` en el system prompt o como contexto
4. Envía queries de prueba:

```
User: "scrapea esta URL y guardala en la base de datos"

Expected JEV output:
{
  "cell_type": "sensory",
  "operation_type": "combine",
  "persistence_required": true,
  "complexity_score": "2-Chained",
  "automation_readiness": true,
  "confidence_level": "High",
  "tentative_verdict": "execute"
}
```

### Opción 2: Script Local (Node.js)
```bash
# Ejecutar desde tu proyecto
npm run parse-data-jev  # Si quieres generar los JSONs nuevamente
```

## 🔍 Ejemplos de Evaluación

### ✅ Alta Confianza - EXECUTE
```
Input: "scrapea esta URL y guardala en la base de datos"
Sequence: mutate:sensory->scrape_url->mutate:memory->db_insert
Verdict: EXECUTE
Reasoning: Claro, específico, patrón definido
```

### ⚠️ Confianza Media - QUEUE
```
Input: "verifica si el servicio esta funcionando"
Sequence: mutate:monitor->http_get->system_info
Verdict: QUEUE
Reasoning: Claro pero ambiguo - ¿health check HTTP o system_info?
```

### ❌ Baja Confianza - REJECT
```
Input: "muestra los datos"
Sequence: null
Verdict: REJECT
Reasoning: Vago - ¿archivo? ¿base de datos? Necesita contexto
```

## 📊 Criterios de Evaluación

| Criterio | Opciones |
|----------|----------|
| **persistence_required** | Buscar keywords: "guardala", "guardalo", "save", "db_insert" |
| **operation_type** | read \| write \| execute \| query \| combine |
| **complexity_score** | 1-Single \| 2-Chained \| 3-Complex |
| **confidence_level** | Low \| Medium \| High |
| **tentative_verdict** | execute \| queue \| review \| reject |

## 🚀 Próximos Pasos

### 1. Test en Playground
- [ ] Copiar `jev-playground-ready.json` al Anthropic Playground
- [ ] Enviar los 7 ejemplos de `jev-queries-examples.json`
- [ ] Validar que JEV produce los verdicts esperados

### 2. Integración en BioCore
- [ ] Crear endpoint `/jev/evaluate` que reciba queries
- [ ] Usar Claude API con el schema como system prompt
- [ ] Guardar evaluaciones en `biocore.db` tabla `jev_verdicts`

### 3. Mejorar Precisión
- [ ] Crear más ejemplos de queries complejas
- [ ] Ajustar criterios basado en resultados reales
- [ ] Añadir feedback loop para mejorar confianza

## 📝 Schema Quick Reference

```json
{
  "cell_type": "sensory|filesystem|versioncontrol|system|http|communication|memory|monitor",
  "operation_type": "read|write|delete|execute|query|combine",
  "persistence_required": true|false,
  "complexity_score": "1-Single|2-Chained|3-Complex",
  "automation_readiness": true|false,
  "confidence_level": "Low|Medium|High",
  "tentative_verdict": "execute|queue|review|reject"
}
```

## 🔗 Reflexes Structure

Cada reflex tiene:
```json
{
  "id": "1",
  "task_summary": "scrapea esta URL y guardala en la base de datos",
  "sequence": "mutate:sensory->scrape_url->mutate:memory->db_insert"
}
```

JEV evalúa contra:
- **task_summary**: Texto amigable del usuario
- **sequence**: Patrón técnico de operaciones

---

**Listo para el playground.** Prueba con los ejemplos y ajusta según sea necesario.

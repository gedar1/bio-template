import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Script para extraer data-jev.json y convertirlo a JSON estructurado
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inputFile = path.join(__dirname, '..', 'docs', 'data-jev.json');
const outputFile = path.join(__dirname, '..', 'docs', 'data-jev-parsed.json');

console.log(`📖 Leyendo: ${inputFile}\n`);

try {
  // Leer el archivo
  const content = fs.readFileSync(inputFile, 'utf8');
  
  // Parsear el contenido
  const reflexes = [];
  
  // Regex para extraer cada bloque [N]
  const blockRegex = /\[(\d+)\]\s+id:\s+(\d+)\s+task_summary:\s+(.+?)\s+sequence:\s+(.+?)(?=\n\[|$)/gs;
  
  let match;
  while ((match = blockRegex.exec(content)) !== null) {
    const [, index, id, taskSummary, sequence] = match;
    
    reflexes.push({
      id: parseInt(id),
      index: parseInt(index),
      task_summary: taskSummary.trim(),
      sequence: sequence.trim()
    });
  }
  
  // Crear objeto con estructura deseada
  const result = {};
  reflexes.forEach(reflex => {
    result[reflex.id.toString()] = {
      task_summary: reflex.task_summary,
      sequence: reflex.sequence
    };
  });
  
  // Guardar resultado
  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), 'utf8');
  
  console.log(`✅ Conversión completada`);
  console.log(`📊 Total reflexes procesados: ${reflexes.length}`);
  console.log(`💾 Guardado en: ${outputFile}`);
  console.log(`\n📌 Estructura del JSON:`);
  console.log(`{`);
  console.log(`  "1": {`);
  console.log(`    "task_summary": "scrapea esta URL y guardala en la base de datos",`);
  console.log(`    "sequence": "mutate:sensory->scrape_url->mutate:memory->db_insert"`);
  console.log(`  },`);
  console.log(`  ...`);
  console.log(`}`);
  
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}

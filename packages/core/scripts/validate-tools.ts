import Database from 'better-sqlite3';
import { join } from 'path';

const dbPath = join(process.cwd(), 'data', 'biocore-shared.db');
const db = new Database(dbPath);

interface ToolRow {
  tool: string;
}

interface DistributionRow {
  tool: string;
  count: number;
}

interface CountRow {
  count: number;
}

const tools = db.prepare('SELECT DISTINCT tool FROM reflexes_atomic ORDER BY tool').all() as ToolRow[];

console.log('\n✓ Tools únicos en BD:');
tools.forEach(t => console.log(`  - ${t.tool}`));

const expectedTools = ['scrape_url', 'db_insert', 'http_get', 'write_file', 'git_commit', 'system_info'];
console.log('\n✓ Mapeo vs tools.json:');
let allValid = true;
tools.forEach(t => {
  const isValid = expectedTools.includes(t.tool);
  console.log(`  - ${t.tool}: ${isValid ? '✓ VÁLIDO' : '✗ NO EXISTE'}`);
  if (!isValid) allValid = false;
});

const distribution = db.prepare('SELECT tool, COUNT(*) as count FROM reflexes_atomic GROUP BY tool ORDER BY count DESC').all() as DistributionRow[];
console.log('\n✓ Distribución:');
distribution.forEach(d => console.log(`  - ${d.tool}: ${d.count} reflexes`));

const deps = db.prepare('SELECT COUNT(*) as count FROM reflex_dependencies').get() as CountRow;
console.log(`\n✓ Dependencias: ${deps.count}`);

console.log(`\n${allValid ? '✅ VALIDACIÓN COMPLETADA - Tools correctamente mapeados según tools.json' : '❌ FALLO'}`);

db.close();

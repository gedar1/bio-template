import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Script para traer task_summary de la tabla reflexes en biocore.db
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "biocore.db");

console.log(`🔍 Conectando a: ${dbPath}\n`);

// Conectar a la BD
const db = new Database(dbPath);

try {
  // Query para traer task_summary
  const query = db.prepare("SELECT id, task_summary, sequence FROM reflexes");
  const results = query.all();

  if (results.length === 0) {
    console.log("⚠️  No se encontraron reflexes en la tabla.");
  } else {
    console.log(`✅ Se encontraron ${results.length} reflexes:\n`);

    results.forEach((row, index) => {
      console.log(`[${index + 1}] id: ${row.id}`);
      console.log(`    task_summary: ${row.task_summary}\n`);
      console.log(`    sequence: ${row.sequence}\n`);
    });
  }
} catch (error) {
  console.error("❌ Error al consultar la BD:", error);
  process.exit(1);
} finally {
  db.close();
}

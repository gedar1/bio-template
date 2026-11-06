import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Script genérico para copiar biocore.db a cualquier proyecto
 * Uso: npm run copy-db -- <ruta-destino>
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceDb = path.join(__dirname, "..", "data/biocore.db");

// Obtener ruta destino desde argumentos
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log("❌ Error: Debes especificar la ruta destino");
  console.log("");
  console.log("Uso:");
  console.log('  npm run copy-db -- "C:/ruta/a/proyecto"');
  console.log("");
  console.log("Ejemplos:");
  console.log(
    '  npm run copy-db -- "../repo-auto-bio-core/bio-auto-restaurant"',
  );
  console.log('  npm run copy-db -- "C:/Users/User/Documents/mi-proyecto"');
  process.exit(1);
}

const destinationDir = args[0];
const destinationDb = path.join(destinationDir, "data/biocore.db");

console.log(`📋 Copiando base de datos...\n`);
console.log(`📁 Origen:      ${sourceDb}`);
console.log(`📁 Destino:     ${destinationDb}\n`);

try {
  // Verificar que el archivo origen existe
  if (!fs.existsSync(sourceDb)) {
    console.error("❌ Error: No se encontró biocore.db en la ruta origen");
    process.exit(1);
  }

  // Verificar que el directorio destino existe
  if (!fs.existsSync(destinationDir)) {
    console.error(
      `❌ Error: El directorio destino no existe: ${destinationDir}`,
    );
    process.exit(1);
  }

  // Crear backup si el archivo ya existe
  if (fs.existsSync(destinationDb)) {
    const backupDb = `${destinationDb}.backup`;
    console.log(`⚠️  Archivo destino ya existe. Creando backup...`);
    fs.copyFileSync(destinationDb, backupDb);
    console.log(`✅ Backup guardado en: ${backupDb}\n`);
  }

  // Copiar archivo
  fs.copyFileSync(sourceDb, destinationDb);

  // Verificar que se copió correctamente
  if (fs.existsSync(destinationDb)) {
    const stats = fs.statSync(destinationDb);
    console.log(`✅ Base de datos copiada exitosamente`);
    console.log(`📊 Tamaño: ${(stats.size / 1024).toFixed(2)} KB`);
    console.log(`⏰ Fecha: ${stats.mtime.toLocaleString()}`);
  } else {
    console.error("❌ Error: No se pudo verificar la copia");
    process.exit(1);
  }
} catch (error) {
  console.error("❌ Error al copiar:", error.message);
  process.exit(1);
}

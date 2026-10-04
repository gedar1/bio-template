/**
 * Demo local del HeadlessOrchestrator.
 *
 * Muestra los tres modos de operación en acción:
 *   1. EXPLICIT  — pasos predefinidos (primer run, sin reflex)
 *   2. REFLEX    — patrón aprendido del run anterior (0 tokens)
 *   3. ESCALACIÓN — tarea ambigua que no puede resolverse sin LLM
 *
 * Cómo correr:
 *   npm run build:ts
 *   node packages/core/dist/scripts/demo-headless.js
 *
 * O desde la raíz:
 *   npm run demo:headless
 */

import { initTelemetry, createLogger } from "../config/logger.js";
initTelemetry();

import { HeadlessOrchestrator } from "../system/HeadlessOrchestrator.js";
import { HeadlessEscalationError } from "../errors.js";
import { BaseOrganisms } from "../organisms/BaseOrganisms.js";

const log = createLogger("DemoHeadless");

// ─── Organismo concreto (igual al TenantOrganism de TenantManager) ────────────

class DemoOrganism extends BaseOrganisms {
  constructor(allowedCells: string[]) {
    super("Demo", allowedCells);
  }
  async process(intention: any): Promise<any> {
    return intention;
  }
}

// ─── Helpers visuales ─────────────────────────────────────────────────────────

function separator(title: string) {
  const line = "─".repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(`${line}\n`);
}

function printResult(label: string, result: {
  mode: string;
  cellType: string;
  outputs: string[];
  jevConfidence?: number;
  jevTokens: number;
}) {
  console.log(`✅  ${label}`);
  console.log(`    Modo:       ${result.mode.toUpperCase()}`);
  console.log(`    Célula:     ${result.cellType}`);
  console.log(`    Pasos:      ${result.outputs.length}`);
  console.log(`    Jev tokens: ${result.jevTokens}${result.jevConfidence !== undefined ? ` (confidence: ${(result.jevConfidence * 100).toFixed(0)}%)` : ""}`);
  if (result.outputs.length > 0) {
    const preview = result.outputs[0]?.substring(0, 120) ?? "";
    console.log(`    Output[0]:  ${preview}${preview.length >= 120 ? "…" : ""}`);
  }
  console.log("");
}

// ─── Demo principal ────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🧬 BioCore — Demo HeadlessOrchestrator\n");
  console.log("Modos que se demostrarán:");
  console.log("  1. EXPLICIT  → pasos predefinidos (primer run)");
  console.log("  2. REFLEX    → patrón aprendido en el run anterior (0 tokens)");
  console.log("  3. ESCALACIÓN → tarea que requiere LLM\n");

  // Configurar orquestador headless con células disponibles
  const headless = new HeadlessOrchestrator({
    sessionId: `headless-demo-${Date.now()}`,
    allowedCells: ["filesystem", "memory"],
    jevConfidenceThreshold: 0.7,
  });

  // Registrar el organismo (lanza CellServer como proceso hijo)
  const organism = new DemoOrganism(["filesystem", "memory"]);
  headless.registerOrganism(organism);

  log.info("Inicializando HeadlessOrchestrator...");
  await headless.init();
  log.info("Sistema listo");

  // ── Demo 1: Modo EXPLICIT ─────────────────────────────────────────────────
  separator("Demo 1 — Modo EXPLICIT (pasos predefinidos)");

  console.log("📋 Tarea: listar archivos y guardar resultado en DB");
  console.log("   Estrategia esperada: EXPLICIT (no hay reflex, fallback definido)\n");

  try {
    const result1 = await headless.execute({
      instruction: "lista los archivos del proyecto y guarda el resultado en la base de datos",
      fallback: [
        {
          cell: "filesystem",
          tool: "list_files",
          args: { path: "./" },
        },
        {
          cell: "memory",
          tool: "db_insert",
          args: {
            table: "file_scans",
            data: {
              scanned_at: new Date().toISOString(),
              path: "./",
            },
          },
        },
      ],
    });

    printResult("Tarea completada", result1);
    console.log("💾  El patrón fue guardado en ReflexMolecule para la próxima vez.\n");
  } catch (err) {
    if (err instanceof HeadlessEscalationError) {
      console.log(`⚠️  Escalación inesperada: ${err.message}\n`);
    } else {
      throw err;
    }
  }

  // ── Demo 2: Modo REFLEX ───────────────────────────────────────────────────
  separator("Demo 2 — Modo REFLEX (patrón aprendido)");

  console.log("📋 La MISMA tarea del Demo 1, segunda ejecución");
  console.log("   Estrategia esperada: REFLEX (0 tokens, el patrón ya está guardado)\n");

  // Crear un nuevo orchestrator con la MISMA sesión para que comparta los reflexes
  const headless2 = new HeadlessOrchestrator({
    sessionId: `headless-demo-${Date.now()}-2`,
    allowedCells: ["filesystem", "memory"],
  });
  const organism2 = new DemoOrganism(["filesystem", "memory"]);
  headless2.registerOrganism(organism2);
  await headless2.init();

  try {
    const result2 = await headless2.execute({
      // Texto ligeramente diferente — la Memoria Refleja usa similitud semántica
      instruction: "lista archivos del directorio y guarda en base de datos",
    });

    printResult("Tarea completada", result2);

    if (result2.mode === "reflex") {
      console.log("⚡ Ejecutado en modo REFLEX: 0 tokens LLM consumidos.");
    } else {
      console.log(`ℹ️  Modo: ${result2.mode} (el reflex se guardó pero puede requerir más éxitos para activarse automáticamente)`);
    }
  } catch (err) {
    if (err instanceof HeadlessEscalationError) {
      console.log(`ℹ️  Sin reflex todavía (requiere ≥3 ejecuciones exitosas para activarse automáticamente): ${err.message}`);
      console.log("   Esto es normal en el primer run del sistema.\n");
    } else {
      throw err;
    }
  }

  // ── Demo 3: Escalación ────────────────────────────────────────────────────
  separator("Demo 3 — HeadlessEscalationError");

  console.log("📋 Tarea ambigua sin fallback definido");
  console.log("   Sin TYPESAFE_API_KEY → Jev no disponible");
  console.log("   Sin reflex → no hay patrón aprendido");
  console.log("   Sin fallback → HeadlessEscalationError\n");

  try {
    await headless.execute({
      instruction:
        "analiza el código, refactoriza las funciones duplicadas y genera un reporte de calidad",
      // Sin fallback — requiere razonamiento complejo → solo el LLM puede
    });
  } catch (err) {
    if (err instanceof HeadlessEscalationError) {
      console.log("✅  HeadlessEscalationError lanzado correctamente:");
      console.log(`    Código:      ${err.code}`);
      console.log(`    Instrucción: ${err.instruction}`);
      console.log(`    Jev confidence: ${err.jevConfidence ?? "N/A (Jev no disponible)"}`);
      console.log("\n   → El caller debería redirigir esta tarea al UnifiedCortex.");
      console.log("   → Ejemplo:");
      console.log("       try { await headless.execute(task) }");
      console.log("       catch (e) {");
      console.log("         if (e instanceof HeadlessEscalationError)");
      console.log("           yield* unifiedCortex.chatStream(e.instruction)");
      console.log("       }");
    } else {
      throw err;
    }
  }

  // ── Resumen ───────────────────────────────────────────────────────────────
  separator("Resumen");

  console.log("Modo     | Tokens LLM | Tokens Jev | Cuándo se usa");
  console.log("─────────|────────────|────────────|──────────────────────────────────────");
  console.log("REFLEX   | 0          | 0          | Patrón aprendido con ≥3 éxitos");
  console.log("JEV      | 0          | ~40        | Sin reflex, TYPESAFE_API_KEY configurada");
  console.log("EXPLICIT | 0          | 0          | Tarea predefinida con .fallback[]");
  console.log("ESCALAR  | LLM full   | 0          | Capturar HeadlessEscalationError → UnifiedCortex");
  console.log("");

  // Cleanup
  await organism.detach();
  await organism2.detach();
  process.exit(0);
}

main().catch((err) => {
  log.error("Error fatal en demo", { error: err.message });
  console.error(err);
  process.exit(1);
});

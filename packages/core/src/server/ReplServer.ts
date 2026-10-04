import * as readline from "node:readline";
import { createLogger } from "../config/logger.js";
import { HealthServer } from "./HealthServer.js";
import type { TenantManager } from "./TenantManager.js";
import { Scheduler } from "../infrastructure/Scheduler.js";

const log = createLogger("ReplServer");

/**
 * REPL interactivo de producción.
 * Permite interactuar con el tenant "repl" y consultar estado del sistema.
 */
export class ReplServer {
  readonly rl: readline.Interface;

  constructor(
    private readonly tenantManager: TenantManager,
    private readonly scheduler: Scheduler,
    private readonly health: HealthServer,
  ) {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  start(): void {
    this.ask();
  }

  close(): void {
    this.rl.close();
  }

  private ask(): void {
    this.rl.question("👤 [TÚ]: ", async (input) => {
      if (input.toLowerCase() === "salir") {
        this.rl.close();
        process.exit(0);
      }

      if (input.toLowerCase() === "health") {
        const status = await this.health.getHealth();
        console.log(JSON.stringify(status, null, 2));
        this.ask();
        return;
      }

      if (input.toLowerCase() === "tenants") {
        console.log(JSON.stringify(this.tenantManager.listTenants(), null, 2));
        this.ask();
        return;
      }

      if (input.toLowerCase() === "tasks") {
        console.log(JSON.stringify(this.scheduler.list(), null, 2));
        this.ask();
        return;
      }

      try {
        const response = await this.tenantManager.chat("repl", input);
        console.log(`🤖: ${response}`);
      } catch (error: any) {
        log.error({ error: error.message }, "Error en chat");
      }
      this.ask();
    });
  }
}

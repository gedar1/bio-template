import { createLogger } from "../config/logger.js";
import type { ILogger } from "../config/ILogger.js";

export interface ScheduledTask {
  id: string;
  name: string;
  intervalMs: number;
  action: () => Promise<string | void>;
  enabled: boolean;
  lastRun: number | null;
  nextRun: number;
  runCount: number;
  errors: number;
}

export interface ActivityEntry {
  taskId: string;
  taskName: string;
  timestamp: number;
  status: "ok" | "error";
  result: string;
}

/**
 * Scheduler para tareas recurrentes (monitoreo, backups, reportes).
 * Sin dependencias externas — usa setInterval con gestión de estado.
 * Guarda un log de actividad con los resultados de cada ejecución.
 */
export class Scheduler {
  readonly tasks: Map<string, ScheduledTask> = new Map();
  readonly timers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private activityLog: ActivityEntry[] = [];
  private readonly maxActivityEntries: number;
  private readonly log: ILogger;

  constructor(maxActivityEntries: number = 100, logger?: ILogger) {
    this.maxActivityEntries = maxActivityEntries;
    this.log = logger ?? createLogger("Scheduler");
  }

  /**
   * Registra una tarea recurrente.
   * @param id Identificador único
   * @param name Nombre descriptivo
   * @param intervalMs Intervalo en milisegundos
   * @param action Función async a ejecutar
   * @param startImmediately Si true, ejecuta la primera vez inmediatamente
   */
  register(
    id: string,
    name: string,
    intervalMs: number,
    action: () => Promise<string | void>,
    startImmediately: boolean = false,
  ): void {
    if (this.tasks.has(id)) {
      this.unregister(id);
    }

    const task: ScheduledTask = {
      id,
      name,
      intervalMs,
      action,
      enabled: true,
      lastRun: null,
      nextRun: Date.now() + (startImmediately ? 0 : intervalMs),
      runCount: 0,
      errors: 0,
    };

    this.tasks.set(id, task);
    this.log.info("Tarea registrada", { taskId: id, name, intervalMs });

    if (startImmediately) {
      this.executeTask(task);
    }

    this.startTimer(task);
  }

  private startTimer(task: ScheduledTask): void {
    const timer = setInterval(async () => {
      if (task.enabled) {
        await this.executeTask(task);
      }
    }, task.intervalMs);

    this.timers.set(task.id, timer);
  }

  private async executeTask(task: ScheduledTask): Promise<void> {
    try {
      this.log.debug("Ejecutando tarea", { taskId: task.id, name: task.name });
      const result = await task.action();
      task.lastRun = Date.now();
      task.nextRun = Date.now() + task.intervalMs;
      task.runCount++;

      this.addActivity({
        taskId: task.id,
        taskName: task.name,
        timestamp: Date.now(),
        status: "ok",
        result: result || "Completado",
      });

      this.log.debug("Tarea completada", {
        taskId: task.id,
        runCount: task.runCount,
      });
    } catch (error: any) {
      task.errors++;
      task.lastRun = Date.now();
      task.nextRun = Date.now() + task.intervalMs;

      this.addActivity({
        taskId: task.id,
        taskName: task.name,
        timestamp: Date.now(),
        status: "error",
        result: error.message,
      });

      this.log.error("Error en tarea", {
        taskId: task.id,
        error: error.message,
        errors: task.errors,
      });
    }
  }

  private addActivity(entry: ActivityEntry): void {
    this.activityLog.unshift(entry); // Más reciente primero
    if (this.activityLog.length > this.maxActivityEntries) {
      this.activityLog = this.activityLog.slice(0, this.maxActivityEntries);
    }
  }

  /** Obtiene el log de actividad (más reciente primero) */
  getActivity(limit: number = 20): ActivityEntry[] {
    return this.activityLog.slice(0, limit);
  }

  /** Obtiene actividad filtrada por tarea */
  getActivityByTask(taskId: string, limit: number = 10): ActivityEntry[] {
    return this.activityLog.filter((a) => a.taskId === taskId).slice(0, limit);
  }

  /** Pausa una tarea sin eliminarla */
  pause(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    task.enabled = false;
    this.log.info("Tarea pausada", { taskId: id });
    return true;
  }

  /** Reanuda una tarea pausada */
  resume(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    task.enabled = true;
    task.nextRun = Date.now() + task.intervalMs;
    this.log.info("Tarea reanudada", { taskId: id });
    return true;
  }

  /** Ejecuta una tarea manualmente (fuera de su intervalo) */
  async trigger(id: string): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task) return false;
    await this.executeTask(task);
    return true;
  }

  /** Elimina una tarea y su timer */
  unregister(id: string): boolean {
    const timer = this.timers.get(id);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(id);
    }
    const deleted = this.tasks.delete(id);
    if (deleted) this.log.info("Tarea eliminada", { taskId: id });
    return deleted;
  }

  /** Info de todas las tareas */
  list(): Array<Omit<ScheduledTask, "action">> {
    return Array.from(this.tasks.values()).map(({ action, ...rest }) => rest);
  }

  /** Obtiene una tarea por ID */
  get(id: string): Omit<ScheduledTask, "action"> | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    const { action, ...rest } = task;
    return rest;
  }

  get size(): number {
    return this.tasks.size;
  }

  /** Detiene todas las tareas y limpia timers */
  shutdown(): void {
    for (const [id, timer] of this.timers) {
      clearInterval(timer);
    }
    this.timers.clear();
    this.tasks.clear();
    this.log.info("Scheduler detenido");
  }
}

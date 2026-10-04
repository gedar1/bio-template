import type { IMolecule } from "./IMolecule.js";

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface SystemInfo {
  platform: NodeJS.Platform;
  arch: string;
  cpus: number;
  memory: number;
  nodeVersion: string;
}

/**
 * Contrato para moléculas de ejecución de comandos del sistema.
 */
export interface ISystem extends IMolecule {
  hasCommand(command: string): Promise<boolean>;
  run(command: string, options?: { cwd?: string; env?: Record<string, string>; timeout?: number }): Promise<CommandResult>;
  runSafe(command: string, options?: any): Promise<CommandResult>;
  getSystemInfo(): SystemInfo;
}

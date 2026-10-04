import { execSync, exec } from "node:child_process";
import { promisify } from "node:util";
import * as os from "node:os";
import type { ISystem } from "./interfaces/ISystem.js";

const execAsync = promisify(exec);

/**
 * Molécula para ejecutar comandos CLI del sistema.
 * Usa esto SOLO cuando no existe una librería NPM estable.
 *
 * Casos de uso válidos:
 * - ffmpeg (conversión de video/audio)
 * - imagemagick (procesamiento de imágenes avanzado)
 * - pandoc (conversión de documentos)
 * - youtube-dl (descarga de videos)
 *
 * EVITAR para: git, npm, aws, gmail (usa moléculas específicas)
 *
 * @example
 * const sys = new SystemMolecule();
 * const output = await sys.run('ffmpeg -version');
 * const exists = await sys.hasCommand('ffmpeg');
 */
export class SystemMolecule implements ISystem {
  readonly name = "system";
  readonly version = "1.0.0";
  /**
   * Verifica si un comando CLI está instalado en el sistema
   */
  async hasCommand(command: string): Promise<boolean> {
    try {
      const checkCmd =
        process.platform === "win32" ? `where ${command}` : `which ${command}`;

      execSync(checkCmd, { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ejecuta un comando de forma síncrona (BLOQUEANTE)
   * Úsalo solo para comandos rápidos (<1 segundo)
   */
  runSync(
    command: string,
    options?: { cwd?: string; env?: Record<string, string> },
  ): string {
    try {
      const output = execSync(command, {
        encoding: "utf-8",
        cwd: options?.cwd,
        env: { ...process.env, ...options?.env },
      });
      console.log(`⚙️ [System] Ejecutado: ${command.substring(0, 50)}...`);
      return output;
    } catch (error: any) {
      throw new Error(
        `❌ [System] Error ejecutando '${command}': ${error.message}`,
      );
    }
  }

  /**
   * Ejecuta un comando de forma asíncrona (NO BLOQUEANTE)
   * Úsalo para comandos lentos o largos
   */
  async run(
    command: string,
    options?: { cwd?: string; env?: Record<string, string>; timeout?: number },
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      const result = await execAsync(command, {
        cwd: options?.cwd,
        env: { ...process.env, ...options?.env },
        timeout: options?.timeout || 60000, // 60 segundos por defecto
      });

      console.log(`⚙️ [System] Ejecutado: ${command.substring(0, 50)}...`);
      return result;
    } catch (error: any) {
      throw new Error(
        `❌ [System] Error ejecutando '${command}':\nSTDOUT: ${error.stdout}\nSTDERR: ${error.stderr}`,
      );
    }
  }

  /**
   * Ejecuta un comando con verificación previa de existencia
   */
  async runSafe(
    command: string,
    options?: any,
  ): Promise<{ stdout: string; stderr: string }> {
    const binary = command.split(" ")[0];

    if (!(await this.hasCommand(binary))) {
      throw new Error(
        `❌ [System] CLI '${binary}' no instalado.\n` +
          `Instala con:\n` +
          `  - macOS: brew install ${binary}\n` +
          `  - Ubuntu: sudo apt install ${binary}\n` +
          `  - Windows: choco install ${binary} (o descarga desde web oficial)`,
      );
    }

    return await this.run(command, options);
  }

  /**
   * Wrapper específico para FFmpeg (conversión de video/audio)
   */
  async ffmpeg(
    inputFile: string,
    outputFile: string,
    options: string = "",
  ): Promise<void> {
    const command = `ffmpeg -i "${inputFile}" ${options} "${outputFile}" -y`;
    await this.runSafe(command);
    console.log(`🎬 [FFmpeg] Convertido: ${inputFile} → ${outputFile}`);
  }

  /**
   * Wrapper específico para ImageMagick (procesamiento de imágenes)
   */
  async imagemagick(
    inputFile: string,
    outputFile: string,
    operations: string,
  ): Promise<void> {
    const command = `convert "${inputFile}" ${operations} "${outputFile}"`;
    await this.runSafe(command);
    console.log(`🖼️ [ImageMagick] Procesado: ${inputFile} → ${outputFile}`);
  }

  /**
   * Wrapper específico para Pandoc (conversión de documentos)
   */
  async pandoc(
    inputFile: string,
    outputFile: string,
    fromFormat?: string,
    toFormat?: string,
  ): Promise<void> {
    let command = `pandoc "${inputFile}"`;

    if (fromFormat) command += ` -f ${fromFormat}`;
    if (toFormat) command += ` -t ${toFormat}`;
    command += ` -o "${outputFile}"`;

    await this.runSafe(command);
    console.log(`📄 [Pandoc] Convertido: ${inputFile} → ${outputFile}`);
  }

  /**
   * Ejecuta múltiples comandos en secuencia
   */
  async runSequence(
    commands: string[],
    stopOnError: boolean = true,
  ): Promise<string[]> {
    const results: string[] = [];

    for (const command of commands) {
      try {
        const result = await this.run(command);
        results.push(result.stdout);
      } catch (error) {
        if (stopOnError) throw error;
        results.push(`ERROR: ${error}`);
      }
    }

    return results;
  }

  /**
   * Ejecuta múltiples comandos en paralelo
   */
  async runParallel(
    commands: string[],
  ): Promise<Array<{ command: string; result?: any; error?: string }>> {
    const promises = commands.map(async (command) => {
      try {
        const result = await this.run(command);
        return { command, result: result.stdout };
      } catch (error: any) {
        return { command, error: error.message };
      }
    });

    return await Promise.all(promises);
  }

  /**
   * Obtiene información del sistema
   */
  getSystemInfo(): {
    platform: NodeJS.Platform;
    arch: string;
    cpus: number;
    memory: number;
    nodeVersion: string;
  } {
    return {
      platform: process.platform,
      arch: process.arch,
      cpus: os.cpus().length,
      memory: Math.round(os.totalmem() / 1024 ** 3), // GB
      nodeVersion: process.version,
    };
  }

  /**
   * Lista comandos disponibles del sistema (común para debug)
   */
  async listAvailableCommands(
    commands: string[],
  ): Promise<Record<string, boolean>> {
    const availability: Record<string, boolean> = {};

    for (const cmd of commands) {
      availability[cmd] = await this.hasCommand(cmd);
    }

    return availability;
  }

  /**
   * Método legacy para compatibilidad (DEPRECATED)
   * @deprecated Usa run() o runSync() en su lugar
   */
  public execute(command: string): string {
    console.log(`⚠️ [System] execute() está deprecado, usa run() o runSync()`);
    return this.runSync(command);
  }
}

import { promises as fs, existsSync } from "node:fs";
import * as path from "node:path";
import type { IFileSystem } from "./interfaces/IFileSystem.js";

/**
 * Molécula para operaciones de sistema de archivos.
 * Wrapper sobre fs/promises con utilidades comunes.
 *
 * @example
 * const fsm = new FileSystemMolecule();
 * await fsm.write('./data.json', JSON.stringify({ test: true }));
 * const content = await fsm.read('./data.json');
 * const files = await fsm.listFiles('./src');
 */
export class FileSystemMolecule implements IFileSystem {
  readonly name = "filesystem";
  readonly version = "1.0.0";
  /**
   * Lee un archivo como texto
   */
  async read(
    filePath: string,
    encoding: BufferEncoding = "utf-8",
  ): Promise<string> {
    try {
      const content = await fs.readFile(filePath, encoding);
      console.log(`📖 [FS] Leído: ${filePath} (${content.length} chars)`);
      return content;
    } catch (error: any) {
      throw new Error(`❌ [FS] Error leyendo ${filePath}: ${error.message}`);
    }
  }

  /**
   * Lee un archivo como buffer binario
   */
  async readBinary(filePath: string): Promise<Buffer> {
    try {
      return await fs.readFile(filePath);
    } catch (error: any) {
      throw new Error(
        `❌ [FS] Error leyendo binario ${filePath}: ${error.message}`,
      );
    }
  }

  /**
   * Escribe contenido en un archivo
   */
  async write(
    filePath: string,
    content: string | Buffer,
    encoding: BufferEncoding = "utf-8",
  ): Promise<void> {
    try {
      // Crea directorio si no existe
      const dir = path.dirname(filePath);
      await this.ensureDir(dir);

      await fs.writeFile(filePath, content, encoding);
      console.log(`✅ [FS] Escrito: ${filePath}`);
    } catch (error: any) {
      throw new Error(
        `❌ [FS] Error escribiendo ${filePath}: ${error.message}`,
      );
    }
  }

  /**
   * Agrega contenido al final de un archivo
   */
  async append(filePath: string, content: string): Promise<void> {
    try {
      await fs.appendFile(filePath, content, "utf-8");
      console.log(`📝 [FS] Agregado a: ${filePath}`);
    } catch (error: any) {
      throw new Error(
        `❌ [FS] Error agregando a ${filePath}: ${error.message}`,
      );
    }
  }

  /**
   * Elimina un archivo
   */
  async delete(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
      console.log(`🗑️ [FS] Eliminado: ${filePath}`);
    } catch (error: any) {
      throw new Error(`❌ [FS] Error eliminando ${filePath}: ${error.message}`);
    }
  }

  /**
   * Verifica si un archivo existe
   */
  exists(filePath: string): boolean {
    return existsSync(filePath);
  }

  /**
   * Lista archivos en un directorio
   */
  async listFiles(
    dirPath: string,
    recursive: boolean = false,
  ): Promise<string[]> {
    try {
      if (recursive) {
        return await this._listFilesRecursive(dirPath);
      }

      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const files = entries
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(dirPath, entry.name));

      console.log(`📂 [FS] ${files.length} archivos en: ${dirPath}`);
      return files;
    } catch (error: any) {
      throw new Error(`❌ [FS] Error listando ${dirPath}: ${error.message}`);
    }
  }

  private async _listFilesRecursive(dirPath: string): Promise<string[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isFile()) {
        files.push(fullPath);
      } else if (entry.isDirectory()) {
        const subFiles = await this._listFilesRecursive(fullPath);
        files.push(...subFiles);
      }
    }

    return files;
  }

  /**
   * Lista directorios en un directorio
   */
  async listDirs(dirPath: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const dirs = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(dirPath, entry.name));

      console.log(`📁 [FS] ${dirs.length} directorios en: ${dirPath}`);
      return dirs;
    } catch (error: any) {
      throw new Error(
        `❌ [FS] Error listando directorios en ${dirPath}: ${error.message}`,
      );
    }
  }

  /**
   * Crea un directorio (y padres si no existen)
   */
  async ensureDir(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error: any) {
      throw new Error(
        `❌ [FS] Error creando directorio ${dirPath}: ${error.message}`,
      );
    }
  }

  /**
   * Copia un archivo
   */
  async copy(source: string, destination: string): Promise<void> {
    try {
      const dir = path.dirname(destination);
      await this.ensureDir(dir);
      await fs.copyFile(source, destination);
      console.log(`📋 [FS] Copiado: ${source} → ${destination}`);
    } catch (error: any) {
      throw new Error(`❌ [FS] Error copiando ${source}: ${error.message}`);
    }
  }

  /**
   * Mueve un archivo
   */
  async move(source: string, destination: string): Promise<void> {
    try {
      const dir = path.dirname(destination);
      await this.ensureDir(dir);
      await fs.rename(source, destination);
      console.log(`🚚 [FS] Movido: ${source} → ${destination}`);
    } catch (error: any) {
      throw new Error(`❌ [FS] Error moviendo ${source}: ${error.message}`);
    }
  }

  /**
   * Lee un archivo JSON y lo parsea
   */
  async readJSON<T = any>(filePath: string): Promise<T> {
    const content = await this.read(filePath);
    try {
      return JSON.parse(content);
    } catch (error: any) {
      throw new Error(`❌ [FS] JSON inválido en ${filePath}: ${error.message}`);
    }
  }

  /**
   * Escribe un objeto como JSON
   */
  async writeJSON(
    filePath: string,
    data: any,
    pretty: boolean = true,
  ): Promise<void> {
    const content = pretty
      ? JSON.stringify(data, null, 2)
      : JSON.stringify(data);
    await this.write(filePath, content);
  }

  /**
   * Obtiene información de un archivo
   */
  async stat(filePath: string) {
    try {
      return await fs.stat(filePath);
    } catch (error: any) {
      throw new Error(
        `❌ [FS] Error obteniendo stats de ${filePath}: ${error.message}`,
      );
    }
  }
}

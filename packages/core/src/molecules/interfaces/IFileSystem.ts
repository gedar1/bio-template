import type { IMolecule } from "./IMolecule.js";

/**
 * Contrato para moléculas de sistema de archivos.
 */
export interface IFileSystem extends IMolecule {
  read(filePath: string, encoding?: BufferEncoding): Promise<string>;
  readBinary(filePath: string): Promise<Buffer>;
  write(filePath: string, content: string | Buffer, encoding?: BufferEncoding): Promise<void>;
  append(filePath: string, content: string): Promise<void>;
  delete(filePath: string): Promise<void>;
  exists(filePath: string): boolean;
  listFiles(dirPath: string, recursive?: boolean): Promise<string[]>;
  listDirs(dirPath: string): Promise<string[]>;
  ensureDir(dirPath: string): Promise<void>;
  copy(source: string, destination: string): Promise<void>;
  move(source: string, destination: string): Promise<void>;
  readJSON<T = any>(filePath: string): Promise<T>;
  writeJSON(filePath: string, data: any, pretty?: boolean): Promise<void>;
}

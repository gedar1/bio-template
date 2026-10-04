import type { IMolecule } from "./IMolecule.js";

/**
 * Contrato para moléculas de control de versiones.
 */
export interface IGit extends IMolecule {
  init(): Promise<void>;
  clone(url: string, destination?: string): Promise<void>;
  add(files?: string | string[]): Promise<void>;
  commit(message: string): Promise<string>;
  push(remote?: string, branch?: string): Promise<void>;
  pull(remote?: string, branch?: string): Promise<void>;
  status(): Promise<any>;
  branches(): Promise<string[]>;
  checkout(branch: string, create?: boolean): Promise<void>;
  log(maxCount?: number): Promise<Array<{ hash: string; message: string; author: string; date: string }>>;
  addRemote(name: string, url: string): Promise<void>;
  quickCommit(message: string, remote?: string, branch?: string): Promise<void>;
}

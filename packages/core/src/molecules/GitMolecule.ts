import { simpleGit, SimpleGit } from "simple-git";
import type { IGit } from "./interfaces/IGit.js";

/**
 * Molécula para operaciones Git.
 * NO requiere git CLI instalado si usas isomorphic-git,
 * pero simple-git es más completo y usa el git nativo.
 *
 * @example
 * const git = new GitMolecule('./my-repo');
 * await git.init();
 * await git.commit('Initial commit');
 * await git.push('origin', 'main');
 */
export class GitMolecule implements IGit {
  readonly name = "git";
  readonly version = "1.0.0";
  readonly git: SimpleGit;
  readonly repoPath: string;

  constructor(repoPath: string = process.cwd()) {
    this.repoPath = repoPath;
    this.git = simpleGit({
      baseDir: repoPath,
      binary: "git",
      maxConcurrentProcesses: 6,
    });
  }

  /**
   * Inicializa un repositorio Git
   */
  async init(): Promise<void> {
    try {
      await this.git.init();
      console.log(`✅ [Git] Repositorio inicializado en: ${this.repoPath}`);
    } catch (error: any) {
      throw new Error(`❌ [Git] Error inicializando: ${error.message}`);
    }
  }

  /**
   * Clona un repositorio
   */
  async clone(url: string, destination?: string): Promise<void> {
    try {
      if (destination) {
        await this.git.clone(url, destination);
      } else {
        await this.git.clone(url);
      }
      console.log(`✅ [Git] Clonado: ${url} → ${destination || this.repoPath}`);
    } catch (error: any) {
      throw new Error(`❌ [Git] Error clonando: ${error.message}`);
    }
  }

  /**
   * Añade archivos al staging
   */
  async add(files: string | string[] = "."): Promise<void> {
    try {
      await this.git.add(files);
      console.log(`📝 [Git] Añadido al stage: ${files}`);
    } catch (error: any) {
      throw new Error(`❌ [Git] Error añadiendo archivos: ${error.message}`);
    }
  }

  /**
   * Hace commit de los cambios
   */
  async commit(message: string): Promise<string> {
    try {
      const result = await this.git.commit(message);
      console.log(
        `✅ [Git] Commit: ${result.commit.substring(0, 7)} - ${message}`,
      );
      return result.commit;
    } catch (error: any) {
      throw new Error(`❌ [Git] Error en commit: ${error.message}`);
    }
  }

  /**
   * Push a un remoto
   */
  async push(
    remote: string = "origin",
    branch: string = "main",
  ): Promise<void> {
    try {
      await this.git.push(remote, branch);
      console.log(`🚀 [Git] Push exitoso: ${remote}/${branch}`);
    } catch (error: any) {
      throw new Error(`❌ [Git] Error en push: ${error.message}`);
    }
  }

  /**
   * Pull desde un remoto
   */
  async pull(
    remote: string = "origin",
    branch: string = "main",
  ): Promise<void> {
    try {
      await this.git.pull(remote, branch);
      console.log(`⬇️ [Git] Pull exitoso: ${remote}/${branch}`);
    } catch (error: any) {
      throw new Error(`❌ [Git] Error en pull: ${error.message}`);
    }
  }

  /**
   * Obtiene el status del repositorio
   */
  async status() {
    try {
      const status = await this.git.status();
      console.log(
        `📊 [Git] Status: ${status.modified.length} modificados, ${status.created.length} nuevos`,
      );
      return status;
    } catch (error: any) {
      throw new Error(`❌ [Git] Error obteniendo status: ${error.message}`);
    }
  }

  /**
   * Obtiene la lista de branches
   */
  async branches(): Promise<string[]> {
    try {
      const result = await this.git.branch();
      return result.all;
    } catch (error: any) {
      throw new Error(`❌ [Git] Error listando branches: ${error.message}`);
    }
  }

  /**
   * Crea y cambia a una nueva branch
   */
  async checkout(branch: string, create: boolean = false): Promise<void> {
    try {
      if (create) {
        await this.git.checkoutLocalBranch(branch);
        console.log(`🌿 [Git] Branch creada y checkout: ${branch}`);
      } else {
        await this.git.checkout(branch);
        console.log(`🌿 [Git] Checkout a: ${branch}`);
      }
    } catch (error: any) {
      throw new Error(`❌ [Git] Error en checkout: ${error.message}`);
    }
  }

  /**
   * Obtiene el log de commits
   */
  async log(maxCount: number = 10) {
    try {
      const log = await this.git.log({ maxCount });
      return log.all.map((commit) => ({
        hash: commit.hash.substring(0, 7),
        message: commit.message,
        author: commit.author_name,
        date: commit.date,
      }));
    } catch (error: any) {
      throw new Error(`❌ [Git] Error obteniendo log: ${error.message}`);
    }
  }

  /**
   * Añade un remoto
   */
  async addRemote(name: string, url: string): Promise<void> {
    try {
      await this.git.addRemote(name, url);
      console.log(`🔗 [Git] Remoto añadido: ${name} → ${url}`);
    } catch (error: any) {
      throw new Error(`❌ [Git] Error añadiendo remoto: ${error.message}`);
    }
  }

  /**
   * Workflow automático: add + commit + push
   */
  async quickCommit(
    message: string,
    remote: string = "origin",
    branch: string = "main",
  ): Promise<void> {
    await this.add(".");
    await this.commit(message);
    await this.push(remote, branch);
    console.log(
      `✅ [Git] Workflow completo: "${message}" → ${remote}/${branch}`,
    );
  }
}

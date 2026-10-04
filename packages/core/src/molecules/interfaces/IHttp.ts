import type { IMolecule } from "./IMolecule.js";

/**
 * Contrato para moléculas de comunicación HTTP.
 */
export interface IHttp extends IMolecule {
  get<T = any>(url: string, config?: any): Promise<T>;
  post<T = any>(url: string, data?: any, config?: any): Promise<T>;
  put<T = any>(url: string, data?: any, config?: any): Promise<T>;
  delete<T = any>(url: string, config?: any): Promise<T>;
  patch<T = any>(url: string, data?: any, config?: any): Promise<T>;
  download(url: string, outputPath: string): Promise<void>;
  upload(url: string, filePath: string, fieldName?: string): Promise<any>;
}

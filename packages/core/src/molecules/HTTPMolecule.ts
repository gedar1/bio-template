import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { promises as fs } from "node:fs";
import FormData from "form-data";
import type { IHttp } from "./interfaces/IHttp.js";

/**
 * Molécula agnóstica para operaciones HTTP.
 * Wrapper sobre Axios con manejo de errores, retry y timeouts.
 *
 * @example
 * const http = new HTTPMolecule();
 * const data = await http.get('https://api.example.com/users');
 * await http.post('https://api.example.com/users', { name: 'John' });
 */
export class HTTPMolecule implements IHttp {
  readonly name = "http";
  readonly version = "1.0.0";
  readonly client: AxiosInstance;

  constructor(baseURL?: string, timeout: number = 30000) {
    this.client = axios.create({
      baseURL,
      timeout,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "BioCore/1.0",
      },
    });

    // Interceptor para logging
    this.client.interceptors.request.use(
      (config) => {
        console.log(`🌐 [HTTP] ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => Promise.reject(error),
    );

    // Interceptor para manejo de errores
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response) {
          throw new Error(
            `❌ [HTTP ${error.response.status}] ${error.response.statusText}: ${JSON.stringify(error.response.data)}`,
          );
        } else if (error.request) {
          throw new Error(
            `❌ [HTTP] Sin respuesta del servidor: ${error.message}`,
          );
        } else {
          throw new Error(`❌ [HTTP] Error de configuración: ${error.message}`);
        }
      },
    );
  }

  /**
   * GET request
   */
  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.client.get(url, config);
    return response.data;
  }

  /**
   * POST request
   */
  async post<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const response: AxiosResponse<T> = await this.client.post(
      url,
      data,
      config,
    );
    return response.data;
  }

  /**
   * PUT request
   */
  async put<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const response: AxiosResponse<T> = await this.client.put(url, data, config);
    return response.data;
  }

  /**
   * DELETE request
   */
  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.client.delete(url, config);
    return response.data;
  }

  /**
   * PATCH request
   */
  async patch<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const response: AxiosResponse<T> = await this.client.patch(
      url,
      data,
      config,
    );
    return response.data;
  }

  /**
   * Descarga archivos binarios
   */
  async download(url: string, outputPath: string): Promise<void> {
    const response = await this.client.get(url, {
      responseType: "arraybuffer",
    });
    await fs.writeFile(outputPath, response.data);
    console.log(`✅ [HTTP] Archivo descargado: ${outputPath}`);
  }

  /**
   * Upload de archivos
   */
  async upload(
    url: string,
    filePath: string,
    fieldName: string = "file",
  ): Promise<any> {
    const form = new FormData();
    const fileBuffer = await fs.readFile(filePath);
    form.append(fieldName, fileBuffer, filePath.split("/").pop());

    return await this.post(url, form, {
      headers: form.getHeaders(),
    });
  }

  /**
   * Retry automático con backoff exponencial
   */
  async getWithRetry<T = any>(
    url: string,
    maxRetries: number = 3,
    backoffMs: number = 1000,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.get<T>(url);
      } catch (error: any) {
        lastError = error;
        if (attempt < maxRetries) {
          const delay = backoffMs * Math.pow(2, attempt - 1);
          console.log(
            `⚠️ [HTTP] Reintento ${attempt}/${maxRetries} en ${delay}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error("Max retries alcanzados");
  }
}

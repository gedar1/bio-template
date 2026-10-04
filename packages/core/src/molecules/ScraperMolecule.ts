import axios from "axios";
import * as cheerio from "cheerio";
import type { IScraper } from "./interfaces/IScraper.js";
import { createLogger } from "../config/logger.js";

const log = createLogger("Scraper");

/**
 * Molécula para web scraping.
 * Usa Cheerio (parser DOM ligero tipo jQuery) + Axios.
 * NO requiere CLIs instalados, es NPM puro.
 *
 * @example
 * const scraper = new ScraperMolecule();
 * const data = await scraper.scrape('https://example.com', {
 *   title: 'h1',
 *   links: { selector: 'a', attr: 'href', multiple: true }
 * });
 */
export class ScraperMolecule implements IScraper {
  readonly name = "scraper";
  readonly version = "1.0.0";
  readonly userAgent: string;

  constructor(userAgent?: string) {
    this.userAgent =
      userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) BioCore/1.0";
  }

  /**
   * Obtiene el HTML de una URL con retry automático y backoff exponencial.
   */
  async fetchHTML(
    url: string,
    headers?: Record<string, string>,
    maxRetries: number = 3,
  ): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios.get(url, {
          headers: {
            "User-Agent": this.userAgent,
            ...headers,
          },
          timeout: 30000,
        });
        log.info({ url, chars: response.data.length }, "HTML obtenido");
        return response.data;
      } catch (error: any) {
        lastError = error;
        if (attempt < maxRetries) {
          const delay = 1000 * Math.pow(2, attempt - 1);
          log.warn({ url, attempt, maxRetries, delay }, "Reintentando fetch");
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    throw new Error(`❌ [Scraper] Error fetching ${url} tras ${maxRetries} intentos: ${lastError?.message}`);
  }

  /**
   * Extrae datos usando selectores CSS
   */
  async scrape(
    url: string,
    schema: Record<
      string,
      string | { selector: string; attr?: string; multiple?: boolean }
    >,
  ): Promise<Record<string, any>> {
    const html = await this.fetchHTML(url);
    const $ = cheerio.load(html);
    const result: Record<string, any> = {};

    // Sin schema: extraer título y texto completo como fallback
    if (Object.keys(schema).length === 0) {
      result.title = $("title").text().trim() || $("h1").first().text().trim();
      result.content = $("body").text().replace(/\s+/g, " ").trim().slice(0, 5000);
      result.url = url;
      console.log(`✅ [Scraper] Contenido completo extraído de ${url}`);
      return result;
    }

    for (const [key, config] of Object.entries(schema)) {
      if (typeof config === "string") {
        // Simple: 'title': 'h1'
        result[key] = $(config).first().text().trim();
      } else {
        // Avanzado: { selector: 'a', attr: 'href', multiple: true }
        const { selector, attr, multiple } = config;

        if (multiple) {
          result[key] = $(selector)
            .map((_, el) => {
              return attr ? $(el).attr(attr) : $(el).text().trim();
            })
            .get();
        } else {
          const element = $(selector).first();
          result[key] = attr ? element.attr(attr) : element.text().trim();
        }
      }
    }

    console.log(`✅ [Scraper] Datos extraídos de ${url}:`, Object.keys(result));
    return result;
  }

  /**
   * Extrae todos los links de una página
   */
  async extractLinks(
    url: string,
    filter?: (href: string) => boolean,
  ): Promise<string[]> {
    const html = await this.fetchHTML(url);
    const $ = cheerio.load(html);

    let links = $("a")
      .map((_, el) => $(el).attr("href"))
      .get()
      .filter((href) => href && href.trim() !== "");

    // Convierte links relativos a absolutos
    const baseURL = new URL(url);
    links = links.map((href) => {
      try {
        return new URL(href, baseURL).href;
      } catch {
        return href;
      }
    });

    // Aplica filtro opcional
    if (filter) {
      links = links.filter(filter);
    }

    console.log(`🔗 [Scraper] ${links.length} links extraídos de ${url}`);
    return links;
  }

  /**
   * Extrae todas las imágenes de una página
   */
  async extractImages(
    url: string,
  ): Promise<Array<{ src: string; alt?: string }>> {
    const html = await this.fetchHTML(url);
    const $ = cheerio.load(html);
    const baseURL = new URL(url);

    const images = $("img")
      .map((_, el) => {
        const src = $(el).attr("src");
        const alt = $(el).attr("alt");

        if (!src) return null;

        try {
          return {
            src: new URL(src, baseURL).href,
            alt: alt,
          };
        } catch {
          return null;
        }
      })
      .get()
      .filter(
        (img): img is { src: string; alt: string | undefined } => img !== null,
      );

    console.log(`🖼️ [Scraper] ${images.length} imágenes extraídas de ${url}`);
    return images;
  }

  /**
   * Extrae metadata de la página (Open Graph, Twitter Cards, etc.)
   */
  async extractMetadata(url: string): Promise<Record<string, string>> {
    const html = await this.fetchHTML(url);
    const $ = cheerio.load(html);
    const metadata: Record<string, string> = {};

    // Open Graph tags
    $('meta[property^="og:"]').each((_, el) => {
      const property = $(el).attr("property");
      const content = $(el).attr("content");
      if (property && content) {
        metadata[property.replace("og:", "")] = content;
      }
    });

    // Twitter Card tags
    $('meta[name^="twitter:"]').each((_, el) => {
      const name = $(el).attr("name");
      const content = $(el).attr("content");
      if (name && content) {
        metadata[name.replace("twitter:", "twitter_")] = content;
      }
    });

    // Meta tags básicos
    metadata.title = $("title").text().trim() || metadata.title;
    metadata.description =
      $('meta[name="description"]').attr("content") || metadata.description;

    console.log(
      `📋 [Scraper] Metadata extraída de ${url}:`,
      Object.keys(metadata),
    );
    return metadata;
  }

  /**
   * Extrae texto plano de una página (sin HTML)
   */
  async extractText(url: string, selector: string = "body"): Promise<string> {
    const html = await this.fetchHTML(url);
    const $ = cheerio.load(html);

    // Remueve scripts y estilos
    $("script, style").remove();

    const text = $(selector)
      .text()
      .replaceAll(/\s+/g, " ") // Normaliza espacios
      .trim();

    console.log(`📄 [Scraper] Texto extraído: ${text.length} caracteres`);
    return text;
  }

  /**
   * Scraping con paginación automática
   */
  async scrapeMultiplePages(
    startUrl: string,
    schema: Record<string, any>,
    nextPageSelector: string,
    maxPages: number = 10,
  ): Promise<any[]> {
    const results: any[] = [];
    let currentUrl: string | null = startUrl;
    let pageCount = 0;

    while (currentUrl && pageCount < maxPages) {
      console.log(
        `📃 [Scraper] Página ${pageCount + 1}/${maxPages}: ${currentUrl}`,
      );

      const pageData = await this.scrape(currentUrl, schema);
      results.push(pageData);

      // Busca el link de siguiente página
      const html = await this.fetchHTML(currentUrl);
      const $ = cheerio.load(html);
      const nextLink = $(nextPageSelector).attr("href");

      currentUrl = nextLink ? new URL(nextLink, currentUrl).href : null;
      pageCount++;
    }

    console.log(`✅ [Scraper] ${results.length} páginas scrapeadas`);
    return results;
  }
}

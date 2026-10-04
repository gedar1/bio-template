import type { IMolecule } from "./IMolecule.js";

export type ScraperSchemaValue = string | {
  selector: string;
  attr?: string;
  multiple?: boolean;
};

/**
 * Contrato para moléculas de web scraping.
 */
export interface IScraper extends IMolecule {
  fetchHTML(url: string, headers?: Record<string, string>): Promise<string>;
  scrape(url: string, schema: Record<string, ScraperSchemaValue>): Promise<Record<string, any>>;
  extractLinks(url: string, filter?: (href: string) => boolean): Promise<string[]>;
  extractImages(url: string): Promise<Array<{ src: string; alt?: string }>>;
  extractMetadata(url: string): Promise<Record<string, string>>;
  extractText(url: string, selector?: string): Promise<string>;
}

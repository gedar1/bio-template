import type { IMolecule } from "./IMolecule.js";

export interface EmailOptions {
  to: string | string[];
  subject: string;
  body: string;
  isHTML?: boolean;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: Array<{ filename: string; path: string }>;
}

export interface BulkResult {
  sent: string[];
  failed: string[];
}

/**
 * Contrato para moléculas de envío de email.
 */
export interface IGmail extends IMolecule {
  connect(): Promise<void>;
  sendEmail(options: EmailOptions): Promise<void>;
  sendTemplate(to: string, subject: string, variables: Record<string, string>, template?: string): Promise<void>;
  sendBulk(recipients: string[], subject: string, body: string): Promise<BulkResult>;
}

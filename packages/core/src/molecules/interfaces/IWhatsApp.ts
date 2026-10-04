import type { IMolecule } from "./IMolecule.js";

export interface WhatsAppMessage {
  to: string;       // Número con código de país (ej: +573001234567)
  body: string;
}

export interface WhatsAppResult {
  sid: string;
  status: string;
}

/**
 * Contrato para moléculas de WhatsApp.
 */
export interface IWhatsApp extends IMolecule {
  sendMessage(options: WhatsAppMessage): Promise<WhatsAppResult>;
  sendBulk(recipients: string[], body: string): Promise<{ sent: string[]; failed: string[] }>;
}

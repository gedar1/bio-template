import { createLogger } from "../config/logger.js";
import { MoleculeError } from "../errors.js";
import type {
  IWhatsApp,
  WhatsAppMessage,
  WhatsAppResult,
} from "./interfaces/IWhatsApp.js";

const log = createLogger("WhatsApp");

/**
 * Molécula para envío de mensajes WhatsApp via Twilio.
 *
 * Configuración (.env):
 * TWILIO_ACCOUNT_SID=ACxxxxx
 * TWILIO_AUTH_TOKEN=xxxxx
 * TWILIO_WHATSAPP_FROM=whatsapp:+14155238886  (número de Twilio sandbox o propio)
 *
 * Para sandbox de pruebas:
 * 1. Ve a https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn
 * 2. Envía "join <sandbox-word>" desde tu WhatsApp al número de Twilio
 * 3. Usa ese número como TWILIO_WHATSAPP_FROM
 */
export class WhatsAppMolecule implements IWhatsApp {
  readonly name = "whatsapp";
  readonly version = "1.0.0";

  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly fromNumber: string;
  private readonly baseUrl: string;

  constructor() {
    this.accountSid = process.env.TWILIO_ACCOUNT_SID || "";
    this.authToken = process.env.TWILIO_AUTH_TOKEN || "";
    this.fromNumber = process.env.TWILIO_WHATSAPP_FROM || "";

    if (!this.accountSid || !this.authToken) {
      throw new MoleculeError(
        "whatsapp",
        "TWILIO_ACCOUNT_SID y TWILIO_AUTH_TOKEN requeridos en .env",
      );
    }

    this.baseUrl = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    log.info("WhatsApp configurado via Twilio");
  }

  async sendMessage(options: WhatsAppMessage): Promise<WhatsAppResult> {
    const to = options.to.startsWith("whatsapp:")
      ? options.to
      : `whatsapp:${options.to}`;
    const from = this.fromNumber.startsWith("whatsapp:")
      ? this.fromNumber
      : `whatsapp:${this.fromNumber}`;

    try {
      const params = new URLSearchParams({
        To: to,
        From: from,
        Body: options.body,
      });

      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${this.accountSid}:${this.authToken}`).toString(
              "base64",
            ),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new MoleculeError(
          "whatsapp",
          `Twilio error: ${data.message || response.statusText}`,
          { status: response.status },
        );
      }

      log.info({ to: options.to, sid: data.sid }, "Mensaje WhatsApp enviado");
      return { sid: data.sid, status: data.status };
    } catch (error: any) {
      if (error instanceof MoleculeError) throw error;
      throw new MoleculeError(
        "whatsapp",
        `Error enviando WhatsApp: ${error.message}`,
        { to: options.to },
      );
    }
  }

  async sendBulk(
    recipients: string[],
    body: string,
  ): Promise<{ sent: string[]; failed: string[] }> {
    const results = { sent: [] as string[], failed: [] as string[] };

    for (const to of recipients) {
      try {
        await this.sendMessage({ to, body });
        results.sent.push(to);
      } catch (error: any) {
        log.warn({ to, error: error.message }, "Fallo enviando WhatsApp");
        results.failed.push(to);
      }
    }

    log.info(
      { sent: results.sent.length, failed: results.failed.length },
      "Bulk WhatsApp completado",
    );
    return results;
  }
}

import nodemailer, { Transporter } from "nodemailer";
import type { IGmail, EmailOptions, BulkResult } from "./interfaces/IGmail.js";

/**
 * Molécula para envío de emails a través de Gmail.
 * NO requiere CLI instalado, usa nodemailer (librería NPM).
 *
 * Configuración (archivo .env):
 * GMAIL_USER=tu-email@gmail.com
 * GMAIL_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
 *
 * Para obtener App Password:
 * 1. Ve a https://myaccount.google.com/security
 * 2. Activa "Verificación en 2 pasos"
 * 3. Ve a "Contraseñas de aplicaciones" y genera una
 *
 * @example
 * const gmail = new GmailMolecule();
 * await gmail.sendEmail({
 *   to: 'user@example.com',
 *   subject: 'Test',
 *   body: '<h1>Hello</h1>'
 * });
 */
export class GmailMolecule implements IGmail {
  readonly name = "gmail";
  readonly version = "1.0.0";
  private transporter: Transporter | null = null;
  readonly gmailUser: string;

  constructor() {
    this.gmailUser = process.env.GMAIL_USER || "";

    if (!this.gmailUser) {
      throw new Error("❌ [Gmail] GMAIL_USER no configurado en .env");
    }

    if (!process.env.GMAIL_APP_PASSWORD) {
      throw new Error("❌ [Gmail] GMAIL_APP_PASSWORD no configurado en .env");
    }
  }

  /**
   * Inicializa el transporter de Gmail
   */
  async connect(): Promise<void> {
    try {
      this.transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: this.gmailUser,
          pass: process.env.GMAIL_APP_PASSWORD,
        },
      });

      // Verifica la conexión
      await this.transporter.verify();
      console.log(`✅ [Gmail] Conectado como: ${this.gmailUser}`);
    } catch (error: any) {
      throw new Error(`❌ [Gmail] Error de conexión: ${error.message}`);
    }
  }

  /**
   * Envía un email
   */
  async sendEmail(options: EmailOptions): Promise<void> {
    if (!this.transporter) {
      await this.connect();
    }

    try {
      const result = await this.transporter!.sendMail({
        from: this.gmailUser,
        to: Array.isArray(options.to) ? options.to.join(", ") : options.to,
        cc: options.cc,
        bcc: options.bcc,
        subject: options.subject,
        [options.isHTML === false ? "text" : "html"]: options.body,
        attachments: options.attachments,
      });

      console.log(
        `📧 [Gmail] Email enviado: ${result.messageId} → ${options.to}`,
      );
    } catch (error: any) {
      throw new Error(`❌ [Gmail] Error enviando email: ${error.message}`);
    }
  }

  /**
   * Envía un email con plantilla simple
   */
  async sendTemplate(
    to: string,
    subject: string,
    variables: Record<string, string>,
    template: string = "default",
  ): Promise<void> {
    const templates: Record<string, string> = {
      default: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>{{title}}</h2>
          <p>{{message}}</p>
          <hr>
          <small>Enviado por BioCore System</small>
        </div>
      `,
      alert: `
        <div style="background: #fff3cd; border: 2px solid #ffc107; padding: 20px; border-radius: 5px;">
          <h3 style="color: #856404;">⚠️ {{title}}</h3>
          <p>{{message}}</p>
        </div>
      `,
    };

    let html = templates[template] || templates.default;

    // Reemplaza variables
    Object.entries(variables).forEach(([key, value]) => {
      html = html.replaceAll(new RegExp(`{{${key}}}`, "g"), value);
    });

    await this.sendEmail({ to, subject, body: html, isHTML: true });
  }

  /**
   * Envía email con lista de destinatarios
   */
  async sendBulk(
    recipients: string[],
    subject: string,
    body: string,
  ): Promise<BulkResult> {
    const results: BulkResult = { sent: [], failed: [] };

    for (const recipient of recipients) {
      try {
        await this.sendEmail({ to: recipient, subject, body });
        results.sent.push(recipient);
      } catch (error: any) {
        console.error(
          `⚠️ [Gmail] Fallo enviando a ${recipient}: ${error.message}`,
        );
        results.failed.push(recipient);
      }
    }

    console.log(
      `📊 [Gmail] Bulk: ${results.sent.length} enviados, ${results.failed.length} fallidos`,
    );
    return results;
  }
}

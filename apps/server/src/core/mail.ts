import { Global, Injectable, Logger, Module, type OnModuleInit } from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";
import { config } from "./config";
import { JobsService } from "./jobs/jobs.service";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Minimal branded template: a paragraph and one call-to-action button. */
export function actionEmail(opts: { to: string; subject: string; intro: string; action: string; url: string; outro?: string }): Mail {
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#f6f7fb;padding:24px">
<div style="max-width:520px;margin:auto;background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e7eb">
<p style="font-weight:600;font-size:18px;margin:0 0 16px">Flowboard</p>
<p style="color:#374151;line-height:1.6">${esc(opts.intro)}</p>
<p style="margin:24px 0"><a href="${esc(opts.url)}" style="background:#6366f1;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${esc(opts.action)}</a></p>
<p style="color:#6b7280;font-size:13px;line-height:1.6">${esc(opts.outro ?? "If you didn't expect this email, you can ignore it.")}<br>Link: ${esc(opts.url)}</p>
</div></body></html>`;
  return { to: opts.to, subject: opts.subject, html, text: `${opts.intro}\n\n${opts.action}: ${opts.url}\n\n${opts.outro ?? ""}` };
}

/**
 * Emails are queued as jobs (retries, doesn't block requests). Without SMTP_URL they're printed to
 * the console and kept in `outbox` so dev and tests can follow links.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger("Mail");
  private transport: Transporter | null = null;
  readonly outbox: Mail[] = [];

  constructor(private readonly jobs: JobsService) {}

  onModuleInit() {
    const url = config().SMTP_URL;
    if (url) this.transport = nodemailer.createTransport(url);
    this.jobs.register("mail.send", (payload) => this.deliver(payload as unknown as Mail));
  }

  send(mail: Mail) {
    return this.jobs.enqueue("mail.send", mail as unknown as Record<string, unknown>, { maxAttempts: 5 });
  }

  private async deliver(mail: Mail) {
    this.outbox.push(mail);
    if (this.outbox.length > 100) this.outbox.shift();
    if (!this.transport) {
      this.logger.log(`\n  To: ${mail.to}\n  Subject: ${mail.subject}\n  ${mail.text.replace(/\n/g, "\n  ")}`);
      return;
    }
    await this.transport.sendMail({ from: config().MAIL_FROM, ...mail });
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}

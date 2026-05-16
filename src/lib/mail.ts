/**
 * SMTP メール送信（問い合わせ通知など）
 * DAIKO_SMTP_HOST が未設定のときはログのみ（開発用）
 */
import {
  applyInquiryTemplate,
  getInquiryAutoReplyTemplate,
  type InquiryTemplateVars,
} from "./platform-settings.js";

export type SendMailInput = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
};

function smtpConfig(): {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
} | null {
  const host = process.env.DAIKO_SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number(process.env.DAIKO_SMTP_PORT ?? 587);
  const secureFlag = (process.env.DAIKO_SMTP_SECURE ?? "").trim().toLowerCase();
  const secure = secureFlag === "1" || secureFlag === "true" || secureFlag === "yes" || port === 465;
  const user = process.env.DAIKO_SMTP_USER?.trim() || undefined;
  const pass = process.env.DAIKO_SMTP_PASS?.trim() || undefined;
  const from = process.env.DAIKO_SMTP_FROM?.trim() || user || "noreply@daiko.local";
  return { host, port, secure, user, pass, from };
}

export function inquiryNotifyRecipients(): string[] {
  const raw = process.env.DAIKO_INQUIRY_NOTIFY_TO ?? process.env.DAIKO_PLATFORM_ADMIN_EMAILS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function sendMail(input: SendMailInput): Promise<{ sent: boolean; reason?: string }> {
  const cfg = smtpConfig();
  const toList = Array.isArray(input.to) ? input.to : [input.to];
  if (toList.length === 0) {
    return { sent: false, reason: "no recipients" };
  }

  if (!cfg) {
    console.info("[mail] SMTP not configured (DAIKO_SMTP_HOST). Would send:", {
      to: toList,
      subject: input.subject,
      preview: input.text.slice(0, 200),
    });
    return { sent: false, reason: "smtp not configured" };
  }

  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user && cfg.pass ? { user: cfg.user, pass: cfg.pass } : undefined,
  });

  await transport.sendMail({
    from: cfg.from,
    to: toList.join(", "),
    subject: input.subject,
    text: input.text,
    html: input.html,
  });

  return { sent: true };
}

export function plainTextToHtml(text: string): string {
  const escaped = text.replace(/</g, "&lt;");
  return `<pre style="font-family:sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap;margin:0">${escaped}</pre>`;
}

export async function buildInquiryAutoReplyMail(
  vars: InquiryTemplateVars,
): Promise<{ subject: string; text: string; html: string }> {
  const tpl = await getInquiryAutoReplyTemplate();
  const subject = applyInquiryTemplate(tpl.subject, vars);
  const text = applyInquiryTemplate(tpl.body, vars);
  return { subject, text, html: plainTextToHtml(text) };
}

export function buildPlainMail(subject: string, text: string): { subject: string; text: string; html: string } {
  return { subject, text, html: plainTextToHtml(text) };
}

export function formatInquiryMailBody(p: {
  companyName: string;
  contactName: string;
  email: string;
  phone: string | null;
  message: string;
  id: string;
  createdAt: Date;
}): { subject: string; text: string; html: string } {
  const when = p.createdAt.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const subject = `【Daiko】お問い合わせ: ${p.companyName}`;
  const lines = [
    "紹介LPからお問い合わせがありました。",
    "",
    `ID: ${p.id}`,
    `日時: ${when}`,
    `店舗・会社名: ${p.companyName}`,
    `お名前: ${p.contactName}`,
    `メール: ${p.email}`,
    `電話: ${p.phone || "（未入力）"}`,
    "",
    "お問い合わせ内容:",
    p.message,
    "",
    "管理画面で確認: /app/platform/inquiries",
  ];
  const text = lines.join("\n");
  const html = `<pre style="font-family:sans-serif;font-size:14px;line-height:1.6">${lines
    .map((l) => l.replace(/</g, "&lt;"))
    .join("\n")}</pre>`;
  return { subject, text, html };
}

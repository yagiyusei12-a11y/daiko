/**
 * SMTP メール送信（問い合わせ通知など）
 * DAIKO_SMTP_HOST が未設定のときはログのみ（開発用）
 */

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

export function formatInquiryAutoReplyMailBody(p: {
  contactName: string;
  companyName: string;
}): { subject: string; text: string; html: string } {
  const subject = "【Daiko】お問い合わせを受け付けました";
  const lines = [
    `${p.contactName} 様`,
    "",
    "この度は Daiko へお問い合わせいただき、誠にありがとうございます。",
    "以下の内容でお問い合わせを受け付けました。",
    "",
    `店舗・会社名: ${p.companyName}`,
    "",
    "担当者より順次ご連絡いたしますので、今しばらくお待ちください。",
    "※ 本メールは送信専用です。返信いただいてもお答えできない場合があります。",
    "",
    "――――――――――――――――――",
    "Daiko（代行管理システム）",
  ];
  const text = lines.join("\n");
  const html = `<div style="font-family:sans-serif;font-size:14px;line-height:1.8;color:#333">
<p>${p.contactName.replace(/</g, "&lt;")} 様</p>
<p>この度は Daiko へお問い合わせいただき、誠にありがとうございます。<br>以下の内容でお問い合わせを受け付けました。</p>
<p><strong>店舗・会社名:</strong> ${p.companyName.replace(/</g, "&lt;")}</p>
<p>担当者より順次ご連絡いたしますので、今しばらくお待ちください。</p>
<p style="font-size:12px;color:#666">※ 本メールは送信専用です。返信いただいてもお答えできない場合があります。</p>
<hr style="border:none;border-top:1px solid #ddd;margin:24px 0">
<p style="font-size:12px;color:#888">Daiko（代行管理システム）</p>
</div>`;
  return { subject, text, html };
}

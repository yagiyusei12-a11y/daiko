import { prisma } from "../db.js";

export const PLATFORM_SETTING_KEYS = {
  inquiryAutoReplySubject: "inquiry_auto_reply_subject",
  inquiryAutoReplyBody: "inquiry_auto_reply_body",
} as const;

export const INQUIRY_AUTO_REPLY_PLACEHOLDERS = [
  { tag: "{{contactName}}", label: "お名前", description: "フォームの「お名前」" },
  { tag: "{{companyName}}", label: "店舗・会社名", description: "フォームの「店舗・会社名」" },
  { tag: "{{email}}", label: "メールアドレス", description: "フォームのメールアドレス" },
  { tag: "{{phone}}", label: "電話番号", description: "未入力のときは空文字" },
  { tag: "{{message}}", label: "お問い合わせ内容", description: "フォームの本文（改行そのまま）" },
  { tag: "{{inquiryId}}", label: "受付ID", description: "システム内部の問い合わせID" },
  {
    tag: "{{submittedAt}}",
    label: "受付日時",
    description: "日本時間（例: 2026/5/16 19:30:00）",
  },
] as const;

export const DEFAULT_INQUIRY_AUTO_REPLY_SUBJECT = "【Daiko】お問い合わせを受け付けました";

export const DEFAULT_INQUIRY_AUTO_REPLY_BODY = [
  "{{contactName}} 様",
  "",
  "この度は Daiko へお問い合わせいただき、誠にありがとうございます。",
  "以下の内容でお問い合わせを受け付けました。",
  "",
  "店舗・会社名: {{companyName}}",
  "メール: {{email}}",
  "電話: {{phone}}",
  "",
  "お問い合わせ内容:",
  "{{message}}",
  "",
  "受付番号: {{inquiryId}}",
  "受付日時: {{submittedAt}}",
  "",
  "担当者より順次ご連絡いたしますので、今しばらくお待ちください。",
  "※ 本メールは送信専用です。返信いただいてもお答えできない場合があります。",
  "",
  "――――――――――――――――――",
  "Daiko（代行管理システム）",
].join("\n");

export type InquiryTemplateVars = {
  contactName: string;
  companyName: string;
  email: string;
  phone: string;
  message: string;
  inquiryId: string;
  submittedAt: string;
};

export function buildInquiryTemplateVars(p: {
  contactName: string;
  companyName: string;
  email: string;
  phone: string | null;
  message: string;
  inquiryId: string;
  createdAt: Date;
}): InquiryTemplateVars {
  return {
    contactName: p.contactName,
    companyName: p.companyName,
    email: p.email,
    phone: p.phone?.trim() ?? "",
    message: p.message,
    inquiryId: p.inquiryId,
    submittedAt: p.createdAt.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }),
  };
}

export function applyInquiryTemplate(template: string, vars: InquiryTemplateVars): string {
  const replacements: Record<string, string> = {
    "{{contactName}}": vars.contactName,
    "{{companyName}}": vars.companyName,
    "{{email}}": vars.email,
    "{{phone}}": vars.phone,
    "{{message}}": vars.message,
    "{{inquiryId}}": vars.inquiryId,
    "{{submittedAt}}": vars.submittedAt,
  };
  let out = template;
  for (const [tag, value] of Object.entries(replacements)) {
    out = out.split(tag).join(value);
  }
  return out;
}

export function defaultInquiryReplySubject(companyName: string): string {
  return `Re: 【Daiko】お問い合わせ: ${companyName}`;
}

export async function getPlatformSetting(key: string): Promise<string | null> {
  const row = await prisma.platformSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function upsertPlatformSetting(
  key: string,
  value: string,
  updatedBy?: string,
): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key },
    create: { key, value, updatedBy: updatedBy ?? null },
    update: { value, updatedBy: updatedBy ?? null },
  });
}

export async function getInquiryAutoReplyTemplate(): Promise<{ subject: string; body: string }> {
  const [subjectRaw, bodyRaw] = await Promise.all([
    getPlatformSetting(PLATFORM_SETTING_KEYS.inquiryAutoReplySubject),
    getPlatformSetting(PLATFORM_SETTING_KEYS.inquiryAutoReplyBody),
  ]);
  return {
    subject: subjectRaw?.trim() || DEFAULT_INQUIRY_AUTO_REPLY_SUBJECT,
    body: bodyRaw?.trim() || DEFAULT_INQUIRY_AUTO_REPLY_BODY,
  };
}

export async function seedPlatformSettingsDefaults(): Promise<void> {
  const pairs: Array<[string, string]> = [
    [PLATFORM_SETTING_KEYS.inquiryAutoReplySubject, DEFAULT_INQUIRY_AUTO_REPLY_SUBJECT],
    [PLATFORM_SETTING_KEYS.inquiryAutoReplyBody, DEFAULT_INQUIRY_AUTO_REPLY_BODY],
  ];
  for (const [key, value] of pairs) {
    const existing = await prisma.platformSetting.findUnique({ where: { key } });
    if (!existing) {
      await prisma.platformSetting.create({ data: { key, value } });
    }
  }
}

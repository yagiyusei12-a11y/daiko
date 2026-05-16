import { prisma } from "../db.js";

export const PLATFORM_SETTING_KEYS = {
  inquiryAutoReplySubject: "inquiry_auto_reply_subject",
  inquiryAutoReplyBody: "inquiry_auto_reply_body",
} as const;

export const DEFAULT_INQUIRY_AUTO_REPLY_SUBJECT = "【Daiko】お問い合わせを受け付けました";

export const DEFAULT_INQUIRY_AUTO_REPLY_BODY = [
  "{{contactName}} 様",
  "",
  "この度は Daiko へお問い合わせいただき、誠にありがとうございます。",
  "以下の内容でお問い合わせを受け付けました。",
  "",
  "店舗・会社名: {{companyName}}",
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
};

export function applyInquiryTemplate(template: string, vars: InquiryTemplateVars): string {
  return template
    .replace(/\{\{contactName\}\}/g, vars.contactName)
    .replace(/\{\{companyName\}\}/g, vars.companyName);
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

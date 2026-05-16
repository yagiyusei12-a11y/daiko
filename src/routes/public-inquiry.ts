/**
 * 紹介LPお問い合わせ（JWT 認証なし）
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import {
  formatInquiryAutoReplyMailBody,
  formatInquiryMailBody,
  inquiryNotifyRecipients,
  sendMail,
} from "../lib/mail.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type RateBucket = { hits: number[] };
const ipBuckets = new Map<string, RateBucket>();
const IP_RATE_WINDOW_MS = 60 * 1000;
const IP_RATE_MAX_POST = 5;

function clientIp(req: FastifyRequest): string {
  return (req.ip || "unknown").toString();
}

function checkIpRateLimit(ip: string, now: number): boolean {
  const bucket = ipBuckets.get(ip) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < IP_RATE_WINDOW_MS);
  if (bucket.hits.length >= IP_RATE_MAX_POST) {
    ipBuckets.set(ip, bucket);
    return false;
  }
  bucket.hits.push(now);
  ipBuckets.set(ip, bucket);
  return true;
}

function trimStr(raw: unknown, max: number): string {
  return String(raw ?? "")
    .trim()
    .slice(0, max);
}

export async function registerPublicInquiryRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: Record<string, unknown> }>("/inquiry", async (req, reply) => {
    const now = Date.now();
    const ip = clientIp(req);
    if (!checkIpRateLimit(ip, now)) {
      return reply.code(429).send({ error: "送信回数が多すぎます。しばらくしてから再度お試しください。" });
    }

    const body = req.body || {};
    const website = trimStr(body.website, 200);
    if (website) {
      return { ok: true };
    }

    const companyName = trimStr(body.companyName, 120);
    const contactName = trimStr(body.contactName, 80);
    const email = trimStr(body.email, 254).toLowerCase();
    const phone = trimStr(body.phone, 30) || null;
    const message = trimStr(body.message, 4000);
    const privacyAgreed = Boolean(body.privacyAgreed);

    if (!companyName) return reply.code(400).send({ error: "店舗・会社名を入力してください" });
    if (!contactName) return reply.code(400).send({ error: "お名前を入力してください" });
    if (!email || !EMAIL_RE.test(email)) {
      return reply.code(400).send({ error: "メールアドレスの形式が正しくありません" });
    }
    if (!message) return reply.code(400).send({ error: "お問い合わせ内容を入力してください" });
    if (!privacyAgreed) {
      return reply.code(400).send({ error: "個人情報の取り扱いへの同意が必要です" });
    }

    const ua = String(req.headers["user-agent"] ?? "").slice(0, 500) || null;

    const row = await prisma.marketingInquiry.create({
      data: {
        companyName,
        contactName,
        email,
        phone,
        message,
        clientIp: ip.slice(0, 80),
        userAgent: ua,
      },
    });

    const adminMail = formatInquiryMailBody({
      id: row.id,
      companyName,
      contactName,
      email,
      phone,
      message,
      createdAt: row.createdAt,
    });
    const autoReplyMail = formatInquiryAutoReplyMailBody({ contactName, companyName });

    const recipients = inquiryNotifyRecipients();
    if (recipients.length > 0) {
      try {
        const result = await sendMail({
          to: recipients,
          subject: adminMail.subject,
          text: adminMail.text,
          html: adminMail.html,
        });
        if (result.sent) {
          await prisma.marketingInquiry.update({
            where: { id: row.id },
            data: { emailNotifiedAt: new Date() },
          });
        }
      } catch (err) {
        req.log.error({ err, inquiryId: row.id }, "inquiry notify mail failed");
      }
    }

    try {
      await sendMail({
        to: email,
        subject: autoReplyMail.subject,
        text: autoReplyMail.text,
        html: autoReplyMail.html,
      });
    } catch (err) {
      req.log.error({ err, inquiryId: row.id, to: email }, "inquiry auto-reply mail failed");
    }

    return { ok: true };
  });
}

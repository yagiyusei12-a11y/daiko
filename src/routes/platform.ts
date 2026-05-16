/**
 * プラットフォーム管理者向け API（全テナント・LP問い合わせ）
 */
import type { FastifyInstance } from "fastify";
import type { MarketingInquiry, MarketingInquiryReply, PlanTier } from "@prisma/client";
import { jwtUser } from "../auth/pre.js";
import { requirePlatformAdmin } from "../auth/platform-pre.js";
import { buildPlainMail, sendMail } from "../lib/mail.js";
import {
  defaultInquiryReplySubject,
  getInquiryAutoReplyTemplate,
  PLATFORM_SETTING_KEYS,
  upsertPlatformSetting,
} from "../lib/platform-settings.js";
import { prisma } from "../db.js";

const INQUIRY_STATUSES = new Set(["OPEN", "IN_PROGRESS", "CLOSED"]);
const PLAN_TIERS = new Set<PlanTier>(["FREE", "STANDARD", "PREMIUM"]);
const REPLY_BODY_MAX = 20_000;

type InquiryRow = MarketingInquiry & { replies?: MarketingInquiryReply[] };

function serializeInquiry(row: InquiryRow, opts?: { includeReplies?: boolean }) {
  const base = {
    id: row.id,
    companyName: row.companyName,
    contactName: row.contactName,
    email: row.email,
    phone: row.phone,
    message: row.message,
    status: row.status,
    adminNotes: row.adminNotes,
    emailNotifiedAt: row.emailNotifiedAt?.toISOString() ?? null,
    lastRepliedAt: row.lastRepliedAt?.toISOString() ?? null,
    clientIp: row.clientIp ?? null,
    userAgent: row.userAgent ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  if (opts?.includeReplies && row.replies) {
    return {
      ...base,
      replies: row.replies.map((r) => ({
        id: r.id,
        subject: r.subject,
        bodyText: r.bodyText,
        sentAt: r.sentAt.toISOString(),
        sentByEmail: r.sentByEmail,
      })),
    };
  }
  return base;
}

function parsePage(q: unknown, def = 1): number {
  const n = Number(q);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : def;
}

function parseLimit(q: unknown, def = 30, max = 100): number {
  const n = Number(q);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(Math.floor(n), max);
}

export async function registerPlatformRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requirePlatformAdmin);

  app.get<{ Querystring: { page?: string; limit?: string; status?: string } }>(
    "/inquiries",
    async (req) => {
      const page = parsePage(req.query.page);
      const limit = parseLimit(req.query.limit);
      const statusFilter = String(req.query.status ?? "").trim().toUpperCase();
      const where =
        statusFilter && INQUIRY_STATUSES.has(statusFilter) ? { status: statusFilter } : {};

      const [total, rows] = await Promise.all([
        prisma.marketingInquiry.count({ where }),
        prisma.marketingInquiry.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);

      return {
        items: rows.map((r) => serializeInquiry(r)),
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      };
    },
  );

  app.get<{ Params: { id: string } }>("/inquiries/:id", async (req, reply) => {
    const row = await prisma.marketingInquiry.findUnique({
      where: { id: req.params.id },
      include: { replies: { orderBy: { sentAt: "desc" } } },
    });
    if (!row) return reply.code(404).send({ error: "not found" });
    return { inquiry: serializeInquiry(row, { includeReplies: true }) };
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/inquiries/:id",
    async (req, reply) => {
      const existing = await prisma.marketingInquiry.findUnique({ where: { id: req.params.id } });
      if (!existing) return reply.code(404).send({ error: "not found" });

      const body = req.body || {};
      const data: { status?: string; adminNotes?: string | null } = {};

      if (body.status !== undefined) {
        const st = String(body.status).trim().toUpperCase();
        if (!INQUIRY_STATUSES.has(st)) {
          return reply.code(400).send({ error: "status must be OPEN, IN_PROGRESS, or CLOSED" });
        }
        data.status = st;
      }
      if (body.adminNotes !== undefined) {
        const notes = String(body.adminNotes ?? "").trim();
        data.adminNotes = notes || null;
      }

      const row = await prisma.marketingInquiry.update({
        where: { id: req.params.id },
        data,
      });

      return {
        inquiry: serializeInquiry(row),
      };
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/inquiries/:id/reply",
    async (req, reply) => {
      const existing = await prisma.marketingInquiry.findUnique({ where: { id: req.params.id } });
      if (!existing) return reply.code(404).send({ error: "not found" });

      const body = req.body || {};
      let subject = String(body.subject ?? "").trim();
      const bodyText = String(body.bodyText ?? "").trim();
      if (!bodyText) return reply.code(400).send({ error: "本文を入力してください" });
      if (bodyText.length > REPLY_BODY_MAX) {
        return reply.code(400).send({ error: "本文が長すぎます" });
      }
      if (!subject) subject = defaultInquiryReplySubject(existing.companyName);
      if (subject.length > 200) {
        return reply.code(400).send({ error: "件名が長すぎます" });
      }

      const admin = jwtUser(req);
      const mail = buildPlainMail(subject, bodyText);
      let sent = false;
      try {
        const result = await sendMail({
          to: existing.email,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
        });
        if (!result.sent) {
          return reply.code(503).send({ error: "メールを送信できませんでした（SMTP未設定）" });
        }
        sent = true;
      } catch (err) {
        req.log.error({ err, inquiryId: existing.id }, "inquiry admin reply mail failed");
        return reply.code(502).send({ error: "メール送信に失敗しました" });
      }

      if (!sent) return reply.code(503).send({ error: "メールを送信できませんでした" });

      const now = new Date();
      const row = await prisma.$transaction(async (tx) => {
        await tx.marketingInquiryReply.create({
          data: {
            inquiryId: existing.id,
            subject,
            bodyText,
            sentByEmail: admin.email,
            sentAt: now,
          },
        });
        return tx.marketingInquiry.update({
          where: { id: existing.id },
          data: { status: "CLOSED", lastRepliedAt: now },
          include: { replies: { orderBy: { sentAt: "desc" } } },
        });
      });

      return { inquiry: serializeInquiry(row, { includeReplies: true }) };
    },
  );

  app.delete<{ Params: { id: string } }>("/inquiries/:id", async (req, reply) => {
    const existing = await prisma.marketingInquiry.findUnique({ where: { id: req.params.id } });
    if (!existing) return reply.code(404).send({ error: "not found" });
    await prisma.marketingInquiry.delete({ where: { id: req.params.id } });
    return { ok: true };
  });

  app.get("/settings/inquiry-auto-reply", async () => {
    const tpl = await getInquiryAutoReplyTemplate();
    return { subject: tpl.subject, body: tpl.body };
  });

  app.put<{ Body: Record<string, unknown> }>("/settings/inquiry-auto-reply", async (req, reply) => {
    const body = req.body || {};
    const subject = String(body.subject ?? "").trim();
    const mailBody = String(body.body ?? "").trim();
    if (!subject) return reply.code(400).send({ error: "件名を入力してください" });
    if (!mailBody) return reply.code(400).send({ error: "本文を入力してください" });
    if (subject.length > 200) return reply.code(400).send({ error: "件名が長すぎます" });
    if (mailBody.length > REPLY_BODY_MAX) return reply.code(400).send({ error: "本文が長すぎます" });

    const admin = jwtUser(req);
    await Promise.all([
      upsertPlatformSetting(PLATFORM_SETTING_KEYS.inquiryAutoReplySubject, subject, admin.email),
      upsertPlatformSetting(PLATFORM_SETTING_KEYS.inquiryAutoReplyBody, mailBody, admin.email),
    ]);
    return { subject, body: mailBody };
  });

  app.get<{ Querystring: { q?: string; page?: string; limit?: string } }>("/tenants", async (req) => {
    const page = parsePage(req.query.page);
    const limit = parseLimit(req.query.limit, 50);
    const q = String(req.query.q ?? "").trim();

    const where = q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { slug: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {};

    const [total, tenants] = await Promise.all([
      prisma.tenant.count({ where }),
      prisma.tenant.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          settings: { select: { legalTradeName: true, legalPhone: true } },
          subscriptions: { orderBy: { validFrom: "desc" }, take: 1 },
          _count: { select: { users: true, employees: true, dailyReports: true } },
        },
      }),
    ]);

    return {
      items: tenants.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        timezone: t.timezone,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        legalTradeName: t.settings?.legalTradeName ?? null,
        legalPhone: t.settings?.legalPhone ?? null,
        planTier: t.subscriptions[0]?.planTier ?? "FREE",
        subscriptionValidFrom: t.subscriptions[0]?.validFrom.toISOString() ?? null,
        userCount: t._count.users,
        employeeCount: t._count.employees,
        dailyReportCount: t._count.dailyReports,
      })),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  });

  app.get<{ Params: { id: string } }>("/tenants/:id", async (req, reply) => {
    const t = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: {
        settings: true,
        subscriptions: { orderBy: { validFrom: "desc" }, take: 5 },
        users: {
          select: { id: true, email: true, displayName: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        },
        _count: { select: { employees: true, vehicles: true, dailyReports: true } },
      },
    });
    if (!t) return reply.code(404).send({ error: "not found" });

    return {
      tenant: {
        id: t.id,
        name: t.name,
        slug: t.slug,
        timezone: t.timezone,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        settings: t.settings
          ? {
              legalTradeName: t.settings.legalTradeName,
              legalPrefecture: t.settings.legalPrefecture,
              legalStreetAddress: t.settings.legalStreetAddress,
              legalPhone: t.settings.legalPhone,
              businessDayRollHour: t.settings.businessDayRollHour,
            }
          : null,
        subscriptions: t.subscriptions.map((s) => ({
          id: s.id,
          planTier: s.planTier,
          validFrom: s.validFrom.toISOString(),
          validTo: s.validTo?.toISOString() ?? null,
        })),
        users: t.users.map((u) => ({
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          createdAt: u.createdAt.toISOString(),
        })),
        counts: {
          employees: t._count.employees,
          vehicles: t._count.vehicles,
          dailyReports: t._count.dailyReports,
        },
      },
    };
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/tenants/:id",
    async (req, reply) => {
      const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
      if (!tenant) return reply.code(404).send({ error: "not found" });

      const body = req.body || {};
      const tenantData: { name?: string; timezone?: string } = {};
      const settingsData: {
        legalTradeName?: string;
        legalPhone?: string | null;
      } = {};

      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name) return reply.code(400).send({ error: "name required" });
        tenantData.name = name;
      }
      if (body.timezone !== undefined) {
        tenantData.timezone = String(body.timezone).trim() || "Asia/Tokyo";
      }
      if (body.legalTradeName !== undefined) {
        settingsData.legalTradeName = String(body.legalTradeName).trim();
      }
      if (body.legalPhone !== undefined) {
        const ph = String(body.legalPhone).trim();
        settingsData.legalPhone = ph || null;
      }

      let planTier: PlanTier | undefined;
      if (body.planTier !== undefined) {
        const pt = String(body.planTier).trim().toUpperCase() as PlanTier;
        if (!PLAN_TIERS.has(pt)) {
          return reply.code(400).send({ error: "invalid planTier" });
        }
        planTier = pt;
      }

      await prisma.$transaction(async (tx) => {
        if (Object.keys(tenantData).length > 0) {
          await tx.tenant.update({ where: { id: tenant.id }, data: tenantData });
        }
        if (Object.keys(settingsData).length > 0) {
          await tx.tenantSettings.upsert({
            where: { tenantId: tenant.id },
            create: {
              tenantId: tenant.id,
              legalTradeName: settingsData.legalTradeName ?? tenant.name,
              legalPhone: settingsData.legalPhone ?? null,
              businessDayRollHour: 4,
              featureFlags: {},
              customJson: {},
            },
            update: settingsData,
          });
        }
        if (planTier) {
          await tx.subscription.create({
            data: { tenantId: tenant.id, planTier, validFrom: new Date() },
          });
        }
      });

      const updated = await prisma.tenant.findUnique({
        where: { id: tenant.id },
        include: {
          settings: { select: { legalTradeName: true, legalPhone: true } },
          subscriptions: { orderBy: { validFrom: "desc" }, take: 1 },
        },
      });

      return {
        tenant: {
          id: updated!.id,
          name: updated!.name,
          slug: updated!.slug,
          timezone: updated!.timezone,
          legalTradeName: updated!.settings?.legalTradeName ?? null,
          legalPhone: updated!.settings?.legalPhone ?? null,
          planTier: updated!.subscriptions[0]?.planTier ?? "FREE",
        },
      };
    },
  );
}

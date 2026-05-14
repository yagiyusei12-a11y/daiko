import type { FastifyInstance, FastifyReply } from "fastify";
import bcrypt from "bcryptjs";
import { authenticate } from "../auth/pre.js";
import { userEffectivePermissionList } from "../lib/permissions.js";
import { coerceStaffMenuVisibilityFromCustomJson } from "../lib/staff-menu-visibility-settings.js";
import { prisma } from "../db.js";
import { hashToken, randomRefreshToken } from "../lib/tokens.js";

const REFRESH_DAYS = 30;

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: {
      tenantName?: string;
      slug?: string;
      email?: string;
      password?: string;
      displayName?: string;
      familyName?: string;
      givenName?: string;
      representativeAdmin?: boolean;
    };
  }>("/auth/register", async (req, reply) => {
    const tenantName = String(req.body?.tenantName || "").trim();
    const slugRaw = String(req.body?.slug || "").trim().toLowerCase();
    const slug = slugRaw
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    let familyName = String(req.body?.familyName || "").trim();
    let givenName = String(req.body?.givenName || "").trim();
    const legacyDisplay = String(req.body?.displayName || "").trim();
    const representativeAdmin = Boolean(req.body?.representativeAdmin);
    if (!familyName && !givenName && legacyDisplay) {
      const parts = legacyDisplay.split(/\s+/).filter(Boolean);
      familyName = parts[0] ?? "";
      givenName = parts.slice(1).join(" ") || familyName;
    }
    if (!tenantName || !slug || !email || !password) {
      return reply.code(400).send({ error: "tenantName, slug, email, password required" });
    }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      return reply
        .code(400)
        .send({ error: "店舗IDは英小文字・数字・ハイフンのみで、先頭・末尾にハイフンを付けないでください" });
    }
    if (!slug) {
      return reply.code(400).send({ error: "店舗IDを入力してください" });
    }
    if (!familyName || !givenName) {
      return reply.code(400).send({ error: "代表者の姓・名を入力してください" });
    }
    if (password.length < 8) return reply.code(400).send({ error: "password min 8 chars" });

    const exists = await prisma.tenant.findUnique({ where: { slug } });
    if (exists) return reply.code(409).send({ error: "slug already used" });

    const passwordHash = await bcrypt.hash(password, 10);
    const displayName = `${familyName} ${givenName}`.trim();
    const tenant = await prisma.$transaction(async (tx) => {
      const t = await tx.tenant.create({
        data: { name: tenantName, slug, timezone: "Asia/Tokyo" },
      });
      await tx.tenantSettings.create({
        data: {
          tenantId: t.id,
          businessDayRollHour: 4,
          featureFlags: {},
          customJson: {},
          legalTradeName: tenantName,
        },
      });
      await tx.subscription.create({
        data: { tenantId: t.id, planTier: "FREE", validFrom: new Date() },
      });
      const ownerRole = await tx.role.create({
        data: { tenantId: t.id, name: "owner", permissions: ["*"] },
      });
      await tx.role.create({
        data: { tenantId: t.id, name: "staff", permissions: ["staff.shift"] },
      });
      const employee = await tx.employee.create({
        data: {
          tenantId: t.id,
          familyName,
          givenName,
          adminMaster: representativeAdmin,
          status: "ACTIVE",
        },
      });
      const user = await tx.user.create({
        data: { tenantId: t.id, email, passwordHash, displayName, employeeId: employee.id },
      });
      await tx.userRole.create({ data: { userId: user.id, roleId: ownerRole.id } });
      return t;
    });

    const user = await prisma.user.findFirstOrThrow({ where: { tenantId: tenant.id, email } });
    const tokens = await issueTokens(reply, user.id, user.tenantId, user.email);
    return { tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug }, ...tokens };
  });

  app.post<{ Body: { email?: string; password?: string; slug?: string } }>("/auth/login", async (req, reply) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const slug = String(req.body?.slug || "").trim().toLowerCase();
    if (!email || !password || !slug) return reply.code(400).send({ error: "email, password, slug required" });
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) return reply.code(401).send({ error: "invalid credentials" });
    const user = await prisma.user.findFirst({ where: { tenantId: tenant.id, email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return reply.code(401).send({ error: "invalid credentials" });
    }
    return issueTokens(reply, user.id, user.tenantId, user.email);
  });

  app.post<{ Body: { refreshToken?: string } }>("/auth/refresh", async (req, reply) => {
    const raw = String(req.body?.refreshToken || "");
    if (!raw) return reply.code(400).send({ error: "refreshToken required" });
    const tokenHash = hashToken(raw);
    const row = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!row || row.expiresAt < new Date()) return reply.code(401).send({ error: "invalid refresh" });
    const user = await prisma.user.findUnique({ where: { id: row.userId } });
    if (!user) return reply.code(401).send({ error: "invalid refresh" });
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
    return issueTokens(reply, user.id, user.tenantId, user.email);
  });

  app.get("/me", { preHandler: [authenticate] }, async (req) => {
    const u = req.user as { sub: string; tenantId: string; email: string };
    const user = await prisma.user.findUnique({
      where: { id: u.sub },
      select: {
        id: true,
        email: true,
        displayName: true,
        employeeId: true,
        employee: { select: { familyName: true, givenName: true } },
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            settings: { select: { legalTradeName: true, customJson: true } },
          },
        },
        roles: { include: { role: true } },
      },
    });
    const permissions = user ? await userEffectivePermissionList(user.id, user.tenant.id) : [];
    if (!user) return { user: null };
    const trade =
      (user.tenant.settings?.legalTradeName && user.tenant.settings.legalTradeName.trim()) || user.tenant.name;
    const employeeDisplayName = user.employee
      ? `${user.employee.familyName} ${user.employee.givenName}`.trim()
      : (user.displayName?.trim() || user.email);
    const sm = coerceStaffMenuVisibilityFromCustomJson(user.tenant.settings?.customJson);
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        employeeId: user.employeeId,
        tradeName: trade,
        employeeDisplayName,
        tenant: { id: user.tenant.id, name: user.tenant.name, slug: user.tenant.slug },
        roles: user.roles.map((r) => r.role.name),
        permissions,
        staffMenuVisibility: {
          allowedHeaderNavIds: sm.allowedHeaderNavIds,
          allowedSubTabIdsByNav: sm.allowedSubTabIdsByNav,
        },
      },
    };
  });
}

async function issueTokens(
  reply: FastifyReply,
  userId: string,
  tenantId: string,
  email: string,
): Promise<{ accessToken: string; refreshToken: string; expiresInSec: number }> {
  const accessToken = await reply.jwtSign({ sub: userId, tenantId, email }, { expiresIn: "15m" });
  const raw = randomRefreshToken();
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + REFRESH_DAYS * 86400000);
  await prisma.refreshToken.create({
    data: { userId, tenantId, tokenHash, expiresAt },
  });
  return { accessToken, refreshToken: raw, expiresInSec: 15 * 60 };
}

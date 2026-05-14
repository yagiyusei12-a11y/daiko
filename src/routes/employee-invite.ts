/**
 * 従業員自己登録 公開エンドポイント（JWT 認証なし）
 * GET  /api/v1/public/employee-invite/:token  → 招待情報取得
 * POST /api/v1/public/employee-invite/:token  → 従業員マスタ登録
 */
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "../db.js";
import { JP_DRIVER_LICENSE_CLASSES_EMPLOYEE } from "../lib/jp-constants.js";
import { JP_LICENSE_CONDITION_OPTIONS, licenseConditionOptionsForKind } from "../lib/jp-license-conditions.js";

type JsonObj = Record<string, unknown>;

function asObj(v: unknown): JsonObj {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as JsonObj) : {};
}

function buildInviteRegisterExtension(body: Record<string, unknown>, hiredOn: string): JsonObj {
  const cur = asObj({});
  const ext: JsonObj = { ...cur };
  const strKeys = [
    "birthDate",
    "phone",
    "mobile",
    "usualWorkDays",
    "emergencyName",
    "emergencyTel",
    "licenseKind",
    "licenseNumber",
    "licenseExpiresOn",
    "licensePhotoFrontDataUrl",
    "licensePhotoBackDataUrl",
  ] as const;
  for (const k of strKeys) {
    if (body[k] !== undefined) ext[k] = String(body[k]);
  }
  if (Array.isArray(body.licenseConditions)) {
    ext.licenseConditions = body.licenseConditions.filter((x): x is string => typeof x === "string");
  }
  ext.hiredOn = hiredOn;
  return ext;
}

async function findInvite(token: string) {
  const invite = await prisma.employeeInviteToken.findUnique({ where: { id: token } });
  if (!invite) return { error: "無効なURLです", status: 404, invite: null };
  if (invite.usedAt) return { error: "このURLは既に使用されました", status: 410, invite: null };
  if (new Date() > invite.expiresAt) return { error: "このURLは期限切れです（有効期限: 30日）", status: 410, invite: null };
  return { error: null, status: 200, invite };
}

export async function registerEmployeeInviteRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { token: string } }>("/employee-invite/:token", async (req, reply) => {
    const { invite, error, status } = await findInvite(req.params.token);
    if (!invite) return reply.code(status).send({ error });

    const licenseClasses = JP_DRIVER_LICENSE_CLASSES_EMPLOYEE;
    const licenseConditionOptionsByKind: Record<string, string[]> = {};
    for (const c of licenseClasses) {
      licenseConditionOptionsByKind[c] = licenseConditionOptionsForKind(c);
    }
    return {
      hiredOn: invite.hiredOn,
      licenseClasses,
      licenseConditionOptions: JP_LICENSE_CONDITION_OPTIONS,
      licenseConditionOptionsByKind,
    };
  });

  app.post<{ Params: { token: string }; Body: Record<string, unknown> }>("/employee-invite/:token", async (req, reply) => {
    const { invite, error, status } = await findInvite(req.params.token);
    if (!invite) return reply.code(status).send({ error });

    const b = req.body || {};
    const familyName = String(b.familyName || "").trim();
    const givenName = String(b.givenName || "").trim();
    if (!familyName || !givenName) return reply.code(400).send({ error: "氏名（姓・名）は必須です" });

    const loginEmail = String(b.loginEmail || "").trim().toLowerCase();
    const password = String(b.password || "");
    const address = b.address ? String(b.address).trim() || null : null;
    const furigana = b.furigana ? String(b.furigana).trim() || null : null;

    const ext = buildInviteRegisterExtension(b, invite.hiredOn);

    if (loginEmail) {
      if (password.length < 8) return reply.code(400).send({ error: "パスワードは8文字以上で入力してください" });
      const exists = await prisma.user.findFirst({ where: { tenantId: invite.tenantId, email: loginEmail } });
      if (exists) return reply.code(409).send({ error: "このメールアドレスは既に使用されています" });
    }

    const staffRole = await prisma.role.findFirst({ where: { tenantId: invite.tenantId, name: "staff" } });
    if (!staffRole) return reply.code(500).send({ error: "テナント設定に問題があります" });

    await prisma.$transaction(async (tx) => {
      const emp = await tx.employee.create({
        data: {
          tenantId: invite.tenantId,
          familyName,
          givenName,
          furigana,
          address,
          registerExtension: ext as Prisma.InputJsonValue,
        },
      });
      if (loginEmail) {
        const passwordHash = await bcrypt.hash(password, 10);
        const u = await tx.user.create({
          data: {
            tenantId: invite.tenantId,
            email: loginEmail,
            passwordHash,
            displayName: `${familyName} ${givenName}`,
            employeeId: emp.id,
          },
        });
        await tx.userRole.create({ data: { userId: u.id, roleId: staffRole.id } });
      }
      await tx.employeeInviteToken.update({
        where: { id: req.params.token },
        data: { usedAt: new Date() },
      });
    });

    return { ok: true };
  });
}

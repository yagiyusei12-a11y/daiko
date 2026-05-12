import type { FastifyInstance } from "fastify";
import { authenticate, jwtUser } from "../auth/pre.js";
import { loadUserAccess } from "../lib/permissions.js";
import { prisma } from "../db.js";

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

type DaySlot = { start: string; end: string };

function coerceDays(raw: unknown): Record<string, DaySlot> {
  const out: Record<string, DaySlot> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!YMD_RE.test(k)) continue;
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const start = typeof o.start === "string" ? o.start.trim() : "";
    const end = typeof o.end === "string" ? o.end.trim() : "";
    if (!HM_RE.test(start) || !HM_RE.test(end)) continue;
    out[k] = { start, end };
  }
  return out;
}

function daysBelongToYm(days: Record<string, DaySlot>, ym: string): boolean {
  const prefix = `${ym}-`;
  for (const k of Object.keys(days)) {
    if (!k.startsWith(prefix)) return false;
    const rest = k.slice(prefix.length);
    if (!/^\d{2}$/.test(rest)) return false;
    const d = Number(rest);
    if (d < 1 || d > 31) return false;
  }
  return true;
}

export async function registerAttendanceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get<{ Querystring: { employeeId?: string; yearMonth?: string } }>("/shift-applications", async (req, reply) => {
    const { tenantId, sub: userId } = jwtUser(req);
    const access = await loadUserAccess(userId, tenantId);
    let employeeId = String(req.query?.employeeId ?? "").trim();
    const yearMonth = String(req.query?.yearMonth ?? "").trim();

    if (!YM_RE.test(yearMonth)) {
      return reply.code(400).send({ error: "yearMonth は yyyy-MM 形式で指定してください" });
    }

    if (access.isStaffShiftOnly) {
      if (!access.employeeId) {
        return reply.code(403).send({ error: "従業員に紐づいていないためシフトを参照できません" });
      }
      employeeId = access.employeeId;
    } else if (!employeeId) {
      return reply.code(400).send({ error: "employeeId が必要です" });
    }

    const emp = await prisma.employee.findFirst({
      where: { id: employeeId, tenantId },
      select: { id: true },
    });
    if (!emp) return reply.code(404).send({ error: "従業員が見つかりません" });

    const row = await prisma.shiftApplication.findUnique({
      where: { tenantId_employeeId_yearMonth: { tenantId, employeeId, yearMonth } },
    });
    const days = row ? coerceDays(row.daysJson) : {};
    return { employeeId, yearMonth, days };
  });

  app.put<{ Body: Record<string, unknown> }>("/shift-applications", async (req, reply) => {
    const { tenantId, sub: userId } = jwtUser(req);
    const access = await loadUserAccess(userId, tenantId);
    const b = req.body || {};
    let employeeId = String(b.employeeId ?? "").trim();
    const yearMonth = String(b.yearMonth ?? "").trim();

    if (!YM_RE.test(yearMonth)) {
      return reply.code(400).send({ error: "yearMonth は yyyy-MM 形式で指定してください" });
    }

    if (access.isStaffShiftOnly) {
      if (!access.employeeId) {
        return reply.code(403).send({ error: "従業員に紐づいていないためシフトを保存できません" });
      }
      employeeId = access.employeeId;
    } else if (!employeeId) {
      return reply.code(400).send({ error: "employeeId が必要です" });
    }

    const emp = await prisma.employee.findFirst({
      where: { id: employeeId, tenantId },
      select: { id: true },
    });
    if (!emp) return reply.code(404).send({ error: "従業員が見つかりません" });

    const days = coerceDays(b.days);
    if (!daysBelongToYm(days, yearMonth)) {
      return reply.code(400).send({ error: "days の日付は指定した yearMonth の月内のみにしてください" });
    }

    await prisma.shiftApplication.upsert({
      where: { tenantId_employeeId_yearMonth: { tenantId, employeeId, yearMonth } },
      create: { tenantId, employeeId, yearMonth, daysJson: days },
      update: { daysJson: days },
    });

    return reply.send({ ok: true });
  });
}

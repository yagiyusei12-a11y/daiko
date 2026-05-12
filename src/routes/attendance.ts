import type { FastifyInstance } from "fastify";
import { TimeCardPunchKind } from "@prisma/client";
import { authenticate, jwtUser } from "../auth/pre.js";
import { loadUserAccess } from "../lib/permissions.js";
import { prisma } from "../db.js";

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 0:00〜48:59（例: 翌4時 = 28:00） */
const FLEX_HM = /^(\d{1,2}):(\d{2})$/;

type DaySlot = { start: string; end: string };

function isValidFlexHm(s: string): boolean {
  const m = FLEX_HM.exec(s.trim());
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h >= 0 && h <= 48 && min >= 0 && min <= 59;
}

function coerceDays(raw: unknown): Record<string, DaySlot> {
  const out: Record<string, DaySlot> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!YMD_RE.test(k)) continue;
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const start = typeof o.start === "string" ? o.start.trim() : "";
    const end = typeof o.end === "string" ? o.end.trim() : "";
    if (!isValidFlexHm(start) || !isValidFlexHm(end)) continue;
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

function slotMeaningful(slot: DaySlot | undefined): boolean {
  if (!slot) return false;
  return isValidFlexHm(slot.start.trim()) && isValidFlexHm(slot.end.trim());
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

  app.put<{ Body: Record<string, unknown> }>("/shift-applications/day", async (req, reply) => {
    const { tenantId, sub: userId } = jwtUser(req);
    const access = await loadUserAccess(userId, tenantId);
    const b = req.body || {};
    let employeeId = String(b.employeeId ?? "").trim();
    const businessDate = String(b.businessDate ?? "").trim();
    const start = String(b.start ?? "").trim();
    const end = String(b.end ?? "").trim();

    if (!YMD_RE.test(businessDate)) {
      return reply.code(400).send({ error: "businessDate は yyyy-MM-dd 形式で指定してください" });
    }
    const yearMonth = businessDate.slice(0, 7);
    if (!YM_RE.test(yearMonth)) {
      return reply.code(400).send({ error: "日付が不正です" });
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

    const row = await prisma.shiftApplication.findUnique({
      where: { tenantId_employeeId_yearMonth: { tenantId, employeeId, yearMonth } },
    });
    const days = row ? coerceDays(row.daysJson) : {};

    if (start === "" && end === "") {
      delete days[businessDate];
    } else {
      if (!isValidFlexHm(start) || !isValidFlexHm(end)) {
        return reply
          .code(400)
          .send({ error: "start / end は 0:00〜48:59 の「時:分」形式で指定してください（両方空でその日の申請を削除）" });
      }
      days[businessDate] = { start, end };
    }

    if (!daysBelongToYm(days, yearMonth)) {
      return reply.code(400).send({ error: "日付は指定した月（yearMonth）内のみにしてください" });
    }

    await prisma.shiftApplication.upsert({
      where: { tenantId_employeeId_yearMonth: { tenantId, employeeId, yearMonth } },
      create: { tenantId, employeeId, yearMonth, daysJson: days },
      update: { daysJson: days },
    });

    return reply.send({ ok: true });
  });

  app.get<{ Querystring: { yearMonth?: string } }>("/shift-adjust/month-indicators", async (req, reply) => {
    const { tenantId, sub: userId } = jwtUser(req);
    const access = await loadUserAccess(userId, tenantId);
    const yearMonth = String(req.query?.yearMonth ?? "").trim();
    if (!YM_RE.test(yearMonth)) {
      return reply.code(400).send({ error: "yearMonth は yyyy-MM 形式で指定してください" });
    }
    const prefix = `${yearMonth}-`;

    if (access.isStaffShiftOnly) {
      if (!access.employeeId) {
        return reply.code(403).send({ error: "従業員に紐づいていないため参照できません" });
      }
      const appDates = new Set<string>();
      const row = await prisma.shiftApplication.findUnique({
        where: { tenantId_employeeId_yearMonth: { tenantId, employeeId: access.employeeId, yearMonth } },
      });
      if (row) {
        const d = coerceDays(row.daysJson);
        for (const [k, v] of Object.entries(d)) {
          if (k.startsWith(prefix) && slotMeaningful(v)) appDates.add(k);
        }
      }
      const confs = await prisma.confirmedShiftDay.findMany({
        where: { tenantId, employeeId: access.employeeId, businessDate: { startsWith: prefix } },
        select: { businessDate: true },
      });
      const confDates = [...new Set(confs.map((c) => c.businessDate))].sort();
      return { applicationDates: [...appDates].sort(), confirmedDates: confDates };
    }

    const apps = await prisma.shiftApplication.findMany({ where: { tenantId, yearMonth } });
    const appDates = new Set<string>();
    for (const a of apps) {
      const d = coerceDays(a.daysJson);
      for (const [k, v] of Object.entries(d)) {
        if (k.startsWith(prefix) && slotMeaningful(v)) appDates.add(k);
      }
    }
    const confs = await prisma.confirmedShiftDay.findMany({
      where: { tenantId, businessDate: { startsWith: prefix } },
      select: { businessDate: true },
    });
    const confDates = [...new Set(confs.map((c) => c.businessDate))].sort();
    return { applicationDates: [...appDates].sort(), confirmedDates: confDates };
  });

  const DUTY_WHITELIST = new Set(["客車", "随伴車", "電話", "スケジュール"]);

  function parseDutiesJson(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const x of raw) {
      if (typeof x === "string" && DUTY_WHITELIST.has(x)) out.push(x);
    }
    return [...new Set(out)];
  }

  app.get<{ Querystring: { date?: string } }>("/shift-adjust/day", async (req, reply) => {
    const { tenantId, sub: userId } = jwtUser(req);
    const access = await loadUserAccess(userId, tenantId);
    const date = String(req.query?.date ?? "").trim();
    if (!YMD_RE.test(date)) {
      return reply.code(400).send({ error: "date は yyyy-MM-dd 形式で指定してください" });
    }
    const yearMonth = date.slice(0, 7);
    if (!YM_RE.test(yearMonth)) {
      return reply.code(400).send({ error: "日付が不正です" });
    }

    type RowOut = {
      employeeId: string;
      familyName: string;
      givenName: string;
      application: { start: string; end: string } | null;
      confirmed: { startTime: string; endTime: string; duties: string[] } | null;
    };

    const rowMap = new Map<string, RowOut>();

    const apps = await prisma.shiftApplication.findMany({
      where: access.isStaffShiftOnly
        ? { tenantId, yearMonth, employeeId: access.employeeId! }
        : { tenantId, yearMonth },
      include: { employee: { select: { id: true, familyName: true, givenName: true } } },
    });

    const confRowsForDate = await prisma.confirmedShiftDay.findMany({
      where: {
        tenantId,
        businessDate: date,
        ...(access.isStaffShiftOnly ? { employeeId: access.employeeId! } : {}),
      },
      include: { employee: { select: { familyName: true, givenName: true } } },
    });
    const confByEmp = new Map(confRowsForDate.map((c) => [c.employeeId, c]));

    for (const a of apps) {
      const days = coerceDays(a.daysJson);
      const slot = days[date];
      const confRow = confByEmp.get(a.employeeId) ?? null;
      const hasApp = slotMeaningful(slot);
      const hasConf = confRow !== null;
      if (!hasApp && !hasConf) continue;
      rowMap.set(a.employeeId, {
        employeeId: a.employeeId,
        familyName: a.employee.familyName,
        givenName: a.employee.givenName,
        application: hasApp ? { start: slot!.start.trim(), end: slot!.end.trim() } : null,
        confirmed: hasConf
          ? {
              startTime: confRow!.startTime,
              endTime: confRow!.endTime,
              duties: parseDutiesJson(confRow!.dutiesJson),
            }
          : null,
      });
    }

    const confOnly = confRowsForDate.filter((c) => !rowMap.has(c.employeeId));
    for (const c of confOnly) {
      rowMap.set(c.employeeId, {
        employeeId: c.employeeId,
        familyName: c.employee.familyName,
        givenName: c.employee.givenName,
        application: null,
        confirmed: {
          startTime: c.startTime,
          endTime: c.endTime,
          duties: parseDutiesJson(c.dutiesJson),
        },
      });
    }

    const rows = [...rowMap.values()].sort((a, b) =>
      `${a.familyName}${a.givenName}`.localeCompare(`${b.familyName}${b.givenName}`, "ja"),
    );

    return { date, yearMonth, rows };
  });

  app.get<{ Querystring: { employeeId?: string; yearMonth?: string } }>("/confirmed-shifts", async (req, reply) => {
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

    const prefix = `${yearMonth}-`;
    const rows = await prisma.confirmedShiftDay.findMany({
      where: { tenantId, employeeId, businessDate: { startsWith: prefix } },
      orderBy: { businessDate: "asc" },
    });

    return {
      employeeId,
      yearMonth,
      rows: rows.map((r) => ({
        businessDate: r.businessDate,
        startTime: r.startTime,
        endTime: r.endTime,
        duties: parseDutiesJson(r.dutiesJson),
      })),
    };
  });

  app.get<{ Querystring: { date?: string } }>("/confirmed-shifts/by-date", async (req, reply) => {
    const { tenantId, sub: userId } = jwtUser(req);
    const access = await loadUserAccess(userId, tenantId);
    const date = String(req.query?.date ?? "").trim();
    if (!YMD_RE.test(date)) {
      return reply.code(400).send({ error: "date は yyyy-MM-dd 形式で指定してください" });
    }

    const where: { tenantId: string; businessDate: string; employeeId?: string } = {
      tenantId,
      businessDate: date,
    };
    if (access.isStaffShiftOnly) {
      if (!access.employeeId) {
        return reply.code(403).send({ error: "従業員に紐づいていないためシフトを参照できません" });
      }
      where.employeeId = access.employeeId;
    }

    const rows = await prisma.confirmedShiftDay.findMany({
      where,
      include: { employee: { select: { id: true, familyName: true, givenName: true } } },
      orderBy: [{ employee: { familyName: "asc" } }, { employee: { givenName: "asc" } }],
    });

    return {
      date,
      rows: rows.map((r) => ({
        employeeId: r.employeeId,
        familyName: r.employee.familyName,
        givenName: r.employee.givenName,
        businessDate: r.businessDate,
        startTime: r.startTime,
        endTime: r.endTime,
        duties: parseDutiesJson(r.dutiesJson),
      })),
    };
  });

  app.put<{ Body: Record<string, unknown> }>("/confirmed-shifts", async (req, reply) => {
    const { tenantId, sub: userId } = jwtUser(req);
    const access = await loadUserAccess(userId, tenantId);
    const b = req.body || {};
    let employeeId = String(b.employeeId ?? "").trim();
    const businessDate = String(b.businessDate ?? "").trim();
    const startTime = String(b.startTime ?? "").trim();
    const endTime = String(b.endTime ?? "").trim();

    if (!YMD_RE.test(businessDate)) {
      return reply.code(400).send({ error: "businessDate は yyyy-MM-dd 形式で指定してください" });
    }

    if (access.isStaffShiftOnly) {
      if (!access.employeeId) {
        return reply.code(403).send({ error: "従業員に紐づいていないためシフトを保存できません" });
      }
      employeeId = access.employeeId;
    } else if (!employeeId) {
      return reply.code(400).send({ error: "employeeId が必要です" });
    }

    if (!isValidFlexHm(startTime) || !isValidFlexHm(endTime)) {
      return reply
        .code(400)
        .send({ error: "startTime / endTime は 0:00〜48:59 の「時:分」形式で指定してください" });
    }

    const emp = await prisma.employee.findFirst({
      where: { id: employeeId, tenantId },
      select: { id: true },
    });
    if (!emp) return reply.code(404).send({ error: "従業員が見つかりません" });

    const duties = parseDutiesJson(b.duties);

    await prisma.confirmedShiftDay.upsert({
      where: {
        tenantId_employeeId_businessDate: { tenantId, employeeId, businessDate },
      },
      create: {
        tenantId,
        employeeId,
        businessDate,
        startTime,
        endTime,
        dutiesJson: duties,
      },
      update: { startTime, endTime, dutiesJson: duties },
    });

    return reply.send({ ok: true });
  });

  app.get<{ Querystring: { employeeId?: string; businessDate?: string } }>("/timecard/punches", async (req, reply) => {
    const { tenantId, sub: userId } = jwtUser(req);
    const access = await loadUserAccess(userId, tenantId);
    let employeeId = String(req.query?.employeeId ?? "").trim();
    const businessDate = String(req.query?.businessDate ?? "").trim();

    if (!YMD_RE.test(businessDate)) {
      return reply.code(400).send({ error: "businessDate は yyyy-MM-dd 形式で指定してください" });
    }

    if (access.isStaffShiftOnly) {
      if (!access.employeeId) {
        return reply.code(403).send({ error: "従業員に紐づいていないため打刻を参照できません" });
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

    const punches = await prisma.timeCardPunch.findMany({
      where: { tenantId, employeeId, businessDate },
      orderBy: { punchedAt: "asc" },
      select: { id: true, kind: true, punchedAt: true },
    });

    return {
      employeeId,
      businessDate,
      punches: punches.map((p) => ({
        id: p.id,
        kind: p.kind,
        punchedAt: p.punchedAt.toISOString(),
      })),
    };
  });

  app.post<{ Body: Record<string, unknown> }>("/timecard/punch", async (req, reply) => {
    const { tenantId, sub: userId } = jwtUser(req);
    const access = await loadUserAccess(userId, tenantId);
    const b = req.body || {};
    let employeeId = String(b.employeeId ?? "").trim();
    const businessDate = String(b.businessDate ?? "").trim();
    const kindStr = String(b.kind ?? "").trim();

    if (!YMD_RE.test(businessDate)) {
      return reply.code(400).send({ error: "businessDate は yyyy-MM-dd 形式で指定してください" });
    }

    if (access.isStaffShiftOnly) {
      if (!access.employeeId) {
        return reply.code(403).send({ error: "従業員に紐づいていないため打刻できません" });
      }
      employeeId = access.employeeId;
    } else if (!employeeId) {
      return reply.code(400).send({ error: "employeeId が必要です" });
    }

    if (!Object.values(TimeCardPunchKind).includes(kindStr as TimeCardPunchKind)) {
      return reply.code(400).send({ error: "kind は CLOCK_IN / CLOCK_OUT / BREAK_START / BREAK_END のいずれかです" });
    }

    const emp = await prisma.employee.findFirst({
      where: { id: employeeId, tenantId },
      select: { id: true },
    });
    if (!emp) return reply.code(404).send({ error: "従業員が見つかりません" });

    const row = await prisma.timeCardPunch.create({
      data: {
        tenantId,
        employeeId,
        businessDate,
        kind: kindStr as TimeCardPunchKind,
      },
      select: { id: true, kind: true, punchedAt: true },
    });

    return {
      id: row.id,
      kind: row.kind,
      punchedAt: row.punchedAt.toISOString(),
    };
  });

  app.delete<{ Params: { punchId?: string } }>("/timecard/punches/:punchId", async (req, reply) => {
    const { tenantId, sub: userId } = jwtUser(req);
    const access = await loadUserAccess(userId, tenantId);
    const punchId = String(req.params?.punchId ?? "").trim();
    if (!punchId) return reply.code(400).send({ error: "punchId が必要です" });

    const existing = await prisma.timeCardPunch.findFirst({
      where: { id: punchId, tenantId },
      select: { id: true, employeeId: true },
    });
    if (!existing) return reply.code(404).send({ error: "打刻が見つかりません" });

    if (access.isStaffShiftOnly) {
      if (!access.employeeId || existing.employeeId !== access.employeeId) {
        return reply.code(403).send({ error: "この打刻を削除する権限がありません" });
      }
    }

    await prisma.timeCardPunch.delete({ where: { id: punchId, tenantId } });
    return reply.send({ ok: true });
  });
}

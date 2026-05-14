import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { TimeCardPunchKind } from "@prisma/client";
import { authenticate, jwtUser } from "../auth/pre.js";
import { loadUserAccess } from "../lib/permissions.js";
import { prisma } from "../db.js";
import { coerceBusinessBasicsFromCustomJson, type BusinessBasicsV2 } from "../lib/business-basics.js";

async function buildAlcoholCheckJsonForClockIn(
  tenantId: string,
  basics: BusinessBasicsV2,
  raw: unknown,
): Promise<{ ok: true; json: Prisma.InputJsonValue | null } | { ok: false; error: string }> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: true, json: null };
  }
  const ac = raw as Record<string, unknown>;
  const breathalyzerId = String(ac.breathalyzerId ?? "").trim();
  const verifierEmployeeId = String(ac.verifierEmployeeId ?? "").trim();
  const verificationMethod = String(ac.verificationMethod ?? "").trim();
  const alcoholDetected = Boolean(ac.alcoholDetected);
  let instructionsNote: string | null = null;
  if (ac.instructionsNote !== undefined && ac.instructionsNote !== null && String(ac.instructionsNote).trim()) {
    instructionsNote = String(ac.instructionsNote).trim().slice(0, 2000);
  }

  let breathalyzerName: string | null = null;
  if (breathalyzerId) {
    const dev = basics.breathalyzers.find((d) => d.id === breathalyzerId);
    if (!dev) return { ok: false, error: "アルコール探知機の指定が不正です" };
    if (verificationMethod && !dev.verificationMethods.includes(verificationMethod)) {
      return { ok: false, error: "確認方法がこのアルコール探知機の一覧にありません" };
    }
    breathalyzerName = dev.name;
  }

  let verifierName: string | null = null;
  if (verifierEmployeeId) {
    const verifier = await prisma.employee.findFirst({
      where: { id: verifierEmployeeId, tenantId, safetyDrivingManager: true, status: "ACTIVE" },
      select: { id: true, familyName: true, givenName: true },
    });
    if (!verifier) {
      return { ok: false, error: "確認者は安全運転管理者から選んでください" };
    }
    verifierName = `${verifier.familyName} ${verifier.givenName}`;
  }

  const json = {
    ...(breathalyzerId ? { breathalyzerId, breathalyzerName } : {}),
    ...(verifierEmployeeId ? { verifierEmployeeId, verifierName } : {}),
    ...(verificationMethod ? { verificationMethod } : {}),
    alcoholDetected,
    instructionsNote,
    recordedAt: new Date().toISOString(),
  };
  return { ok: true, json: json as unknown as Prisma.InputJsonValue };
}

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 0:00〜48:59（例: 翌4時 = 28:00） */
const FLEX_HM = /^(\d{1,2}):(\d{2})$/;

type CompPeriodPick = {
  validFrom: Date;
  validTo: Date | null;
  baseHourlyYen: number;
  mainHourlyYen: number;
  partnerHourlyYen: number;
  phoneHourlyYen: number;
};

/** 確定シフトの担当種別（dutiesJson）からロールラベルを決定 */
function roleFromDuties(duties: string[]): "客車" | "随伴車" | "電話" | null {
  if (duties.includes("客車")) return "客車";
  if (duties.includes("随伴車")) return "随伴車";
  if (duties.includes("電話")) return "電話";
  return null;
}

function effectiveHourlyYenAt(
  periods: CompPeriodPick[],
  businessDate: string,
  role: "客車" | "随伴車" | "電話" | null,
): { hourlyYen: number; roleLabel: string | null } {
  const anchor = new Date(`${businessDate}T12:00:00+09:00`);
  const matching = periods.filter((p) => p.validFrom <= anchor && (p.validTo == null || p.validTo >= anchor));
  matching.sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime());
  const cur = matching[0];
  if (!cur) return { hourlyYen: 0, roleLabel: role };

  const base = cur.mainHourlyYen > 0 ? cur.mainHourlyYen : cur.baseHourlyYen;

  if (role === "随伴車" && cur.partnerHourlyYen > 0) {
    return { hourlyYen: cur.partnerHourlyYen, roleLabel: "随伴車" };
  }
  if (role === "電話" && cur.phoneHourlyYen > 0) {
    return { hourlyYen: cur.phoneHourlyYen, roleLabel: "電話" };
  }
  // 客車 or 未設定 → mainHourlyYen
  return { hourlyYen: base, roleLabel: role ?? "客車" };
}

function hmTokyoFromDate(d: Date): string {
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function computeWageYen(
  clockIn: Date | null,
  breakStart: Date | null,
  breakEnd: Date | null,
  clockOut: Date | null,
  hourlyYen: number,
): number | null {
  if (!hourlyYen || hourlyYen < 0) return null;
  if (!clockIn || !clockOut || clockOut.getTime() <= clockIn.getTime()) return null;
  let breakMs = 0;
  if (breakStart && breakEnd && breakEnd.getTime() > breakStart.getTime()) {
    breakMs = breakEnd.getTime() - breakStart.getTime();
    breakMs = Math.min(breakMs, clockOut.getTime() - clockIn.getTime());
    breakMs = Math.max(0, breakMs);
  }
  const workMs = Math.max(0, clockOut.getTime() - clockIn.getTime() - breakMs);
  const hours = workMs / 3600000;
  return Math.round(hours * hourlyYen);
}

type PunchForSummary = { id: string; kind: TimeCardPunchKind; punchedAt: Date };

function summarizeDayPunches(sorted: PunchForSummary[]): {
  clockIn: PunchForSummary | null;
  breakStart: PunchForSummary | null;
  breakEnd: PunchForSummary | null;
  clockOut: PunchForSummary | null;
} {
  const clockIn = sorted.find((p) => p.kind === TimeCardPunchKind.CLOCK_IN) ?? null;
  const clockOut = [...sorted].reverse().find((p) => p.kind === TimeCardPunchKind.CLOCK_OUT) ?? null;
  let breakStart: PunchForSummary | null = null;
  for (const p of sorted) {
    if (p.kind !== TimeCardPunchKind.BREAK_START) continue;
    if (clockIn && p.punchedAt.getTime() < clockIn.punchedAt.getTime()) continue;
    breakStart = p;
    break;
  }
  let breakEnd: PunchForSummary | null = null;
  if (breakStart) {
    for (const p of sorted) {
      if (p.kind !== TimeCardPunchKind.BREAK_END) continue;
      if (p.punchedAt.getTime() >= breakStart.punchedAt.getTime()) {
        breakEnd = p;
        break;
      }
    }
  }
  return { clockIn, breakStart, breakEnd, clockOut };
}

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
      select: { id: true, kind: true, punchedAt: true, alcoholCheckJson: true },
    });

    return {
      employeeId,
      businessDate,
      punches: punches.map((p) => ({
        id: p.id,
        kind: p.kind,
        punchedAt: p.punchedAt.toISOString(),
        alcoholCheck: p.alcoholCheckJson,
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

    let alcoholCheckJson: Prisma.InputJsonValue | undefined;
    if (kindStr === "CLOCK_IN" || kindStr === "CLOCK_OUT") {
      const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
      const basics = coerceBusinessBasicsFromCustomJson(settings?.customJson);
      const built = await buildAlcoholCheckJsonForClockIn(tenantId, basics, b.alcoholCheck);
      if (!built.ok) return reply.code(400).send({ error: built.error });
      if (built.json !== null) alcoholCheckJson = built.json;
    }

    const row = await prisma.timeCardPunch.create({
      data: {
        tenantId,
        employeeId,
        businessDate,
        kind: kindStr as TimeCardPunchKind,
        ...(alcoholCheckJson !== undefined ? { alcoholCheckJson } : {}),
      },
      select: { id: true, kind: true, punchedAt: true, alcoholCheckJson: true },
    });

    return {
      id: row.id,
      kind: row.kind,
      punchedAt: row.punchedAt.toISOString(),
      alcoholCheck: row.alcoholCheckJson,
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

  app.patch<{ Params: { punchId?: string }; Body: Record<string, unknown> }>(
    "/timecard/punches/:punchId",
    async (req, reply) => {
      const { tenantId, sub: userId } = jwtUser(req);
      const access = await loadUserAccess(userId, tenantId);
      const punchId = String(req.params?.punchId ?? "").trim();
      if (!punchId) return reply.code(400).send({ error: "punchId が必要です" });

      const punchedAtRaw = req.body?.punchedAt;
      if (typeof punchedAtRaw !== "string" || !punchedAtRaw.trim()) {
        return reply.code(400).send({ error: "punchedAt は ISO 日時文字列で指定してください" });
      }
      const punchedAt = new Date(punchedAtRaw.trim());
      if (Number.isNaN(punchedAt.getTime())) {
        return reply.code(400).send({ error: "punchedAt が不正です" });
      }

      const existing = await prisma.timeCardPunch.findFirst({
        where: { id: punchId, tenantId },
        select: { id: true, employeeId: true },
      });
      if (!existing) return reply.code(404).send({ error: "打刻が見つかりません" });

      if (access.isStaffShiftOnly) {
        if (!access.employeeId || existing.employeeId !== access.employeeId) {
          return reply.code(403).send({ error: "この打刻を修正する権限がありません" });
        }
      }

      await prisma.timeCardPunch.update({
        where: { id: punchId, tenantId },
        data: { punchedAt },
      });

      return reply.send({ ok: true, id: punchId, punchedAt: punchedAt.toISOString() });
    },
  );

  app.get<{ Querystring: { yearMonth?: string } }>("/timecard/month-summary", async (req, reply) => {
    const { tenantId, sub: userId } = jwtUser(req);
    const access = await loadUserAccess(userId, tenantId);
    const yearMonth = String(req.query?.yearMonth ?? "").trim();

    if (!YM_RE.test(yearMonth)) {
      return reply.code(400).send({ error: "yearMonth は yyyy-MM 形式で指定してください" });
    }

    if (access.isStaffShiftOnly && !access.employeeId) {
      return reply.code(403).send({ error: "従業員に紐づいていないため一覧を参照できません" });
    }

    const datePrefix = `${yearMonth}-`;

    const punches = await prisma.timeCardPunch.findMany({
      where: {
        tenantId,
        businessDate: { startsWith: datePrefix },
        ...(access.isStaffShiftOnly && access.employeeId ? { employeeId: access.employeeId } : {}),
      },
      include: {
        employee: { select: { familyName: true, givenName: true } },
      },
      orderBy: [{ employeeId: "asc" }, { businessDate: "asc" }, { punchedAt: "asc" }],
    });

    const groupMap = new Map<
      string,
      {
        employeeId: string;
        businessDate: string;
        familyName: string;
        givenName: string;
        items: PunchForSummary[];
      }
    >();

    for (const p of punches) {
      const key = `${p.employeeId}\t${p.businessDate}`;
      let g = groupMap.get(key);
      if (!g) {
        g = {
          employeeId: p.employeeId,
          businessDate: p.businessDate,
          familyName: p.employee.familyName,
          givenName: p.employee.givenName,
          items: [],
        };
        groupMap.set(key, g);
      }
      g.items.push({ id: p.id, kind: p.kind, punchedAt: p.punchedAt });
    }

    const empIds = [...new Set([...groupMap.values()].map((g) => g.employeeId))];
    const allPeriods =
      empIds.length === 0
        ? []
        : await prisma.employeeCompensationPeriod.findMany({
            where: { employeeId: { in: empIds } },
            select: {
              employeeId: true,
              validFrom: true,
              validTo: true,
              baseHourlyYen: true,
              mainHourlyYen: true,
              partnerHourlyYen: true,
              phoneHourlyYen: true,
            },
          });

    const periodsByEmp = new Map<string, CompPeriodPick[]>();
    for (const p of allPeriods) {
      if (!periodsByEmp.has(p.employeeId)) periodsByEmp.set(p.employeeId, []);
      periodsByEmp.get(p.employeeId)!.push({
        validFrom: p.validFrom,
        validTo: p.validTo,
        baseHourlyYen: p.baseHourlyYen,
        mainHourlyYen: p.mainHourlyYen,
        partnerHourlyYen: p.partnerHourlyYen,
        phoneHourlyYen: p.phoneHourlyYen,
      });
    }

    // 確定シフトの担当種別を一括取得
    const confirmedShifts =
      groupMap.size === 0
        ? []
        : await prisma.confirmedShiftDay.findMany({
            where: {
              tenantId,
              businessDate: { startsWith: datePrefix },
              ...(access.isStaffShiftOnly && access.employeeId ? { employeeId: access.employeeId } : {}),
            },
            select: { employeeId: true, businessDate: true, dutiesJson: true },
          });

    const shiftDutiesMap = new Map<string, string[]>();
    for (const s of confirmedShifts) {
      const duties = Array.isArray(s.dutiesJson)
        ? (s.dutiesJson as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      shiftDutiesMap.set(`${s.employeeId}\t${s.businessDate}`, duties);
    }

    const rows: Array<{
      employeeId: string;
      familyName: string;
      givenName: string;
      businessDate: string;
      clockIn: { id: string; punchedAt: string; hm: string } | null;
      breakStart: { id: string; punchedAt: string; hm: string } | null;
      breakEnd: { id: string; punchedAt: string; hm: string } | null;
      clockOut: { id: string; punchedAt: string; hm: string } | null;
      baseHourlyYen: number;
      roleLabel: string | null;
      wageYen: number | null;
    }> = [];

    for (const g of groupMap.values()) {
      const sum = summarizeDayPunches(g.items);
      const periods = periodsByEmp.get(g.employeeId) ?? [];
      const duties = shiftDutiesMap.get(`${g.employeeId}\t${g.businessDate}`) ?? [];
      const role = roleFromDuties(duties);
      const { hourlyYen, roleLabel } = effectiveHourlyYenAt(periods, g.businessDate, role);
      const wageYen = computeWageYen(
        sum.clockIn?.punchedAt ?? null,
        sum.breakStart?.punchedAt ?? null,
        sum.breakEnd?.punchedAt ?? null,
        sum.clockOut?.punchedAt ?? null,
        hourlyYen,
      );

      const slot = (x: PunchForSummary | null) =>
        x
          ? {
              id: x.id,
              punchedAt: x.punchedAt.toISOString(),
              hm: hmTokyoFromDate(x.punchedAt),
            }
          : null;

      rows.push({
        employeeId: g.employeeId,
        familyName: g.familyName,
        givenName: g.givenName,
        businessDate: g.businessDate,
        clockIn: slot(sum.clockIn),
        breakStart: slot(sum.breakStart),
        breakEnd: slot(sum.breakEnd),
        clockOut: slot(sum.clockOut),
        baseHourlyYen: hourlyYen,
        roleLabel,
        wageYen,
      });
    }

    rows.sort((a, b) => {
      const c = a.businessDate.localeCompare(b.businessDate);
      if (c !== 0) return c;
      const n = `${a.familyName}${a.givenName}`.localeCompare(`${b.familyName}${b.givenName}`, "ja");
      return n;
    });

    return { yearMonth, rows };
  });

  app.get<{ Querystring: { yearMonth?: string } }>("/timecard/alcohol-checks", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const yearMonth = String(req.query?.yearMonth ?? "").trim();
    if (!YM_RE.test(yearMonth)) {
      return reply.code(400).send({ error: "yearMonth は yyyy-MM 形式で指定してください" });
    }
    const [y, m] = yearMonth.split("-");
    const dateFrom = `${y}-${m}-01`;
    const nextMonth = m === "12" ? `${Number(y) + 1}-01-01` : `${y}-${String(Number(m) + 1).padStart(2, "0")}-01`;

    const punches = await prisma.timeCardPunch.findMany({
      where: {
        tenantId,
        businessDate: { gte: dateFrom, lt: nextMonth },
        kind: { in: ["CLOCK_IN", "CLOCK_OUT"] },
        NOT: { alcoholCheckJson: { equals: null as unknown as Prisma.InputJsonValue } },
      },
      orderBy: [{ businessDate: "asc" }, { punchedAt: "asc" }],
      include: {
        employee: { select: { id: true, familyName: true, givenName: true } },
      },
    });

    const rows = punches
      .filter((p) => p.alcoholCheckJson !== null)
      .map((p) => {
        const ac = (p.alcoholCheckJson ?? {}) as Record<string, unknown>;
        return {
          id: p.id,
          businessDate: p.businessDate,
          phase: p.kind === "CLOCK_IN" ? "出勤" : "退勤",
          employeeId: p.employee.id,
          familyName: p.employee.familyName,
          givenName: p.employee.givenName,
          punchedAt: p.punchedAt.toISOString(),
          breathalyzerName: typeof ac.breathalyzerName === "string" ? ac.breathalyzerName : null,
          verificationMethod: typeof ac.verificationMethod === "string" ? ac.verificationMethod : null,
          alcoholDetected: Boolean(ac.alcoholDetected),
          instructionsNote: typeof ac.instructionsNote === "string" ? ac.instructionsNote : null,
          verifierName: typeof ac.verifierName === "string" ? ac.verifierName : null,
        };
      });

    return { yearMonth, rows };
  });
}

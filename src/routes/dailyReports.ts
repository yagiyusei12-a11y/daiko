import type { FastifyInstance } from "fastify";
import type { TripPassengerKind } from "@prisma/client";
import { authenticate, jwtUser } from "../auth/pre.js";
import { prisma } from "../db.js";
import { businessDateYmdForOccurredAt } from "../lib/business-date.js";
import { fareYenForTrip } from "../lib/pricing.js";
import { loadUserAccess, type UserAccessContext } from "../lib/permissions.js";
import { tenantIdFromReq } from "./tenant-scope.js";

function passengerKindFromBody(raw: unknown): TripPassengerKind {
  return raw === "MEMBER" ? "MEMBER" : "GENERAL";
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function officialOnlyFromQuery(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "yes";
}

function employeeLabel(e: { familyName: string; givenName: string }): string {
  return `${e.familyName} ${e.givenName}`.trim();
}

function csvCell(s: string): string {
  return `"${String(s).replace(/"/g, '""')}"`;
}

function dailyReportVisibleToStaff(
  rep: { mainEmployeeId: string; partnerEmployeeId: string | null },
  access: UserAccessContext,
): boolean {
  if (!access.isStaffShiftOnly) return true;
  if (!access.employeeId) return false;
  return rep.mainEmployeeId === access.employeeId || rep.partnerEmployeeId === access.employeeId;
}

const tripRel = {
  customer: { select: { id: true, displayName: true } },
  referralSource: { select: { id: true, name: true } },
} as const;

export async function registerDailyReportRoutes(app: FastifyInstance): Promise<void> {
  app.get("/daily-reports", { preHandler: [authenticate] }, async (req) => {
    const tid = tenantIdFromReq(req);
    const u = jwtUser(req);
    const access = await loadUserAccess(u.sub, tid);
    const { from, to } = req.query as { from?: string; to?: string };
    const where: {
      tenantId: string;
      businessDate?: { gte: string; lte: string };
      OR?: ({ mainEmployeeId: string } | { partnerEmployeeId: string })[];
    } = { tenantId: tid };
    if (from && to) where.businessDate = { gte: from, lte: to };
    if (access.isStaffShiftOnly) {
      if (!access.employeeId) return { dailyReports: [] };
      where.OR = [{ mainEmployeeId: access.employeeId }, { partnerEmployeeId: access.employeeId }];
    }
    const rows = await prisma.dailyReport.findMany({
      where,
      orderBy: { businessDate: "desc" },
      include: {
        vehicle: true,
        mainEmployee: true,
        partnerEmployee: true,
        trips: { include: tripRel },
      },
      take: 100,
    });
    return { dailyReports: rows };
  });

  app.get("/daily-reports/export-range.csv", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const u = jwtUser(req);
    const access = await loadUserAccess(u.sub, tid);
    const { from, to, officialOnly } = req.query as { from?: string; to?: string; officialOnly?: string };
    if (!from || !to) return reply.code(400).send({ error: "from and to (YYYY-MM-DD) required" });
    const only = officialOnlyFromQuery(officialOnly);
    const dateWhere = { tenantId: tid, businessDate: { gte: from, lte: to } };
    const where =
      access.isStaffShiftOnly && access.employeeId
        ? { ...dateWhere, OR: [{ mainEmployeeId: access.employeeId }, { partnerEmployeeId: access.employeeId }] }
        : access.isStaffShiftOnly
          ? { tenantId: tid, id: { in: [] as string[] } }
          : dateWhere;
    const rows = await prisma.dailyReport.findMany({
      where,
      orderBy: { businessDate: "asc" },
      include: {
        vehicle: true,
        mainEmployee: true,
        partnerEmployee: true,
        trips: { include: tripRel, orderBy: { departedAt: "asc" } },
      },
      take: 400,
    });
    const lines: string[] = ["\uFEFFbusinessDate,vehicle,mainDriver,partnerDriver,tripClient,origin,destination,fareYen,distanceM,waitingMinutes,officialExclude,customerId,referral"];
    for (const r of rows) {
      const trips = only ? r.trips.filter((t) => !t.excludeFromOfficialPrint) : r.trips;
      for (const t of trips) {
        lines.push(
          [
            csvCell(r.businessDate),
            csvCell(r.vehicle.label),
            csvCell(employeeLabel(r.mainEmployee)),
            csvCell(r.partnerEmployee ? employeeLabel(r.partnerEmployee) : ""),
            csvCell(t.clientName),
            csvCell(t.origin),
            csvCell(t.destination),
            csvCell(String(t.fareYen)),
            csvCell(String(t.distanceM)),
            csvCell(String(t.waitingMinutes)),
            csvCell(t.excludeFromOfficialPrint ? "1" : "0"),
            csvCell(t.customerId ?? ""),
            csvCell(t.referralSource?.name ?? ""),
          ].join(","),
        );
      }
    }
    const body = lines.join("\n");
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="daily-reports-${from}_${to}.csv"`)
      .send(body);
  });

  app.get("/daily-reports/export-range.html", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const u = jwtUser(req);
    const access = await loadUserAccess(u.sub, tid);
    const { from, to, officialOnly } = req.query as { from?: string; to?: string; officialOnly?: string };
    if (!from || !to) return reply.code(400).send({ error: "from and to (YYYY-MM-DD) required" });
    const only = officialOnlyFromQuery(officialOnly);
    const dateWhere = { tenantId: tid, businessDate: { gte: from, lte: to } };
    const where =
      access.isStaffShiftOnly && access.employeeId
        ? { ...dateWhere, OR: [{ mainEmployeeId: access.employeeId }, { partnerEmployeeId: access.employeeId }] }
        : access.isStaffShiftOnly
          ? { tenantId: tid, id: { in: [] as string[] } }
          : dateWhere;
    const rows = await prisma.dailyReport.findMany({
      where,
      orderBy: { businessDate: "asc" },
      include: {
        vehicle: true,
        mainEmployee: true,
        partnerEmployee: true,
        trips: { include: tripRel, orderBy: { departedAt: "asc" } },
      },
      take: 400,
    });
    const blocks = rows.map((r) => {
      const trips = only ? r.trips.filter((t) => !t.excludeFromOfficialPrint) : r.trips;
      const tr = trips
        .map(
          (t) =>
            `<tr><td>${esc(t.clientName)}</td><td>${esc(t.origin)}→${esc(t.destination)}</td><td>${t.fareYen}</td><td>${
              t.excludeFromOfficialPrint ? "内部" : "公式"
            }</td></tr>`,
        )
        .join("");
      return `<section class="day"><h2>${esc(r.businessDate)} / ${esc(r.vehicle.label)} / 主:${esc(
        employeeLabel(r.mainEmployee),
      )}${r.partnerEmployee ? ` 随:${esc(employeeLabel(r.partnerEmployee))}` : ""}</h2>
<table><thead><tr><th>顧客</th><th>区間</th><th>運賃</th><th>区分</th></tr></thead><tbody>${tr}</tbody></table>
<p>決済: 現金${r.paymentCashYen}（領収書なし現金 ${r.paymentCashNoReceiptYen}） カード${r.paymentCardYen} PayPay${r.paymentPayPayYen} 売掛${r.paymentReceivableYen}</p></section>`;
    });
    const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"/><title>日報一括印刷</title>
<style>body{font-family:system-ui;margin:16px;}section.day{page-break-after:always;}table{border-collapse:collapse;width:100%;}th,td{border:1px solid #ccc;padding:4px;font-size:12px;}</style></head><body>
<h1>日報一括（${only ? "公式のみ" : "全件"}）</h1>${blocks.join("\n")}</body></html>`;
    return reply.type("text/html; charset=utf-8").send(html);
  });

  app.get<{ Params: { id: string } }>("/daily-reports/:id", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const u = jwtUser(req);
    const access = await loadUserAccess(u.sub, tid);
    const row = await prisma.dailyReport.findFirst({
      where: { id: req.params.id, tenantId: tid },
      include: {
        vehicle: true,
        mainEmployee: true,
        partnerEmployee: true,
        trips: { include: tripRel, orderBy: { departedAt: "asc" } },
      },
    });
    if (!row) return reply.code(404).send({ error: "not found" });
    if (!dailyReportVisibleToStaff(row, access)) return reply.code(404).send({ error: "not found" });
    return row;
  });

  app.get<{ Params: { id: string } }>("/daily-reports/:id/print", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const u = jwtUser(req);
    const access = await loadUserAccess(u.sub, tid);
    const { officialOnly } = req.query as { officialOnly?: string };
    const only = officialOnlyFromQuery(officialOnly);
    const r = await prisma.dailyReport.findFirst({
      where: { id: req.params.id, tenantId: tid },
      include: {
        vehicle: true,
        mainEmployee: true,
        partnerEmployee: true,
        trips: { include: tripRel, orderBy: { departedAt: "asc" } },
      },
    });
    if (!r) return reply.code(404).send({ error: "not found" });
    if (!dailyReportVisibleToStaff(r, access)) return reply.code(404).send({ error: "not found" });
    const trips = only ? r.trips.filter((t) => !t.excludeFromOfficialPrint) : r.trips;
    const tripRows = trips
      .map(
        (t) =>
          `<tr><td>${esc(t.clientName)}</td><td>${esc(t.origin)} → ${esc(t.destination)}</td><td>${t.fareYen}</td><td>${
            t.distanceM
          }</td><td>${t.waitingMinutes}</td><td>${t.excludeFromOfficialPrint ? "内部" : "公式"}</td><td>${esc(
            t.referralSource?.name ?? "",
          )}</td></tr>`,
      )
      .join("");
    const sumAll = r.trips.reduce((a, t) => a + t.fareYen, 0);
    const sumOfficial = r.trips.filter((t) => !t.excludeFromOfficialPrint).reduce((a, t) => a + t.fareYen, 0);
    const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"/><title>日報 ${esc(r.businessDate)}</title>
<style>
body{font-family:system-ui,sans-serif;margin:20px;color:#111;}
h1{font-size:20px;} table{border-collapse:collapse;width:100%;margin-top:12px;} th,td{border:1px solid #bbb;padding:6px;font-size:13px;} th{background:#eee;}
.meta{margin:8px 0;font-size:14px;} .pay{margin-top:16px;font-size:14px;}
</style></head><body>
<h1>運転日報 ${esc(r.businessDate)}</h1>
<div class="meta">車両: ${esc(r.vehicle.label)} / メーター: ${r.meterStart} → ${r.meterEnd}</div>
<div class="meta">主運転: ${esc(employeeLabel(r.mainEmployee))}${
      r.partnerEmployee ? ` / 随伴: ${esc(employeeLabel(r.partnerEmployee))}` : ""
    }</div>
<p>表示: <strong>${only ? "公式帳票対象のみ" : "全運行（内部含む）"}</strong> — 運賃合計（表示中）: ${trips.reduce(
      (a, t) => a + t.fareYen,
      0,
    )} 円 / 全件合計: ${sumAll} 円 / 公式のみ合計: ${sumOfficial} 円</p>
<table><thead><tr><th>顧客</th><th>区間</th><th>運賃</th><th>距離m</th><th>待機分</th><th>区分</th><th>紹介元</th></tr></thead><tbody>${tripRows}</tbody></table>
<div class="pay">
  <strong>決済内訳</strong><br/>
  現金: ${r.paymentCashYen} 円（うち領収書なし現金: ${r.paymentCashNoReceiptYen} 円）<br/>
  カード: ${r.paymentCardYen} 円 / PayPay: ${r.paymentPayPayYen} 円 / 売掛: ${r.paymentReceivableYen} 円
</div>
<script>window.onload=()=>{window.focus();};</script>
</body></html>`;
    return reply.type("text/html; charset=utf-8").send(html);
  });

  app.get<{ Params: { id: string } }>("/daily-reports/:id/export.csv", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const u = jwtUser(req);
    const access = await loadUserAccess(u.sub, tid);
    const { officialOnly } = req.query as { officialOnly?: string };
    const only = officialOnlyFromQuery(officialOnly);
    const r = await prisma.dailyReport.findFirst({
      where: { id: req.params.id, tenantId: tid },
      include: { vehicle: true, mainEmployee: true, partnerEmployee: true, trips: { include: tripRel, orderBy: { departedAt: "asc" } } },
    });
    if (!r) return reply.code(404).send({ error: "not found" });
    if (!dailyReportVisibleToStaff(r, access)) return reply.code(404).send({ error: "not found" });
    const trips = only ? r.trips.filter((t) => !t.excludeFromOfficialPrint) : r.trips;
    const lines: string[] = [
      "\uFEFFbusinessDate,vehicle,mainDriver,partnerDriver,tripClient,origin,destination,fareYen,distanceM,waitingMinutes,officialExclude,referral",
    ];
    for (const t of trips) {
      lines.push(
        [
          csvCell(r.businessDate),
          csvCell(r.vehicle.label),
          csvCell(employeeLabel(r.mainEmployee)),
          csvCell(r.partnerEmployee ? employeeLabel(r.partnerEmployee) : ""),
          csvCell(t.clientName),
          csvCell(t.origin),
          csvCell(t.destination),
          csvCell(String(t.fareYen)),
          csvCell(String(t.distanceM)),
          csvCell(String(t.waitingMinutes)),
          csvCell(t.excludeFromOfficialPrint ? "1" : "0"),
          csvCell(t.referralSource?.name ?? ""),
        ].join(","),
      );
    }
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="daily-report-${r.businessDate}.csv"`)
      .send(lines.join("\n"));
  });

  app.patch<{
    Params: { id: string };
    Body: {
      paymentCashYen?: number;
      paymentCashNoReceiptYen?: number;
      paymentCardYen?: number;
      paymentPayPayYen?: number;
      paymentReceivableYen?: number;
      partnerEmployeeId?: string | null;
      meterStart?: number;
      meterEnd?: number;
      dutyStartAt?: string | null;
      dutyEndAt?: string | null;
      breakTaken?: boolean;
      breakStartAt?: string | null;
      breakEndAt?: string | null;
      breakLocation?: string | null;
    };
  }>("/daily-reports/:id", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const u = jwtUser(req);
    const access = await loadUserAccess(u.sub, tid);
    const row = await prisma.dailyReport.findFirst({ where: { id: req.params.id, tenantId: tid } });
    if (!row) return reply.code(404).send({ error: "not found" });
    if (!dailyReportVisibleToStaff(row, access)) return reply.code(404).send({ error: "not found" });
    const b = req.body ?? {};
    const nums = {
      paymentCashYen: b.paymentCashYen !== undefined ? Math.max(0, Math.floor(Number(b.paymentCashYen))) : row.paymentCashYen,
      paymentCashNoReceiptYen:
        b.paymentCashNoReceiptYen !== undefined ? Math.max(0, Math.floor(Number(b.paymentCashNoReceiptYen))) : row.paymentCashNoReceiptYen,
      paymentCardYen: b.paymentCardYen !== undefined ? Math.max(0, Math.floor(Number(b.paymentCardYen))) : row.paymentCardYen,
      paymentPayPayYen: b.paymentPayPayYen !== undefined ? Math.max(0, Math.floor(Number(b.paymentPayPayYen))) : row.paymentPayPayYen,
      paymentReceivableYen:
        b.paymentReceivableYen !== undefined ? Math.max(0, Math.floor(Number(b.paymentReceivableYen))) : row.paymentReceivableYen,
    };
    if (![nums.paymentCashYen, nums.paymentCashNoReceiptYen, nums.paymentCardYen, nums.paymentPayPayYen, nums.paymentReceivableYen].every(
      (n) => Number.isFinite(n),
    )) {
      return reply.code(400).send({ error: "invalid payment numbers" });
    }
    if (nums.paymentCashNoReceiptYen > nums.paymentCashYen) {
      return reply.code(400).send({ error: "paymentCashNoReceiptYen cannot exceed paymentCashYen" });
    }

    let meterStart = row.meterStart;
    let meterEnd = row.meterEnd;
    if (b.meterStart !== undefined) {
      const ms = Math.floor(Number(b.meterStart));
      if (!Number.isFinite(ms)) return reply.code(400).send({ error: "invalid meterStart" });
      meterStart = ms;
    }
    if (b.meterEnd !== undefined) {
      const me = Math.floor(Number(b.meterEnd));
      if (!Number.isFinite(me)) return reply.code(400).send({ error: "invalid meterEnd" });
      meterEnd = me;
    }
    if (meterEnd < meterStart) return reply.code(400).send({ error: "meterEnd must be >= meterStart" });

    let partnerEmployeeId: string | null | undefined = undefined;
    if (b.partnerEmployeeId !== undefined) {
      if (b.partnerEmployeeId === null || b.partnerEmployeeId === "") {
        partnerEmployeeId = null;
      } else {
        const pid = String(b.partnerEmployeeId);
        if (pid === row.mainEmployeeId) return reply.code(400).send({ error: "partner cannot be same as main driver" });
        const emp = await prisma.employee.findFirst({ where: { id: pid, tenantId: tid } });
        if (!emp) return reply.code(400).send({ error: "invalid partnerEmployeeId" });
        partnerEmployeeId = pid;
      }
    }

    const nextPartnerId =
      partnerEmployeeId !== undefined ? partnerEmployeeId : row.partnerEmployeeId;
    if (
      access.isStaffShiftOnly &&
      access.employeeId &&
      !dailyReportVisibleToStaff({ mainEmployeeId: row.mainEmployeeId, partnerEmployeeId: nextPartnerId }, access)
    ) {
      return reply.code(403).send({ error: "update would remove you from this daily report" });
    }

    const readOptIso = (v: unknown): { ok: true; v: Date | null } | { ok: false } => {
      if (v === null || v === "") return { ok: true, v: null };
      const d = new Date(String(v));
      if (!Number.isFinite(d.getTime())) return { ok: false };
      return { ok: true, v: d };
    };

    let dutyStartAt: Date | null | undefined = undefined;
    if (b.dutyStartAt !== undefined) {
      const p = readOptIso(b.dutyStartAt);
      if (!p.ok) return reply.code(400).send({ error: "invalid dutyStartAt" });
      dutyStartAt = p.v;
    }
    let dutyEndAt: Date | null | undefined = undefined;
    if (b.dutyEndAt !== undefined) {
      const p = readOptIso(b.dutyEndAt);
      if (!p.ok) return reply.code(400).send({ error: "invalid dutyEndAt" });
      dutyEndAt = p.v;
    }
    let breakStartAt: Date | null | undefined = undefined;
    if (b.breakStartAt !== undefined) {
      const p = readOptIso(b.breakStartAt);
      if (!p.ok) return reply.code(400).send({ error: "invalid breakStartAt" });
      breakStartAt = p.v;
    }
    let breakEndAt: Date | null | undefined = undefined;
    if (b.breakEndAt !== undefined) {
      const p = readOptIso(b.breakEndAt);
      if (!p.ok) return reply.code(400).send({ error: "invalid breakEndAt" });
      breakEndAt = p.v;
    }

    const breakTaken = b.breakTaken !== undefined ? Boolean(b.breakTaken) : undefined;
    let breakLocation: string | null | undefined = undefined;
    if (b.breakLocation !== undefined) {
      breakLocation = b.breakLocation === null || b.breakLocation === "" ? null : String(b.breakLocation).trim() || null;
    }

    return prisma.dailyReport.update({
      where: { id: row.id },
      data: {
        ...nums,
        meterStart,
        meterEnd,
        ...(partnerEmployeeId !== undefined ? { partnerEmployeeId } : {}),
        ...(dutyStartAt !== undefined ? { dutyStartAt } : {}),
        ...(dutyEndAt !== undefined ? { dutyEndAt } : {}),
        ...(breakTaken !== undefined ? { breakTaken } : {}),
        ...(breakStartAt !== undefined ? { breakStartAt } : {}),
        ...(breakEndAt !== undefined ? { breakEndAt } : {}),
        ...(breakLocation !== undefined ? { breakLocation } : {}),
      },
      include: { vehicle: true, mainEmployee: true, partnerEmployee: true, trips: { include: tripRel } },
    });
  });

  app.post<{
    Body: {
      vehicleId?: string;
      mainEmployeeId?: string;
      partnerEmployeeId?: string | null;
      meterStart?: number;
      meterEnd?: number;
      occurredAt?: string;
      dutyStartAt?: string;
      dutyEndAt?: string;
      breakTaken?: boolean;
      breakStartAt?: string;
      breakEndAt?: string;
      breakLocation?: string;
    };
  }>("/daily-reports", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const u = jwtUser(req);
    const access = await loadUserAccess(u.sub, tid);
    const tenant = await prisma.tenant.findUnique({
      where: { id: tid },
      include: { settings: true },
    });
    if (!tenant?.settings) return reply.code(500).send({ error: "tenant settings missing" });
    const vehicleId = String(req.body?.vehicleId || "");
    const mainEmployeeId = String(req.body?.mainEmployeeId || "");
    const partnerEmployeeIdForCreate = req.body?.partnerEmployeeId ? String(req.body.partnerEmployeeId) : null;
    const meterStart = Math.floor(Number(req.body?.meterStart ?? NaN));
    const meterEnd = Math.floor(Number(req.body?.meterEnd ?? NaN));
    if (!vehicleId || !mainEmployeeId || !Number.isFinite(meterStart) || !Number.isFinite(meterEnd)) {
      return reply.code(400).send({ error: "vehicleId, mainEmployeeId, meterStart, meterEnd required" });
    }
    if (access.isStaffShiftOnly) {
      if (!access.employeeId) return reply.code(403).send({ error: "user not linked to an employee" });
      const selfOk =
        mainEmployeeId === access.employeeId || partnerEmployeeIdForCreate === access.employeeId;
      if (!selfOk) {
        return reply.code(403).send({ error: "staff must be main or partner on new daily report" });
      }
    }
    const at = req.body?.occurredAt ? new Date(req.body.occurredAt) : new Date();
    if (!Number.isFinite(at.getTime())) return reply.code(400).send({ error: "invalid occurredAt" });
    const dutyStartAt = req.body?.dutyStartAt ? new Date(req.body.dutyStartAt) : null;
    const dutyEndAt = req.body?.dutyEndAt ? new Date(req.body.dutyEndAt) : null;
    const breakStartAt = req.body?.breakStartAt ? new Date(req.body.breakStartAt) : null;
    const breakEndAt = req.body?.breakEndAt ? new Date(req.body.breakEndAt) : null;
    if (
      (dutyStartAt && !Number.isFinite(dutyStartAt.getTime())) ||
      (dutyEndAt && !Number.isFinite(dutyEndAt.getTime())) ||
      (breakStartAt && !Number.isFinite(breakStartAt.getTime())) ||
      (breakEndAt && !Number.isFinite(breakEndAt.getTime()))
    ) {
      return reply.code(400).send({ error: "invalid duty/break datetime" });
    }
    const businessDate = businessDateYmdForOccurredAt(at, tenant.timezone, tenant.settings.businessDayRollHour);
    const row = await prisma.dailyReport.create({
      data: {
        tenantId: tid,
        businessDate,
        vehicleId,
        mainEmployeeId,
        partnerEmployeeId: partnerEmployeeIdForCreate,
        meterStart,
        meterEnd,
        dutyStartAt,
        dutyEndAt,
        breakTaken: Boolean(req.body?.breakTaken),
        breakStartAt,
        breakEndAt,
        breakLocation: req.body?.breakLocation ? String(req.body.breakLocation).trim() || null : null,
      },
    });
    return row;
  });

  app.delete<{ Params: { id: string } }>("/daily-reports/:id", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const u = jwtUser(req);
    const access = await loadUserAccess(u.sub, tid);
    const row = await prisma.dailyReport.findFirst({ where: { id: req.params.id, tenantId: tid } });
    if (!row) return reply.code(404).send({ error: "not found" });
    if (!dailyReportVisibleToStaff(row, access)) return reply.code(404).send({ error: "not found" });
    const ym = row.businessDate.slice(0, 7);
    const run = await prisma.payrollRun.findFirst({
      where: { tenantId: tid, status: "LOCKED", periodYm: ym },
    });
    if (run) return reply.code(403).send({ error: "payroll locked for this month; cannot delete" });
    await prisma.dailyReport.delete({ where: { id: row.id } });
    return { ok: true };
  });

  app.post<{
    Params: { id: string };
    Body: {
      clientName?: string;
      charterVehicleNo?: string;
      origin?: string;
      destination?: string;
      viaNote?: string;
      departedAt?: string;
      arrivedAt?: string;
      distanceM?: number;
      waitingMinutes?: number;
      tariffVersionId?: string | null;
      role?: string;
      passengerKind?: string;
      viaStopCount?: number;
      applyNightSurcharge?: boolean;
      applyLeftHandSurcharge?: boolean;
      pickupFromBaseM?: number | null;
      applyNightSurchargeFlat?: boolean;
      applyLateNightFlatYen?: boolean;
      applyEarlyMorningFlatYen?: boolean;
      applyEarlyRushFlatYen?: boolean;
      applyLeftHandSurchargeFlat?: boolean;
      customerId?: string | null;
      referralSourceId?: string | null;
      fareOverrideYen?: number | null;
      excludeFromOfficialPrint?: boolean;
    };
  }>("/daily-reports/:id/trips", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const u = jwtUser(req);
    const access = await loadUserAccess(u.sub, tid);
    const rep = await prisma.dailyReport.findFirst({ where: { id: req.params.id, tenantId: tid } });
    if (!rep) return reply.code(404).send({ error: "not found" });
    if (!dailyReportVisibleToStaff(rep, access)) return reply.code(404).send({ error: "not found" });

    let customerId: string | null = req.body?.customerId ? String(req.body.customerId) : null;
    let referralSourceId: string | null = req.body?.referralSourceId ? String(req.body.referralSourceId) : null;
    if (referralSourceId) {
      const ref = await prisma.referralSource.findFirst({ where: { id: referralSourceId, tenantId: tid } });
      if (!ref) return reply.code(400).send({ error: "invalid referralSourceId" });
    }
    let customer: {
      displayName: string;
      defaultOrigin: string;
      defaultDestination: string;
      defaultTariffVersionId: string | null;
      specialFareYen: number | null;
    } | null = null;
    if (customerId) {
      const c = await prisma.customer.findFirst({ where: { id: customerId, tenantId: tid, archivedAt: null } });
      if (!c) return reply.code(400).send({ error: "invalid customerId" });
      customer = {
        displayName: c.displayName,
        defaultOrigin: c.defaultOrigin,
        defaultDestination: c.defaultDestination,
        defaultTariffVersionId: c.defaultTariffVersionId,
        specialFareYen: c.specialFareYen,
      };
    }

    let clientName = String(req.body?.clientName || "").trim();
    let origin = String(req.body?.origin || "").trim();
    let destination = String(req.body?.destination || "").trim();
    if (customer) {
      if (!clientName) clientName = customer.displayName;
      if (!origin) origin = customer.defaultOrigin.trim();
      if (!destination) destination = customer.defaultDestination.trim();
    }
    const departedAt = req.body?.departedAt ? new Date(req.body.departedAt) : null;
    const arrivedAt = req.body?.arrivedAt ? new Date(req.body.arrivedAt) : null;
    const distanceM = Math.floor(Number(req.body?.distanceM ?? NaN));
    const waitingMinutes = Math.max(0, Math.floor(Number(req.body?.waitingMinutes ?? 0)));
    if (!clientName || !origin || !destination || !departedAt || !arrivedAt || !Number.isFinite(distanceM)) {
      return reply.code(400).send({ error: "clientName, origin, destination, departedAt, arrivedAt, distanceM required" });
    }

    let tariffVersionId: string | null =
      req.body?.tariffVersionId !== undefined && req.body.tariffVersionId !== null
        ? String(req.body.tariffVersionId)
        : customer?.defaultTariffVersionId ?? null;
    if (req.body?.tariffVersionId === null) tariffVersionId = null;

    const passengerKind = passengerKindFromBody(req.body?.passengerKind);
    const viaStopCount = Math.max(0, Math.floor(Number(req.body?.viaStopCount ?? 0)));
    const applyNightSurcharge = Boolean(req.body?.applyNightSurcharge);
    const applyLeftHandSurcharge = Boolean(req.body?.applyLeftHandSurcharge);
    const rawPickup = req.body?.pickupFromBaseM;
    let pickupFromBaseM: number | null = null;
    if (rawPickup !== undefined) {
      if (rawPickup === null) pickupFromBaseM = null;
      else {
        const p = Math.floor(Number(rawPickup));
        if (!Number.isFinite(p) || p < 0) return reply.code(400).send({ error: "invalid pickupFromBaseM" });
        pickupFromBaseM = p;
      }
    }
    const applyNightSurchargeFlat = Boolean(req.body?.applyNightSurchargeFlat);
    const applyLateNightFlatYen = Boolean(req.body?.applyLateNightFlatYen);
    const applyEarlyMorningFlatYen = Boolean(req.body?.applyEarlyMorningFlatYen);
    const applyEarlyRushFlatYen = Boolean(req.body?.applyEarlyRushFlatYen);
    const applyLeftHandSurchargeFlat = Boolean(req.body?.applyLeftHandSurchargeFlat);
    const excludeFromOfficialPrint = Boolean(req.body?.excludeFromOfficialPrint);

    let fareOverrideYen: number | null = null;
    if (req.body?.fareOverrideYen !== undefined && req.body.fareOverrideYen !== null) {
      const o = Math.floor(Number(req.body.fareOverrideYen));
      if (!Number.isFinite(o) || o < 0) return reply.code(400).send({ error: "invalid fareOverrideYen" });
      fareOverrideYen = o;
    } else if (customer?.specialFareYen != null) {
      fareOverrideYen = customer.specialFareYen;
    }

    let fareYen = 0;
    if (fareOverrideYen !== null) {
      fareYen = fareOverrideYen;
    } else if (tariffVersionId) {
      const ver = await prisma.tariffPlanVersion.findFirst({
        where: { id: tariffVersionId, plan: { tenantId: tid } },
        include: { segments: true, distanceTiers: { orderBy: { sortOrder: "asc" } } },
      });
      if (!ver) return reply.code(400).send({ error: "invalid tariffVersionId" });
      fareYen = fareYenForTrip(ver, distanceM, waitingMinutes, ver.segments, ver.distanceTiers, {
        isMember: passengerKind === "MEMBER",
        viaStopCount,
        applyNightSurcharge,
        applyLeftHandSurcharge,
        pickupFromBaseM,
        applyNightSurchargeFlat,
        applyLateNightFlatYen,
        applyEarlyMorningFlatYen,
        applyEarlyRushFlatYen,
        applyLeftHandSurchargeFlat,
      });
    }

    const role = req.body?.role === "PARTNER_DRIVER" ? "PARTNER_DRIVER" : "MAIN_DRIVER";
    const trip = await prisma.tripLeg.create({
      data: {
        dailyReportId: rep.id,
        clientName,
        charterVehicleNo: req.body?.charterVehicleNo ? String(req.body.charterVehicleNo).trim() || null : null,
        origin,
        destination,
        viaNote: req.body?.viaNote ? String(req.body.viaNote).trim() || null : null,
        departedAt,
        arrivedAt,
        distanceM,
        waitingMinutes,
        tariffVersionId,
        fareYen,
        role,
        passengerKind,
        viaStopCount,
        applyNightSurcharge,
        applyLeftHandSurcharge,
        pickupFromBaseM,
        applyNightSurchargeFlat,
        applyLateNightFlatYen,
        applyEarlyMorningFlatYen,
        applyEarlyRushFlatYen,
        applyLeftHandSurchargeFlat,
        customerId,
        referralSourceId,
        fareOverrideYen,
        excludeFromOfficialPrint,
      },
      include: tripRel,
    });
    return trip;
  });

  app.patch<{
    Params: { id: string; tripId: string };
    Body: {
      distanceM?: number;
      waitingMinutes?: number;
      tariffVersionId?: string | null;
      clientName?: string;
      origin?: string;
      destination?: string;
      charterVehicleNo?: string | null;
      viaNote?: string | null;
      departedAt?: string;
      arrivedAt?: string;
      role?: string;
      passengerKind?: string;
      viaStopCount?: number;
      applyNightSurcharge?: boolean;
      applyLeftHandSurcharge?: boolean;
      pickupFromBaseM?: number | null;
      applyNightSurchargeFlat?: boolean;
      applyLateNightFlatYen?: boolean;
      applyEarlyMorningFlatYen?: boolean;
      applyEarlyRushFlatYen?: boolean;
      applyLeftHandSurchargeFlat?: boolean;
      customerId?: string | null;
      referralSourceId?: string | null;
      fareOverrideYen?: number | null;
      excludeFromOfficialPrint?: boolean;
    };
  }>("/daily-reports/:id/trips/:tripId", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const u = jwtUser(req);
    const access = await loadUserAccess(u.sub, tid);
    const rep = await prisma.dailyReport.findFirst({ where: { id: req.params.id, tenantId: tid } });
    if (!rep) return reply.code(404).send({ error: "not found" });
    if (!dailyReportVisibleToStaff(rep, access)) return reply.code(404).send({ error: "not found" });
    const trip = await prisma.tripLeg.findFirst({
      where: { id: req.params.tripId, dailyReportId: rep.id },
    });
    if (!trip) return reply.code(404).send({ error: "trip not found" });

    let customerId = req.body?.customerId !== undefined ? (req.body.customerId ? String(req.body.customerId) : null) : trip.customerId;
    let referralSourceId =
      req.body?.referralSourceId !== undefined ? (req.body.referralSourceId ? String(req.body.referralSourceId) : null) : trip.referralSourceId;
    if (referralSourceId) {
      const ref = await prisma.referralSource.findFirst({ where: { id: referralSourceId, tenantId: tid } });
      if (!ref) return reply.code(400).send({ error: "invalid referralSourceId" });
    }
    if (customerId) {
      const c = await prisma.customer.findFirst({ where: { id: customerId, tenantId: tid, archivedAt: null } });
      if (!c) return reply.code(400).send({ error: "invalid customerId" });
    }

    const distanceM =
      req.body?.distanceM !== undefined ? Math.floor(Number(req.body.distanceM)) : trip.distanceM;
    const waitingMinutes =
      req.body?.waitingMinutes !== undefined
        ? Math.max(0, Math.floor(Number(req.body.waitingMinutes)))
        : trip.waitingMinutes;
    let tariffVersionId =
      req.body?.tariffVersionId !== undefined
        ? req.body.tariffVersionId
          ? String(req.body.tariffVersionId)
          : null
        : trip.tariffVersionId;

    if (!Number.isFinite(distanceM)) return reply.code(400).send({ error: "invalid distanceM" });

    const passengerKind =
      req.body?.passengerKind !== undefined ? passengerKindFromBody(req.body.passengerKind) : trip.passengerKind;
    const viaStopCount =
      req.body?.viaStopCount !== undefined
        ? Math.max(0, Math.floor(Number(req.body.viaStopCount)))
        : trip.viaStopCount;
    const applyNightSurcharge =
      req.body?.applyNightSurcharge !== undefined ? Boolean(req.body.applyNightSurcharge) : trip.applyNightSurcharge;
    const applyLeftHandSurcharge =
      req.body?.applyLeftHandSurcharge !== undefined
        ? Boolean(req.body.applyLeftHandSurcharge)
        : trip.applyLeftHandSurcharge;

    const rawPickupPatch = req.body?.pickupFromBaseM;
    let pickupFromBaseM =
      rawPickupPatch !== undefined
        ? rawPickupPatch === null
          ? null
          : (() => {
              const p = Math.floor(Number(rawPickupPatch));
              return Number.isFinite(p) && p >= 0 ? p : NaN;
            })()
        : trip.pickupFromBaseM;
    if (rawPickupPatch !== undefined && rawPickupPatch !== null && !Number.isFinite(pickupFromBaseM as number)) {
      return reply.code(400).send({ error: "invalid pickupFromBaseM" });
    }
    if (rawPickupPatch === null) pickupFromBaseM = null;

    const applyNightSurchargeFlat =
      req.body?.applyNightSurchargeFlat !== undefined
        ? Boolean(req.body.applyNightSurchargeFlat)
        : trip.applyNightSurchargeFlat;
    const applyLateNightFlatYen =
      req.body?.applyLateNightFlatYen !== undefined ? Boolean(req.body.applyLateNightFlatYen) : trip.applyLateNightFlatYen;
    const applyEarlyMorningFlatYen =
      req.body?.applyEarlyMorningFlatYen !== undefined
        ? Boolean(req.body.applyEarlyMorningFlatYen)
        : trip.applyEarlyMorningFlatYen;
    const applyEarlyRushFlatYen =
      req.body?.applyEarlyRushFlatYen !== undefined ? Boolean(req.body.applyEarlyRushFlatYen) : trip.applyEarlyRushFlatYen;
    const applyLeftHandSurchargeFlat =
      req.body?.applyLeftHandSurchargeFlat !== undefined
        ? Boolean(req.body.applyLeftHandSurchargeFlat)
        : trip.applyLeftHandSurchargeFlat;

    let fareOverrideYen: number | null | undefined = undefined;
    if (req.body?.fareOverrideYen !== undefined) {
      if (req.body.fareOverrideYen === null) fareOverrideYen = null;
      else {
        const o = Math.floor(Number(req.body.fareOverrideYen));
        if (!Number.isFinite(o) || o < 0) return reply.code(400).send({ error: "invalid fareOverrideYen" });
        fareOverrideYen = o;
      }
    }
    const effectiveOverride = fareOverrideYen !== undefined ? fareOverrideYen : trip.fareOverrideYen;

    let fareYen = trip.fareYen;
    if (effectiveOverride !== null) {
      fareYen = effectiveOverride;
      if (req.body?.tariffVersionId !== undefined) {
        /* keep explicit tariff change while override: still honor tariff id for record */
      }
    } else if (tariffVersionId) {
      const ver = await prisma.tariffPlanVersion.findFirst({
        where: { id: tariffVersionId, plan: { tenantId: tid } },
        include: { segments: true, distanceTiers: { orderBy: { sortOrder: "asc" } } },
      });
      if (!ver) return reply.code(400).send({ error: "invalid tariffVersionId" });
      fareYen = fareYenForTrip(ver, distanceM, waitingMinutes, ver.segments, ver.distanceTiers, {
        isMember: passengerKind === "MEMBER",
        viaStopCount,
        applyNightSurcharge,
        applyLeftHandSurcharge,
        pickupFromBaseM: pickupFromBaseM ?? undefined,
        applyNightSurchargeFlat,
        applyLateNightFlatYen,
        applyEarlyMorningFlatYen,
        applyEarlyRushFlatYen,
        applyLeftHandSurchargeFlat,
      });
    } else {
      fareYen = 0;
      tariffVersionId = null;
    }

    const excludeFromOfficialPrint =
      req.body?.excludeFromOfficialPrint !== undefined ? Boolean(req.body.excludeFromOfficialPrint) : trip.excludeFromOfficialPrint;

    let departedAt = trip.departedAt;
    let arrivedAt = trip.arrivedAt;
    if (req.body?.departedAt !== undefined) {
      const d = new Date(String(req.body.departedAt));
      if (!Number.isFinite(d.getTime())) return reply.code(400).send({ error: "invalid departedAt" });
      departedAt = d;
    }
    if (req.body?.arrivedAt !== undefined) {
      const d = new Date(String(req.body.arrivedAt));
      if (!Number.isFinite(d.getTime())) return reply.code(400).send({ error: "invalid arrivedAt" });
      arrivedAt = d;
    }
    if (departedAt >= arrivedAt) return reply.code(400).send({ error: "departedAt must be before arrivedAt" });

    let nextRole = trip.role;
    if (req.body?.role === "PARTNER_DRIVER" || req.body?.role === "MAIN_DRIVER") {
      nextRole = req.body.role;
    }

    let charterVehicleNo = trip.charterVehicleNo;
    if (req.body?.charterVehicleNo !== undefined) {
      charterVehicleNo =
        req.body.charterVehicleNo === null || req.body.charterVehicleNo === ""
          ? null
          : String(req.body.charterVehicleNo).trim() || null;
    }
    let viaNote = trip.viaNote;
    if (req.body?.viaNote !== undefined) {
      viaNote = req.body.viaNote === null || req.body.viaNote === "" ? null : String(req.body.viaNote).trim() || null;
    }

    const updated = await prisma.tripLeg.update({
      where: { id: trip.id },
      data: {
        ...(req.body?.clientName !== undefined ? { clientName: String(req.body.clientName).trim() } : {}),
        ...(req.body?.origin !== undefined ? { origin: String(req.body.origin).trim() } : {}),
        ...(req.body?.destination !== undefined ? { destination: String(req.body.destination).trim() } : {}),
        ...(req.body?.charterVehicleNo !== undefined ? { charterVehicleNo } : {}),
        ...(req.body?.viaNote !== undefined ? { viaNote } : {}),
        departedAt,
        arrivedAt,
        role: nextRole,
        distanceM,
        waitingMinutes,
        tariffVersionId,
        fareYen,
        passengerKind,
        viaStopCount,
        applyNightSurcharge,
        applyLeftHandSurcharge,
        pickupFromBaseM,
        applyNightSurchargeFlat,
        applyLateNightFlatYen,
        applyEarlyMorningFlatYen,
        applyEarlyRushFlatYen,
        applyLeftHandSurchargeFlat,
        customerId,
        referralSourceId,
        fareOverrideYen: fareOverrideYen !== undefined ? fareOverrideYen : trip.fareOverrideYen,
        excludeFromOfficialPrint,
      },
      include: tripRel,
    });
    return updated;
  });
}

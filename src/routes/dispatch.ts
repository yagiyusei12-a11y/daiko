import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { authenticate, jwtUser } from "../auth/pre.js";
import {
  coerceBusinessBasicsFromCustomJson,
  resolveBusinessHoursForYmd,
} from "../lib/business-basics.js";
import {
  coerceDetail,
  createDispatchReservationExplicit,
  DispatchReservationOverlapError,
  parseDutiesJson,
  YMD_RE,
} from "../lib/dispatch-reservation.js";
import { SCHEDULE_UNASSIGNED_DRIVER_ID } from "../lib/schedule-constants.js";
import { loadUserAccess, type UserAccessContext } from "../lib/permissions.js";
import {
  coerceReservationTimingFromCustomJson,
  resolveBlockedMinutesForDispatchBody,
} from "../lib/reservation-timing-settings.js";
import { prisma } from "../db.js";
import { parseTokyoLocalDateTimeToUtc, tokyoDayRangeUtc } from "../lib/tokyo-datetime.js";

async function loadDriverRows(
  tenantId: string,
  date: string,
  access: UserAccessContext,
): Promise<Array<{ employeeId: string; name: string; startTime: string; endTime: string }>> {
  const where: Prisma.ConfirmedShiftDayWhereInput = { tenantId, businessDate: date };
  if (access.isStaffShiftOnly && access.employeeId) {
    where.employeeId = access.employeeId;
  }
  const rows = await prisma.confirmedShiftDay.findMany({
    where,
    include: { employee: { select: { familyName: true, givenName: true } } },
    orderBy: [{ employee: { familyName: "asc" } }, { employee: { givenName: "asc" } }],
  });
  const out = rows
    .filter((r) => parseDutiesJson(r.dutiesJson).includes("客車"))
    .map((r) => ({
      employeeId: r.employeeId,
      name: `${r.employee.familyName} ${r.employee.givenName}`,
      startTime: r.startTime,
      endTime: r.endTime,
    }));
  if (out.length === 0) {
    out.push({
      employeeId: SCHEDULE_UNASSIGNED_DRIVER_ID,
      name: "未予定",
      startTime: "0:00",
      endTime: "24:00",
    });
  }
  return out;
}

export async function registerDispatchRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get<{ Querystring: { date?: string } }>("/schedule", async (req, reply) => {
    const { tenantId, sub: userId } = jwtUser(req);
    const access = await loadUserAccess(userId, tenantId);
    const date = String(req.query?.date ?? "").trim();
    if (!YMD_RE.test(date)) {
      return reply.code(400).send({ error: "date は yyyy-MM-dd で指定してください" });
    }

    const range = tokyoDayRangeUtc(date);
    if (!range) return reply.code(400).send({ error: "日付が不正です" });

    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    const basics = coerceBusinessBasicsFromCustomJson(settings?.customJson);
    const businessHours = resolveBusinessHoursForYmd(date, basics);

    const drivers = await loadDriverRows(tenantId, date, access);

    const resWhere: Prisma.DispatchReservationWhereInput = {
      tenantId,
      startsAt: { lt: range.end },
      endsAt: { gt: range.start },
    };
    if (access.isStaffShiftOnly && access.employeeId) {
      resWhere.OR = [{ driverEmployeeId: access.employeeId }, { driverEmployeeId: null }];
    }

    const reservations = await prisma.dispatchReservation.findMany({
      where: resWhere,
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        driverEmployeeId: true,
        vehicleId: true,
        detailJson: true,
      },
    });

    return {
      date,
      businessHours,
      drivers,
      reservations: reservations.map((r) => ({
        id: r.id,
        title: r.title,
        startsAt: r.startsAt.toISOString(),
        endsAt: r.endsAt.toISOString(),
        driverEmployeeId: r.driverEmployeeId,
        vehicleId: r.vehicleId,
        detail: coerceDetail(r.detailJson),
      })),
    };
  });

  app.post<{ Body: Record<string, unknown> }>("/reservations", async (req, reply) => {
    const { tenantId, sub: userId } = jwtUser(req);
    const access = await loadUserAccess(userId, tenantId);
    const b = req.body || {};

    const startLocal = String(b.startLocal ?? "").trim();
    const driverRaw = String(b.driverEmployeeId ?? "").trim();
    const vehicleIdRaw = b.vehicleId !== undefined && b.vehicleId !== null ? String(b.vehicleId).trim() : "";
    const vehicleId = vehicleIdRaw || null;

    const detail = coerceDetail(b.detail);

    if (!detail.customerName) {
      return reply.code(400).send({ error: "客名を入力してください" });
    }
    if (!detail.pickup || !detail.dropoff) {
      return reply.code(400).send({ error: "迎え先と送り先を入力してください" });
    }
    if (!startLocal) {
      return reply.code(400).send({ error: "日時を入力してください" });
    }

    const settingsRow = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    const timing = coerceReservationTimingFromCustomJson(settingsRow?.customJson);
    const resolved = resolveBlockedMinutesForDispatchBody(b as Record<string, unknown>, timing);
    if (!resolved.ok) {
      return reply.code(400).send({ error: resolved.error });
    }

    if (!driverRaw) {
      return reply.code(400).send({ error: "客車担当者を選んでください" });
    }

    const driverUnassigned = driverRaw === SCHEDULE_UNASSIGNED_DRIVER_ID;
    const driverEmployeeId: string | null = driverUnassigned ? null : driverRaw;

    if (access.isStaffShiftOnly) {
      if (!driverUnassigned) {
        if (!access.employeeId || driverRaw !== access.employeeId) {
          return reply.code(403).send({ error: "このアカウントでは選べる客車担当者はご自身のみです" });
        }
      }
    }

    const startsAt = parseTokyoLocalDateTimeToUtc(startLocal);
    if (!startsAt || Number.isNaN(startsAt.getTime())) {
      return reply.code(400).send({ error: "日時の形式が不正です" });
    }
    const endsAt = new Date(startsAt.getTime() + resolved.blockedMinutes * 60 * 1000);

    const businessDate = startLocal.slice(0, 10);
    if (!YMD_RE.test(businessDate)) {
      return reply.code(400).send({ error: "日時に日付が含まれていません" });
    }

    if (driverEmployeeId !== null) {
      const conf = await prisma.confirmedShiftDay.findFirst({
        where: { tenantId, businessDate, employeeId: driverEmployeeId },
        select: { dutiesJson: true },
      });
      if (!conf || !parseDutiesJson(conf.dutiesJson).includes("客車")) {
        return reply.code(400).send({ error: "その日の確定シフトで客車を担当している従業員を選んでください" });
      }

      const emp = await prisma.employee.findFirst({
        where: { id: driverEmployeeId, tenantId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!emp) return reply.code(404).send({ error: "従業員が見つかりません" });
    }

    if (vehicleId) {
      const v = await prisma.vehicle.findFirst({ where: { id: vehicleId, tenantId }, select: { id: true } });
      if (!v) return reply.code(404).send({ error: "車両が見つかりません" });
    }

    try {
      const row = await createDispatchReservationExplicit({
        tenantId,
        driverEmployeeId,
        vehicleId,
        startsAt,
        endsAt,
        detail,
      });
      return { id: row.id };
    } catch (e) {
      if (e instanceof DispatchReservationOverlapError) {
        return reply.code(400).send({ error: e.message });
      }
      throw e;
    }
  });
}

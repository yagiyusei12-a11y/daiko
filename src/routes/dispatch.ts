import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { authenticateAndBilling } from "../auth/protected-pre.js";
import { jwtUser } from "../auth/pre.js";
import {
  coerceBusinessBasicsFromCustomJson,
  resolveBusinessHoursForYmd,
} from "../lib/business-basics.js";
import {
  coerceDetail,
  createDispatchReservationExplicit,
  DispatchReservationNotFoundError,
  DispatchReservationOverlapError,
  DispatchReservationSlotTakenError,
  parseDutiesJson,
  updateDispatchReservationWithPatch,
  YMD_RE,
} from "../lib/dispatch-reservation.js";
import {
  SCHEDULE_UNASSIGNED_DRIVER_ID,
  scheduleDriverFieldToDb,
  scheduleUnassignedLaneEmployeeId,
} from "../lib/schedule-constants.js";
import { loadUserAccess, type UserAccessContext } from "../lib/permissions.js";
import {
  coerceReservationTimingFromCustomJson,
  resolveBlockedMinutesForDispatchBody,
  resolveVirtualConcurrentSlotsForDate,
} from "../lib/reservation-timing-settings.js";
import { prisma } from "../db.js";
import {
  formatUtcAsTokyoDatetimeLocal,
  parseTokyoLocalDateTimeToUtc,
  tokyoDayRangeUtc,
} from "../lib/tokyo-datetime.js";

type DriverRow = { employeeId: string; name: string; startTime: string; endTime: string };

async function loadShiftDriverRows(
  tenantId: string,
  date: string,
  access: UserAccessContext,
): Promise<DriverRow[]> {
  const where: Prisma.ConfirmedShiftDayWhereInput = { tenantId, businessDate: date };
  if (access.isStaffShiftOnly && access.employeeId) {
    where.employeeId = access.employeeId;
  }
  const rows = await prisma.confirmedShiftDay.findMany({
    where,
    include: { employee: { select: { familyName: true, givenName: true } } },
    orderBy: [{ employee: { familyName: "asc" } }, { employee: { givenName: "asc" } }],
  });
  return rows
    .filter((r) => parseDutiesJson(r.dutiesJson).includes("客車"))
    .map((r) => ({
      employeeId: r.employeeId,
      name: `${r.employee.familyName} ${r.employee.givenName}`,
      startTime: r.startTime,
      endTime: r.endTime,
    }));
}

function unassignedVirtualDriverRows(effectiveSlots: number): DriverRow[] {
  const n = Math.max(1, Math.min(50, Math.floor(effectiveSlots)));
  return Array.from({ length: n }, (_, i) => {
    const lane = i + 1;
    return {
      employeeId: lane === 1 ? SCHEDULE_UNASSIGNED_DRIVER_ID : scheduleUnassignedLaneEmployeeId(lane),
      name: lane === 1 ? "未予定" : `未予定${lane}`,
      startTime: "0:00",
      endTime: "24:00",
    };
  });
}

export async function registerDispatchRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticateAndBilling);

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
    const rollHour = settings?.businessDayRollHour ?? 4;
    // 事業日のロールオーバー分だけ終端を延長（例: rollHour=4 → 翌 4:00 まで）
    const extendedEnd = new Date(range.end.getTime() + rollHour * 60 * 60 * 1000);

    const basics = coerceBusinessBasicsFromCustomJson(settings?.customJson);
    const businessHours = resolveBusinessHoursForYmd(date, basics);
    const timing = coerceReservationTimingFromCustomJson(settings?.customJson);
    const effectiveVirtualSlots = resolveVirtualConcurrentSlotsForDate(date, timing);

    const shiftDrivers = await loadShiftDriverRows(tenantId, date, access);

    let drivers: DriverRow[];
    if (timing.availabilityMode === "virtual_concurrent") {
      drivers = [...shiftDrivers, ...unassignedVirtualDriverRows(effectiveVirtualSlots)];
    } else if (shiftDrivers.length > 0) {
      drivers = shiftDrivers;
    } else {
      drivers = [
        {
          employeeId: SCHEDULE_UNASSIGNED_DRIVER_ID,
          name: "未予定",
          startTime: "0:00",
          endTime: "24:00",
        },
      ];
    }

    const resWhere: Prisma.DispatchReservationWhereInput = {
      tenantId,
      startsAt: { lt: extendedEnd },
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
        virtualLane: true,
        vehicleId: true,
        detailJson: true,
      },
    });

    return {
      date,
      businessHours,
      availabilityMode: timing.availabilityMode,
      effectiveVirtualSlots,
      drivers,
      reservations: reservations.map((r) => ({
        id: r.id,
        title: r.title,
        startsAt: r.startsAt.toISOString(),
        endsAt: r.endsAt.toISOString(),
        driverEmployeeId: r.driverEmployeeId,
        virtualLane: r.virtualLane,
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

    const parsedDriver = scheduleDriverFieldToDb(
      driverRaw || SCHEDULE_UNASSIGNED_DRIVER_ID,
    );
    if (
      timing.availabilityMode === "confirmed_shifts" &&
      parsedDriver.driverEmployeeId === null &&
      (parsedDriver.virtualLane ?? 1) > 1
    ) {
      return reply.code(400).send({ error: "このモードでは未予定は1列のみです" });
    }

    if (access.isStaffShiftOnly) {
      if (parsedDriver.driverEmployeeId !== null) {
        if (!access.employeeId || parsedDriver.driverEmployeeId !== access.employeeId) {
          return reply.code(403).send({ error: "このアカウントでは選べる客車担当者はご自身のみです" });
        }
      }
    }

    const startsAt = parseTokyoLocalDateTimeToUtc(startLocal);
    if (!startsAt || Number.isNaN(startsAt.getTime())) {
      return reply.code(400).send({ error: "日時の形式が不正です" });
    }
    const endsAt = new Date(startsAt.getTime() + resolved.blockedMinutes * 60 * 1000);

    // 事業日計算: rollHour 未満（翌暦日0:00〜rollHour:00）は前事業日
    const calDateOfStart = startLocal.slice(0, 10);
    const startHour = Number(startLocal.slice(11, 13));
    let businessDate = calDateOfStart;
    const tsRollHour = settingsRow?.businessDayRollHour ?? 4;
    if (!Number.isNaN(startHour) && tsRollHour > 0 && startHour < tsRollHour) {
      // 前日の事業日にする
      const [sy, sm, sd] = calDateOfStart.split("-").map(Number);
      const prev = new Date(Date.UTC(sy, sm - 1, sd - 1, 12, 0, 0));
      businessDate = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-${String(prev.getUTCDate()).padStart(2, "0")}`;
    }
    if (!YMD_RE.test(businessDate)) {
      return reply.code(400).send({ error: "日時に日付が含まれていません" });
    }

    if (parsedDriver.driverEmployeeId !== null) {
      const conf = await prisma.confirmedShiftDay.findFirst({
        where: { tenantId, businessDate: businessDate, employeeId: parsedDriver.driverEmployeeId },
        select: { dutiesJson: true },
      });
      if (!conf || !parseDutiesJson(conf.dutiesJson).includes("客車")) {
        return reply.code(400).send({ error: "その日の確定シフトで客車を担当している従業員を選んでください" });
      }

      const emp = await prisma.employee.findFirst({
        where: { id: parsedDriver.driverEmployeeId, tenantId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!emp) return reply.code(404).send({ error: "従業員が見つかりません" });
    }

    if (vehicleId) {
      const v = await prisma.vehicle.findFirst({ where: { id: vehicleId, tenantId }, select: { id: true } });
      if (!v) return reply.code(404).send({ error: "車両が見つかりません" });
    }

    const unassignedVirtual =
      parsedDriver.driverEmployeeId === null && timing.availabilityMode === "virtual_concurrent"
        ? { businessDateTokyo: businessDate, timing }
        : undefined;

    try {
      const row = await createDispatchReservationExplicit({
        tenantId,
        driverEmployeeId: parsedDriver.driverEmployeeId,
        vehicleId,
        startsAt,
        endsAt,
        detail,
        virtualLane: parsedDriver.driverEmployeeId === null ? parsedDriver.virtualLane : null,
        unassignedVirtual,
      });
      return { id: row.id };
    } catch (e) {
      if (e instanceof DispatchReservationOverlapError) {
        return reply.code(400).send({ error: e.message });
      }
      if (e instanceof DispatchReservationSlotTakenError) {
        return reply.code(409).send({ error: e.message, code: e.code });
      }
      throw e;
    }
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>("/reservations/:id", async (req, reply) => {
    const { tenantId, sub: userId } = jwtUser(req);
    const access = await loadUserAccess(userId, tenantId);
    const id = String(req.params.id ?? "").trim();
    if (!id) return reply.code(400).send({ error: "id が不正です" });

    const cur = await prisma.dispatchReservation.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        driverEmployeeId: true,
        virtualLane: true,
        vehicleId: true,
        detailJson: true,
      },
    });
    if (!cur) return reply.code(404).send({ error: "予約が見つかりません" });

    if (access.isStaffShiftOnly && access.employeeId) {
      if (cur.driverEmployeeId !== null && cur.driverEmployeeId !== access.employeeId) {
        return reply.code(403).send({ error: "この予約を編集する権限がありません" });
      }
    }

    const settingsRow = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    const timing = coerceReservationTimingFromCustomJson(settingsRow?.customJson);

    const b = req.body || {};
    const patch: Parameters<typeof updateDispatchReservationWithPatch>[0]["patch"] = {};

    const startLocal = String(b.startLocal ?? "").trim();
    const hasTrip =
      b.tripEstimateMinutes !== undefined &&
      b.tripEstimateMinutes !== null &&
      String(b.tripEstimateMinutes).trim() !== "";
    const hasDur =
      b.durationMinutes !== undefined && b.durationMinutes !== null && String(b.durationMinutes).trim() !== "";

    let startsAt = cur.startsAt;
    let endsAt = cur.endsAt;
    let timeDirty = false;

    if (startLocal) {
      const p = parseTokyoLocalDateTimeToUtc(startLocal);
      if (!p || Number.isNaN(p.getTime())) {
        return reply.code(400).send({ error: "日時の形式が不正です" });
      }
      startsAt = p;
      timeDirty = true;
    }

    if (hasTrip || hasDur) {
      const resolved = resolveBlockedMinutesForDispatchBody(b as Record<string, unknown>, timing);
      if (!resolved.ok) return reply.code(400).send({ error: resolved.error });
      endsAt = new Date(startsAt.getTime() + resolved.blockedMinutes * 60 * 1000);
      timeDirty = true;
    } else if (timeDirty) {
      const durMs = cur.endsAt.getTime() - cur.startsAt.getTime();
      endsAt = new Date(startsAt.getTime() + durMs);
    }

    if (timeDirty) {
      patch.startsAt = startsAt;
      patch.endsAt = endsAt;
    }

    if (b.detail !== undefined) {
      patch.detail = coerceDetail(b.detail);
    }

    if (b.vehicleId !== undefined) {
      const vehicleIdRaw = b.vehicleId !== null ? String(b.vehicleId).trim() : "";
      const nextVid = vehicleIdRaw || null;
      if (nextVid) {
        const v = await prisma.vehicle.findFirst({ where: { id: nextVid, tenantId }, select: { id: true } });
        if (!v) return reply.code(404).send({ error: "車両が見つかりません" });
      }
      patch.vehicleId = nextVid;
    }

    const driverKeyPresent = Object.prototype.hasOwnProperty.call(b, "driverEmployeeId");
    if (driverKeyPresent) {
      const driverRaw = String(b.driverEmployeeId ?? "").trim();
      if (!driverRaw) {
        return reply.code(400).send({ error: "客車担当者を選んでください" });
      }
      const parsedDriver = scheduleDriverFieldToDb(driverRaw);
      if (
        timing.availabilityMode === "confirmed_shifts" &&
        parsedDriver.driverEmployeeId === null &&
        (parsedDriver.virtualLane ?? 1) > 1
      ) {
        return reply.code(400).send({ error: "このモードでは未予定は1列のみです" });
      }
      if (access.isStaffShiftOnly) {
        if (parsedDriver.driverEmployeeId !== null) {
          if (!access.employeeId || parsedDriver.driverEmployeeId !== access.employeeId) {
            return reply.code(403).send({ error: "このアカウントでは選べる客車担当者はご自身のみです" });
          }
        }
      }
      if (parsedDriver.driverEmployeeId !== null) {
        const businessDateForShift = formatUtcAsTokyoDatetimeLocal(startsAt).slice(0, 10);
        if (!YMD_RE.test(businessDateForShift)) {
          return reply.code(400).send({ error: "予約の日付を解釈できません" });
        }
        const conf = await prisma.confirmedShiftDay.findFirst({
          where: { tenantId, businessDate: businessDateForShift, employeeId: parsedDriver.driverEmployeeId },
          select: { dutiesJson: true },
        });
        if (!conf || !parseDutiesJson(conf.dutiesJson).includes("客車")) {
          return reply.code(400).send({ error: "その日の確定シフトで客車を担当している従業員を選んでください" });
        }
        const emp = await prisma.employee.findFirst({
          where: { id: parsedDriver.driverEmployeeId, tenantId, status: "ACTIVE" },
          select: { id: true },
        });
        if (!emp) return reply.code(404).send({ error: "従業員が見つかりません" });
      }
      patch.driverEmployeeId = parsedDriver.driverEmployeeId;
      patch.virtualLane = parsedDriver.driverEmployeeId === null ? (parsedDriver.virtualLane ?? 1) : null;
    }

    const businessDateTokyo = formatUtcAsTokyoDatetimeLocal(patch.startsAt ?? cur.startsAt).slice(0, 10);
    if (!YMD_RE.test(businessDateTokyo)) {
      return reply.code(400).send({ error: "日付が不正です" });
    }

    if (Object.keys(patch).length === 0) {
      return reply.code(400).send({ error: "更新する項目がありません" });
    }

    try {
      await updateDispatchReservationWithPatch({
        tenantId,
        reservationId: id,
        patch,
        timing,
        businessDateTokyo,
      });
      return { ok: true };
    } catch (e) {
      if (e instanceof DispatchReservationNotFoundError) {
        return reply.code(404).send({ error: e.message });
      }
      if (e instanceof DispatchReservationOverlapError) {
        return reply.code(400).send({ error: e.message });
      }
      if (e instanceof DispatchReservationSlotTakenError) {
        return reply.code(409).send({ error: e.message, code: e.code });
      }
      throw e;
    }
  });

  app.delete<{ Params: { id: string } }>("/reservations/:id", async (req, reply) => {
    const { tenantId, sub: userId } = jwtUser(req);
    const access = await loadUserAccess(userId, tenantId);
    const id = String(req.params.id ?? "").trim();
    if (!id) return reply.code(400).send({ error: "id が不正です" });

    const cur = await prisma.dispatchReservation.findFirst({
      where: { id, tenantId },
      select: { id: true, driverEmployeeId: true },
    });
    if (!cur) return reply.code(404).send({ error: "予約が見つかりません" });

    if (access.isStaffShiftOnly && access.employeeId) {
      if (cur.driverEmployeeId !== null && cur.driverEmployeeId !== access.employeeId) {
        return reply.code(403).send({ error: "この予約を削除する権限がありません" });
      }
    }

    await prisma.dispatchReservation.delete({ where: { id } });
    return reply.send({ ok: true });
  });
}

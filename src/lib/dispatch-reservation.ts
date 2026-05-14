import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { tokyoDayRangeUtc } from "./tokyo-datetime.js";
import type { ReservationTimingSettings } from "./reservation-timing-settings.js";
import { resolveVirtualConcurrentSlotsForDate } from "./reservation-timing-settings.js";

export class DispatchReservationNotFoundError extends Error {
  constructor() {
    super("予約が見つかりません");
    this.name = "DispatchReservationNotFoundError";
  }
}

export const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const DUTY_WHITELIST = new Set(["客車", "随伴車", "電話", "スケジュール"]);

const FLEX_HM = /^(\d{1,2}):(\d{2})$/;

export function flexHmToMinutesSinceMidnight(hm: string): number | null {
  const m = FLEX_HM.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 48 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function parseDutiesJson(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x === "string" && DUTY_WHITELIST.has(x)) out.push(x);
  }
  return [...new Set(out)];
}

export type DispatchDetail = {
  customerName: string;
  phone: string;
  pickup: string;
  viaStops: string[];
  dropoff: string;
  vehicleNumber: string;
  parking: string;
};

export function coerceDetail(raw: unknown): DispatchDetail {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      customerName: "",
      phone: "",
      pickup: "",
      viaStops: [],
      dropoff: "",
      vehicleNumber: "",
      parking: "",
    };
  }
  const o = raw as Record<string, unknown>;
  const via: string[] = [];
  if (Array.isArray(o.viaStops)) {
    for (const x of o.viaStops) {
      if (typeof x === "string" && x.trim()) via.push(x.trim());
    }
  }
  return {
    customerName: typeof o.customerName === "string" ? o.customerName.trim() : "",
    phone: typeof o.phone === "string" ? o.phone.trim() : "",
    pickup: typeof o.pickup === "string" ? o.pickup.trim() : "",
    viaStops: via,
    dropoff: typeof o.dropoff === "string" ? o.dropoff.trim() : "",
    vehicleNumber: typeof o.vehicleNumber === "string" ? o.vehicleNumber.trim() : "",
    parking: typeof o.parking === "string" ? o.parking.trim() : "",
  };
}

/** 勤務 [shiftStart, shiftEnd) が予約 [bookingStart, bookingEnd) を端点含めず重複するか（半開区間の重なり） */
export function intervalsOverlap(bookingStart: Date, bookingEnd: Date, shiftStart: Date, shiftEnd: Date): boolean {
  return bookingStart < shiftEnd && bookingEnd > shiftStart;
}

export function shiftWindowUtcFromConfirmedRow(
  businessDate: string,
  startTime: string,
  endTime: string,
): { start: Date; end: Date } | null {
  const range = tokyoDayRangeUtc(businessDate);
  if (!range) return null;
  const startMin = flexHmToMinutesSinceMidnight(startTime);
  let endMin = flexHmToMinutesSinceMidnight(endTime);
  if (startMin === null || endMin === null) return null;
  if (endMin <= startMin) endMin += 24 * 60;
  return {
    start: new Date(range.start.getTime() + startMin * 60 * 1000),
    end: new Date(range.start.getTime() + endMin * 60 * 1000),
  };
}

export type DriverShiftRow = { employeeId: string; shiftStart: Date; shiftEnd: Date };

export async function loadDriverShiftsWithDuty(
  db: Pick<Prisma.TransactionClient, "confirmedShiftDay">,
  tenantId: string,
  businessDate: string,
): Promise<DriverShiftRow[]> {
  const rows = await db.confirmedShiftDay.findMany({
    where: { tenantId, businessDate },
    select: { employeeId: true, startTime: true, endTime: true, dutiesJson: true },
    orderBy: { employeeId: "asc" },
  });
  const out: DriverShiftRow[] = [];
  for (const r of rows) {
    if (!parseDutiesJson(r.dutiesJson).includes("客車")) continue;
    const w = shiftWindowUtcFromConfirmedRow(businessDate, r.startTime, r.endTime);
    if (!w) continue;
    out.push({ employeeId: r.employeeId, shiftStart: w.start, shiftEnd: w.end });
  }
  return out;
}

export function shiftFullyContainsBooking(shiftStart: Date, shiftEnd: Date, bookingStart: Date, bookingEnd: Date): boolean {
  return shiftStart <= bookingStart && shiftEnd >= bookingEnd;
}

export async function hasOverlappingReservation(
  db: Pick<Prisma.TransactionClient, "dispatchReservation">,
  tenantId: string,
  driverEmployeeId: string | null,
  startsAt: Date,
  endsAt: Date,
  excludeReservationId?: string,
): Promise<boolean> {
  if (driverEmployeeId === null) {
    return false;
  }
  const overlap = await db.dispatchReservation.findFirst({
    where: {
      tenantId,
      driverEmployeeId,
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      ...(excludeReservationId ? { id: { not: excludeReservationId } } : {}),
    },
    select: { id: true },
  });
  return Boolean(overlap);
}

/** テナント内で時間帯が重なる予約件数（仮想枠・同時上限用） */
export async function countTenantOverlappingReservations(
  db: Pick<Prisma.TransactionClient, "dispatchReservation">,
  tenantId: string,
  startsAt: Date,
  endsAt: Date,
  excludeReservationId?: string,
): Promise<number> {
  return db.dispatchReservation.count({
    where: {
      tenantId,
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      ...(excludeReservationId ? { id: { not: excludeReservationId } } : {}),
    },
  });
}

export const SLOT_TAKEN_CODE = "SLOT_TAKEN" as const;

export class DispatchReservationSlotTakenError extends Error {
  readonly code = SLOT_TAKEN_CODE;
  constructor(message = "希望の枠に空きがありません") {
    super(message);
    this.name = "DispatchReservationSlotTakenError";
  }
}

export class DispatchReservationOverlapError extends Error {
  constructor(message = "その時間帯には別の予約と重なります") {
    super(message);
    this.name = "DispatchReservationOverlapError";
  }
}

function assertDurationMinutes(durationMinutes: number): void {
  if (!Number.isFinite(durationMinutes) || durationMinutes < 15 || durationMinutes > 480 || durationMinutes % 15 !== 0) {
    throw new Error("INVALID_DURATION");
  }
}

/** 未割当かつ同一レーンで時間重なる予約があるか（virtualLane null はレーン1扱い） */
export async function hasOverlappingUnassignedInLane(
  db: Pick<Prisma.TransactionClient, "dispatchReservation">,
  tenantId: string,
  lane: number,
  startsAt: Date,
  endsAt: Date,
  excludeReservationId?: string,
): Promise<boolean> {
  const base = {
    tenantId,
    driverEmployeeId: null,
    startsAt: { lt: endsAt },
    endsAt: { gt: startsAt },
    ...(excludeReservationId ? { id: { not: excludeReservationId } } : {}),
  } as const;
  const where =
    lane <= 1
      ? { ...base, OR: [{ virtualLane: 1 }, { virtualLane: null }] }
      : { ...base, virtualLane: lane };
  const hit = await db.dispatchReservation.findFirst({ where, select: { id: true } });
  return Boolean(hit);
}

export async function pickFirstFreeVirtualLane(
  tx: Pick<Prisma.TransactionClient, "dispatchReservation">,
  tenantId: string,
  startsAt: Date,
  endsAt: Date,
  cap: number,
): Promise<number | null> {
  const c = Math.max(1, Math.min(50, Math.floor(cap)));
  for (let lane = 1; lane <= c; lane++) {
    const busy = await hasOverlappingUnassignedInLane(tx, tenantId, lane, startsAt, endsAt);
    if (!busy) return lane;
  }
  return null;
}

export async function createDispatchReservationExplicitInTransaction(
  tx: Prisma.TransactionClient,
  args: {
    tenantId: string;
    driverEmployeeId: string | null;
    vehicleId: string | null;
    startsAt: Date;
    endsAt: Date;
    detail: DispatchDetail;
    /** 担当 null のときのみ有効（1〜50）。担当ありのときは無視され null 保存。 */
    virtualLane?: number | null;
    /** 担当 null かつ仮想枠モードのとき、テナント同時上限を検証する */
    unassignedVirtual?: { businessDateTokyo: string; timing: ReservationTimingSettings };
  },
): Promise<{ id: string }> {
  assertDurationMinutes(Math.round((args.endsAt.getTime() - args.startsAt.getTime()) / 60000));

  const title = `${args.detail.customerName}（${args.detail.pickup}→${args.detail.dropoff}）`.slice(0, 240);

  if (args.driverEmployeeId !== null) {
    const overlap = await hasOverlappingReservation(
      tx,
      args.tenantId,
      args.driverEmployeeId,
      args.startsAt,
      args.endsAt,
    );
    if (overlap) throw new DispatchReservationOverlapError();

    const row = await tx.dispatchReservation.create({
      data: {
        tenantId: args.tenantId,
        vehicleId: args.vehicleId,
        driverEmployeeId: args.driverEmployeeId,
        virtualLane: null,
        title,
        detailJson: args.detail as unknown as Prisma.InputJsonValue,
        startsAt: args.startsAt,
        endsAt: args.endsAt,
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  const v = args.virtualLane;
  const virtualLaneDb =
    v != null && Number.isInteger(v) && v >= 1 && v <= 50 ? v : 1;

  const laneBusy = await hasOverlappingUnassignedInLane(
    tx,
    args.tenantId,
    virtualLaneDb,
    args.startsAt,
    args.endsAt,
  );
  if (laneBusy) {
    throw new DispatchReservationOverlapError("この未予定列の同じ時間帯に別の予定があります");
  }

  if (args.unassignedVirtual?.timing.availabilityMode === "virtual_concurrent") {
    const cap = resolveVirtualConcurrentSlotsForDate(
      args.unassignedVirtual.businessDateTokyo,
      args.unassignedVirtual.timing,
    );
    if (virtualLaneDb > cap) {
      throw new DispatchReservationOverlapError(`未予定列は 1〜${cap} のみです`);
    }
    const n = await countTenantOverlappingReservations(tx, args.tenantId, args.startsAt, args.endsAt);
    if (n >= cap) throw new DispatchReservationSlotTakenError();
  }

  const row = await tx.dispatchReservation.create({
    data: {
      tenantId: args.tenantId,
      vehicleId: args.vehicleId,
      driverEmployeeId: null,
      virtualLane: virtualLaneDb,
      title,
      detailJson: args.detail as unknown as Prisma.InputJsonValue,
      startsAt: args.startsAt,
      endsAt: args.endsAt,
    },
    select: { id: true },
  });
  return { id: row.id };
}

export async function createDispatchReservationExplicit(args: {
  tenantId: string;
  driverEmployeeId: string | null;
  vehicleId: string | null;
  startsAt: Date;
  endsAt: Date;
  detail: DispatchDetail;
  virtualLane?: number | null;
  unassignedVirtual?: { businessDateTokyo: string; timing: ReservationTimingSettings };
}): Promise<{ id: string }> {
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => createDispatchReservationExplicitInTransaction(tx, args),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") continue;
      throw e;
    }
  }
  throw new DispatchReservationOverlapError("同時更新が集中しました。少し待って再度お試しください");
}

export async function createDispatchReservationPoolAssign(args: {
  tenantId: string;
  /** ConfirmedShiftDay.businessDate と一致する東京日付（startLocal の日付部） */
  businessDateTokyo: string;
  startsAt: Date;
  endsAt: Date;
  detail: DispatchDetail;
}): Promise<{ id: string; driverEmployeeId: string }> {
  const durationMinutes = Math.round((args.endsAt.getTime() - args.startsAt.getTime()) / 60000);
  assertDurationMinutes(durationMinutes);

  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const shifts = await loadDriverShiftsWithDuty(tx, args.tenantId, args.businessDateTokyo);
          const candidates = shifts
            .filter((s) => shiftFullyContainsBooking(s.shiftStart, s.shiftEnd, args.startsAt, args.endsAt))
            .sort((a, b) => a.employeeId.localeCompare(b.employeeId));

          for (const c of candidates) {
            const busy = await hasOverlappingReservation(tx, args.tenantId, c.employeeId, args.startsAt, args.endsAt);
            if (busy) continue;

            const emp = await tx.employee.findFirst({
              where: { id: c.employeeId, tenantId: args.tenantId, status: "ACTIVE" },
              select: { id: true },
            });
            if (!emp) continue;

            const title = `${args.detail.customerName}（${args.detail.pickup}→${args.detail.dropoff}）`.slice(0, 240);
            const row = await tx.dispatchReservation.create({
              data: {
                tenantId: args.tenantId,
                vehicleId: null,
                driverEmployeeId: c.employeeId,
                title,
                detailJson: args.detail as unknown as Prisma.InputJsonValue,
                startsAt: args.startsAt,
                endsAt: args.endsAt,
              },
              select: { id: true },
            });
            return { id: row.id, driverEmployeeId: c.employeeId };
          }

          throw new DispatchReservationSlotTakenError();
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (e) {
      if (e instanceof DispatchReservationSlotTakenError) throw e;
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") continue;
      throw e;
    }
  }
  throw new DispatchReservationSlotTakenError("同時更新が集中しました。空き状況を更新して再度お試しください");
}

export async function createDispatchReservationVirtualConcurrent(args: {
  tenantId: string;
  businessDateTokyo: string;
  startsAt: Date;
  endsAt: Date;
  detail: DispatchDetail;
  virtualConcurrentSlots: number;
}): Promise<{ id: string; driverEmployeeId: null }> {
  const durationMinutes = Math.round((args.endsAt.getTime() - args.startsAt.getTime()) / 60000);
  assertDurationMinutes(durationMinutes);
  const cap = Math.max(1, Math.min(50, Math.floor(args.virtualConcurrentSlots)));

  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const n = await countTenantOverlappingReservations(tx, args.tenantId, args.startsAt, args.endsAt);
          if (n >= cap) throw new DispatchReservationSlotTakenError();

          const lane = await pickFirstFreeVirtualLane(tx, args.tenantId, args.startsAt, args.endsAt, cap);
          if (lane === null) throw new DispatchReservationSlotTakenError();

          const title = `${args.detail.customerName}（${args.detail.pickup}→${args.detail.dropoff}）`.slice(0, 240);
          const row = await tx.dispatchReservation.create({
            data: {
              tenantId: args.tenantId,
              vehicleId: null,
              driverEmployeeId: null,
              virtualLane: lane,
              title,
              detailJson: args.detail as unknown as Prisma.InputJsonValue,
              startsAt: args.startsAt,
              endsAt: args.endsAt,
            },
            select: { id: true },
          });
          return { id: row.id, driverEmployeeId: null };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (e) {
      if (e instanceof DispatchReservationSlotTakenError) throw e;
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") continue;
      throw e;
    }
  }
  throw new DispatchReservationSlotTakenError("同時更新が集中しました。空き状況を更新して再度お試しください");
}

export type DispatchReservationPatch = {
  startsAt?: Date;
  endsAt?: Date;
  driverEmployeeId?: string | null;
  virtualLane?: number | null;
  vehicleId?: string | null;
  detail?: DispatchDetail;
};

export async function updateDispatchReservationWithPatch(args: {
  tenantId: string;
  reservationId: string;
  patch: DispatchReservationPatch;
  timing: ReservationTimingSettings;
  businessDateTokyo: string;
}): Promise<void> {
  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await prisma.$transaction(
        async (tx) => {
          const cur = await tx.dispatchReservation.findFirst({
            where: { id: args.reservationId, tenantId: args.tenantId },
            select: {
              id: true,
              driverEmployeeId: true,
              virtualLane: true,
              vehicleId: true,
              startsAt: true,
              endsAt: true,
              detailJson: true,
            },
          });
          if (!cur) throw new DispatchReservationNotFoundError();

          const startsAt = args.patch.startsAt ?? cur.startsAt;
          const endsAt = args.patch.endsAt ?? cur.endsAt;
          if (startsAt >= endsAt) throw new DispatchReservationOverlapError("終了は開始より後にしてください");

          let driverEmployeeId =
            args.patch.driverEmployeeId !== undefined ? args.patch.driverEmployeeId : cur.driverEmployeeId;
          let virtualLane = args.patch.virtualLane !== undefined ? args.patch.virtualLane : cur.virtualLane;
          const vehicleId = args.patch.vehicleId !== undefined ? args.patch.vehicleId : cur.vehicleId;
          const detail = args.patch.detail ?? coerceDetail(cur.detailJson);

          if (driverEmployeeId !== null) {
            virtualLane = null;
            const busy = await hasOverlappingReservation(tx, args.tenantId, driverEmployeeId, startsAt, endsAt, cur.id);
            if (busy) throw new DispatchReservationOverlapError();
          } else {
            const lane = virtualLane == null || virtualLane < 1 ? 1 : Math.min(50, Math.floor(virtualLane));
            virtualLane = lane;
            if (args.timing.availabilityMode === "virtual_concurrent") {
              const cap = resolveVirtualConcurrentSlotsForDate(args.businessDateTokyo, args.timing);
              if (lane > cap) {
                throw new DispatchReservationOverlapError(`未予定列は 1〜${cap} のみです`);
              }
              const n = await countTenantOverlappingReservations(tx, args.tenantId, startsAt, endsAt, cur.id);
              if (n >= cap) throw new DispatchReservationSlotTakenError();
              const laneBusy = await hasOverlappingUnassignedInLane(tx, args.tenantId, lane, startsAt, endsAt, cur.id);
              if (laneBusy) {
                throw new DispatchReservationOverlapError("この未予定列の同じ時間帯に別の予定があります");
              }
            }
          }

          const title = `${detail.customerName}（${detail.pickup}→${detail.dropoff}）`.slice(0, 240);

          await tx.dispatchReservation.update({
            where: { id: cur.id },
            data: {
              startsAt,
              endsAt,
              driverEmployeeId,
              virtualLane: driverEmployeeId === null ? virtualLane : null,
              vehicleId,
              detailJson: detail as unknown as Prisma.InputJsonValue,
              title,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return;
    } catch (e) {
      if (e instanceof DispatchReservationNotFoundError) throw e;
      if (e instanceof DispatchReservationOverlapError) throw e;
      if (e instanceof DispatchReservationSlotTakenError) throw e;
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") continue;
      throw e;
    }
  }
  throw new DispatchReservationOverlapError("同時更新が集中しました。少し待って再度お試しください");
}

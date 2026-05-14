import type { BusinessHoursSlot } from "./business-basics.js";
import {
  flexHmToMinutesSinceMidnight,
  intervalsOverlap,
  loadDriverShiftsWithDuty,
  shiftFullyContainsBooking,
} from "./dispatch-reservation.js";
import { prisma } from "../db.js";
import type { AvailabilityMode } from "./reservation-timing-settings.js";
import { tokyoDayRangeUtc } from "./tokyo-datetime.js";

export type LiffAvailabilitySlot = { startLocal: string; endLocal: string; availableCount: number };

/** 営業時間スロットを「その日の 0:00 からの分」座標の半開区間 [a, b) に変換（日跨ぎ close は +1440 分） */
export function businessSlotsToMinuteIntervals(slots: BusinessHoursSlot[]): [number, number][] {
  if (!slots.length) return [[0, 24 * 60]];
  const out: [number, number][] = [];
  for (const s of slots) {
    const o = flexHmToMinutesSinceMidnight(s.open);
    let c = flexHmToMinutesSinceMidnight(s.close);
    if (o === null || c === null) continue;
    if (c <= o) c += 24 * 60;
    out.push([o, c]);
  }
  return out.length > 0 ? out : [[0, 24 * 60]];
}

function canPlaceBookingAt(slotStartMin: number, durationMin: number, intervals: [number, number][]): boolean {
  return intervals.some(([a, b]) => a <= slotStartMin && slotStartMin + durationMin <= b);
}

export function utcDateToTokyoLocalDateTime(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const pick = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}`;
}

export async function computeLiffAvailabilitySlots(params: {
  tenantId: string;
  dateYmd: string;
  /** スケジュール上のブロック長（分）— 目安から算出済み */
  durationMinutes: number;
  businessIntervalsMin: [number, number][];
  availabilityMode?: AvailabilityMode;
  virtualConcurrentSlots?: number;
}): Promise<LiffAvailabilitySlot[]> {
  const range = tokyoDayRangeUtc(params.dateYmd);
  if (!range) return [];

  const resWhere = {
    tenantId: params.tenantId,
    startsAt: { lt: range.end },
    endsAt: { gt: range.start },
  };

  const reservations = await prisma.dispatchReservation.findMany({
    where: resWhere,
    select: { driverEmployeeId: true, startsAt: true, endsAt: true },
  });

  const mode: AvailabilityMode = params.availabilityMode ?? "confirmed_shifts";
  const virtualCap = Math.max(1, Math.min(50, Math.floor(params.virtualConcurrentSlots ?? 2)));

  const shifts =
    mode === "confirmed_shifts" ? await loadDriverShiftsWithDuty(prisma, params.tenantId, params.dateYmd) : [];

  const slots: LiffAvailabilitySlot[] = [];
  const step = 15;
  const dur = params.durationMinutes;

  for (let m = 0; m <= 24 * 60 - dur; m += step) {
    if (!canPlaceBookingAt(m, dur, params.businessIntervalsMin)) continue;

    const bookingStart = new Date(range.start.getTime() + m * 60 * 1000);
    const bookingEnd = new Date(bookingStart.getTime() + dur * 60 * 1000);

    let availableCount = 0;
    if (mode === "virtual_concurrent") {
      const overlapCount = reservations.filter((r) =>
        intervalsOverlap(bookingStart, bookingEnd, r.startsAt, r.endsAt),
      ).length;
      availableCount = Math.max(0, virtualCap - overlapCount);
    } else {
      for (const sh of shifts) {
        if (!shiftFullyContainsBooking(sh.shiftStart, sh.shiftEnd, bookingStart, bookingEnd)) continue;
        const busy = reservations.some(
          (r) =>
            r.driverEmployeeId === sh.employeeId &&
            intervalsOverlap(bookingStart, bookingEnd, r.startsAt, r.endsAt),
        );
        if (!busy) availableCount++;
      }
    }

    slots.push({
      startLocal: utcDateToTokyoLocalDateTime(bookingStart),
      endLocal: utcDateToTokyoLocalDateTime(bookingEnd),
      availableCount,
    });
  }

  return slots;
}

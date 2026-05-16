import type { ScheduleAxis } from "./schedule-day-layout";

export type { ScheduleAxis };

type BusinessHourSlot = { open: string; close: string };
type ReservationTimes = { startsAt: string; endsAt: string };

const FLEX_HM = /^(\d{1,2}):(\d{2})$/;

function flexHmToMinutes(s: string): number {
  const m = FLEX_HM.exec(s.trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function tokyoMidnightUtcMs(ymd: string): number {
  const [y, mo, d] = ymd.split("-").map(Number);
  return Date.UTC(y, mo - 1, d, -9, 0, 0, 0);
}

export function minutesSinceTokyoDay(ymd: string, iso: string): number {
  return Math.floor((new Date(iso).getTime() - tokyoMidnightUtcMs(ymd)) / 60000);
}

export function computeScheduleAxis(
  businessHours: BusinessHourSlot[],
  reservations: Array<ReservationTimes & { viewYmd: string }>,
  dayChangeHour: number,
): ScheduleAxis {
  const rollHour = dayChangeHour - 24;
  let mn = Number.POSITIVE_INFINITY;
  let mx = Number.NEGATIVE_INFINITY;

  for (const s of businessHours) {
    const a = flexHmToMinutes(s.open);
    const b = flexHmToMinutes(s.close);
    if (!Number.isNaN(a)) mn = Math.min(mn, a);
    if (!Number.isNaN(b)) mx = Math.max(mx, b);
  }

  if (!Number.isFinite(mn) || !Number.isFinite(mx) || mx <= mn) {
    mn = 7 * 60;
    mx = 22 * 60;
  }

  for (const rv of reservations) {
    const a = minutesSinceTokyoDay(rv.viewYmd, rv.startsAt);
    const b = minutesSinceTokyoDay(rv.viewYmd, rv.endsAt);
    if (Number.isFinite(a) && a > 0) mx = Math.max(mx, a + 30);
    if (Number.isFinite(b) && b > 0) mx = Math.max(mx, b);
  }

  if (rollHour > 0) {
    mx = Math.max(mx, (24 + rollHour) * 60);
  }

  const step = 15;
  const slotCount = Math.max(1, Math.ceil((mx - mn) / step));
  return { mn, mx, slotCount, step };
}

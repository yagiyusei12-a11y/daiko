import { minutesSinceTokyoDay } from "./schedule-axis";
import { shiftYmd } from "./schedule-week";

/** 15分刻みの分（0, 15, 30, 45） */
export const QUARTER_MINUTES = [0, 15, 30, 45] as const;

export function snapMinuteToQuarter(minute: number): (typeof QUARTER_MINUTES)[number] {
  const m = Math.max(0, Math.min(59, Math.round(minute)));
  const snapped = Math.round(m / 15) * 15;
  return (snapped === 60 ? 0 : snapped) as (typeof QUARTER_MINUTES)[number];
}

/** スケジュール入力用（事業日＋28時間表記の「時」） */
export type FlexScheduleDatetimeParts = {
  businessDateYmd: string;
  flexHour: number;
  minute: (typeof QUARTER_MINUTES)[number];
};

/** 事業日・flex時刻 → API 用 `YYYY-MM-DDTHH:mm`（東京壁時計） */
export function flexSchedulePartsToStartLocal(parts: FlexScheduleDatetimeParts): string {
  const calDate =
    parts.flexHour >= 24 ? shiftYmd(parts.businessDateYmd, 1) : parts.businessDateYmd;
  const calHour = parts.flexHour >= 24 ? parts.flexHour - 24 : parts.flexHour;
  return `${calDate}T${String(calHour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function toIsoForMinutesSinceDay(startLocalOrIso: string): string | null {
  const raw = startLocalOrIso.trim();
  const local = /^(\d{4}-\d{2}-\d{2})T(\d{1,2}):(\d{2})$/.exec(raw);
  if (local) {
    return `${local[1]}T${String(Number(local[2])).padStart(2, "0")}:${local[3]}:00+09:00`;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** `startLocal` または ISO を事業日基準の flex 時刻に変換 */
export function startLocalToFlexScheduleParts(
  businessDateYmd: string,
  startLocalOrIso: string,
  dayChangeHour: number,
): FlexScheduleDatetimeParts {
  const iso = toIsoForMinutesSinceDay(startLocalOrIso);
  if (!iso) {
    return { businessDateYmd, flexHour: 9, minute: 0 };
  }
  const totalMin = minutesSinceTokyoDay(businessDateYmd, iso);
  if (!Number.isFinite(totalMin)) {
    return { businessDateYmd, flexHour: 9, minute: 0 };
  }
  const snapped = Math.max(0, Math.round(totalMin / 15) * 15);
  const flexHour = Math.max(0, Math.min(dayChangeHour, Math.floor(snapped / 60)));
  const minute = snapMinuteToQuarter(snapped % 60);
  return { businessDateYmd, flexHour, minute };
}

/** 表示中の事業日・現在時刻からデフォルト `startLocal`（15分刻み） */
export function defaultStartLocalForScheduleBusinessDay(
  businessDateYmd: string,
  dayChangeHour: number,
): string {
  return startLocalFromIsoForBusinessDay(businessDateYmd, new Date().toISOString(), dayChangeHour);
}

/** ISO 瞬間を事業日・dayChangeHour 基準で `startLocal` に正規化 */
export function startLocalFromIsoForBusinessDay(
  businessDateYmd: string,
  iso: string,
  dayChangeHour: number,
): string {
  const parts = startLocalToFlexScheduleParts(businessDateYmd, iso, dayChangeHour);
  return flexSchedulePartsToStartLocal(parts);
}

export function snapQuarterHourDatetimeLocal(
  businessDateYmd: string,
  startLocal: string,
  dayChangeHour: number,
): string {
  const parts = startLocalToFlexScheduleParts(businessDateYmd, startLocal, dayChangeHour);
  return flexSchedulePartsToStartLocal(parts);
}

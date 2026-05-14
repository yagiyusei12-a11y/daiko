/** 事業日 yyyy-MM-dd の東京 0:00〜24:00 を UTC の絶対時刻で表す（JST は DST なし） */
export function tokyoDayRangeUtc(ymd: string): { start: Date; end: Date } | null {
  const p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!p) return null;
  const y = Number(p[1]);
  const mo = Number(p[2]);
  const d = Number(p[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  const startMs = Date.UTC(y, mo - 1, d, -9, 0, 0, 0);
  return { start: new Date(startMs), end: new Date(startMs + 24 * 60 * 60 * 1000) };
}

/** 日付＋時刻（datetime-local 相当）を東京の壁時計として UTC Date に変換 */
export function parseTokyoLocalDateTimeToUtc(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(local.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  const hh = Number(m[4]);
  const mm = Number(m[5]);
  const ss = m[6] ? Number(m[6]) : 0;
  if ([y, mo, day, hh, mm, ss].some((n) => !Number.isFinite(n))) return null;
  return new Date(Date.UTC(y, mo - 1, day, hh - 9, mm, ss));
}

/** 指定の東京日の 0:00 からの経過分（翌朝まで続く予定は 1440 超） */
export function minutesSinceTokyoMidnight(ymd: string, at: Date): number {
  const range = tokyoDayRangeUtc(ymd);
  if (!range) return NaN;
  return Math.floor((at.getTime() - range.start.getTime()) / 60000);
}

const YMD_T = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):/;

/**
 * datetime-local 相当の文字列（東京壁時計）と日付変更時刻（0〜6 時＝翌暦日の何時までが前事業日か）から事業日 yyyy-MM-dd を求める。
 */
export function businessDateYmdFromTokyoLocalDatetime(local: string, rollHour: number): string | null {
  const m = YMD_T.exec(local.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const hour = Number(m[4]);
  if (![y, mo, d, hour].every((n) => Number.isFinite(n))) return null;
  const cal = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (rollHour > 0 && hour < rollHour) {
    const prev = new Date(Date.UTC(y, mo - 1, d - 1, 12, 0, 0));
    return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-${String(prev.getUTCDate()).padStart(2, "0")}`;
  }
  return cal;
}

/** UTC の瞬間を、東京の壁時計で解釈した `datetime-local` 用 `yyyy-MM-ddTHH:mm` */
export function formatUtcAsTokyoDatetimeLocal(d: Date): string {
  const datePart = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const timePart = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${datePart}T${timePart}`;
}

/** 事業日 0:00 から翌暦日 rollHour（0〜6）までの UTC 範囲（予約重複チェック等） */
export function tokyoBusinessDayRangeUtc(ymd: string, rollHour: number): { start: Date; end: Date } | null {
  const base = tokyoDayRangeUtc(ymd);
  if (!base) return null;
  const rh = Math.max(0, Math.min(6, Math.floor(rollHour)));
  return { start: base.start, end: new Date(base.end.getTime() + rh * 60 * 60 * 1000) };
}

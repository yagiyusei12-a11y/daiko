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

/** 月曜始まりの週（7日分 yyyy-MM-dd） */
export function weekDatesContaining(ymd: string): string[] {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dow = dt.getUTCDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  dt.setUTCDate(dt.getUTCDate() + mondayOffset);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const cur = new Date(dt);
    cur.setUTCDate(dt.getUTCDate() + i);
    out.push(cur.toISOString().slice(0, 10));
  }
  return out;
}

export function shiftYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!Number.isFinite(y)) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

export function formatWeekRangeJa(dates: string[]): string {
  if (dates.length === 0) return "";
  const fmt = (ymd: string) => {
    const [y, mo, d] = ymd.split("-").map(Number);
    return new Intl.DateTimeFormat("ja-JP", {
      month: "short",
      day: "numeric",
      timeZone: "Asia/Tokyo",
    }).format(new Date(Date.UTC(y, mo - 1, d, 12, 0, 0)));
  };
  if (dates.length === 1) return fmt(dates[0]);
  return `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`;
}

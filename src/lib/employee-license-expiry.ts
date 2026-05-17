/** 東京暦の今日（yyyy-MM-dd） */
export function tokyoTodayYmd(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function parseYmdStrict(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const d = new Date(`${ymd}T12:00:00+09:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 暦月を加算（日は月末に丸め） */
export function addCalendarMonthsYmd(ymd: string, months: number): string {
  const d = parseYmdStrict(ymd);
  if (!d) return ymd;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const next = new Date(Date.UTC(y, m + months, day, 3, 0, 0));
  const yy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export type LicenseExpiryNotice = {
  expiresOn: string;
  daysRemaining: number;
};

/**
 * 有効期限の2か月前から（期限切れ後も）通知対象とする。
 * licenseExpiresOn が未設定・不正のときは null。
 */
export function computeLicenseExpiryNotice(
  licenseExpiresOn: string | null | undefined,
  todayYmd: string = tokyoTodayYmd(),
): LicenseExpiryNotice | null {
  const exp = String(licenseExpiresOn ?? "").trim();
  if (!exp) return null;
  const expDate = parseYmdStrict(exp);
  const todayDate = parseYmdStrict(todayYmd);
  if (!expDate || !todayDate) return null;

  const msPerDay = 86_400_000;
  const daysRemaining = Math.round((expDate.getTime() - todayDate.getTime()) / msPerDay);
  const warnUntil = addCalendarMonthsYmd(todayYmd, 2);
  const warnUntilDate = parseYmdStrict(warnUntil);
  if (!warnUntilDate) return null;
  if (expDate.getTime() > warnUntilDate.getTime()) return null;

  return { expiresOn: exp, daysRemaining };
}

export function registerExtensionStr(ext: unknown, key: string): string {
  if (ext === null || typeof ext !== "object" || Array.isArray(ext)) return "";
  const v = (ext as Record<string, unknown>)[key];
  return typeof v === "string" ? v.trim() : "";
}

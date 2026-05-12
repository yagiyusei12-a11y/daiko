/** 同一勤務内で次の日報作成に引き継ぐ車両・ペア（sessionStorage） */

export type ShiftDailyReportSession = {
  vehicleId: string;
  mainEmployeeId: string;
  partnerEmployeeId: string;
};

function storageKey(tenantId: string, userId: string): string {
  return `daiko.shiftDailyReportSession:${tenantId}:${userId}`;
}

export function loadShiftDailyReportSession(tenantId: string, userId: string): ShiftDailyReportSession | null {
  try {
    const raw = sessionStorage.getItem(storageKey(tenantId, userId));
    if (!raw) return null;
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return null;
    const rec = o as Record<string, unknown>;
    const vehicleId = typeof rec.vehicleId === "string" ? rec.vehicleId : "";
    const mainEmployeeId = typeof rec.mainEmployeeId === "string" ? rec.mainEmployeeId : "";
    const partnerEmployeeId = typeof rec.partnerEmployeeId === "string" ? rec.partnerEmployeeId : "";
    if (!vehicleId || !mainEmployeeId) return null;
    return { vehicleId, mainEmployeeId, partnerEmployeeId };
  } catch {
    return null;
  }
}

export function saveShiftDailyReportSession(tenantId: string, userId: string, s: ShiftDailyReportSession): void {
  try {
    sessionStorage.setItem(storageKey(tenantId, userId), JSON.stringify(s));
  } catch {
    /* ignore quota */
  }
}

export function clearShiftDailyReportSession(tenantId: string, userId: string): void {
  try {
    sessionStorage.removeItem(storageKey(tenantId, userId));
  } catch {
    /* ignore */
  }
}

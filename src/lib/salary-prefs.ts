/** テナント設定 customJson.salaryPrefs（勤怠・給料タブの端数） */

export const SALARY_MINUTE_STEPS = [1, 5, 10, 15, 30, 60] as const;
export type SalaryMinuteStep = (typeof SALARY_MINUTE_STEPS)[number];

export type SalaryTimeRounding = "floor" | "ceil" | "round";
export type SalaryYenRounding = "floor" | "ceil" | "round";

export type SalaryPrefsV1 = {
  version: 1;
  /** 給料計算に使う労働時間の分刻み（1=打刻どおりの時間をそのまま使用） */
  minuteStep: SalaryMinuteStep;
  /** minuteStep > 1 のとき、刻みへの丸め方 */
  timeRounding: SalaryTimeRounding;
  /** 時給×時間の金額の小数を円にそろえる方法（round=四捨五入） */
  yenRounding: SalaryYenRounding;
};

export function defaultSalaryPrefs(): SalaryPrefsV1 {
  return { version: 1, minuteStep: 1, timeRounding: "floor", yenRounding: "round" };
}

function roundHalfAwayFromZero(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n >= 0) return Math.floor(n + 0.5);
  return Math.ceil(n - 0.5);
}

/** 労働分数（小数可）を minuteStep 単位に丸めた分数 */
export function snapWorkMinutesExact(workMinutesExact: number, step: number, mode: SalaryTimeRounding): number {
  if (!Number.isFinite(workMinutesExact) || workMinutesExact <= 0) return 0;
  if (!step || step <= 1) return workMinutesExact;
  const units = workMinutesExact / step;
  let snappedUnits: number;
  if (mode === "floor") snappedUnits = Math.floor(units);
  else if (mode === "ceil") snappedUnits = Math.ceil(units);
  else snappedUnits = roundHalfAwayFromZero(units);
  return Math.max(0, snappedUnits * step);
}

export function roundYenFromRaw(rawYen: number, mode: SalaryYenRounding): number {
  if (!Number.isFinite(rawYen)) return 0;
  if (mode === "floor") return Math.floor(rawYen);
  if (mode === "ceil") return Math.ceil(rawYen);
  return roundHalfAwayFromZero(rawYen);
}

function coerceMinuteStep(raw: unknown): SalaryMinuteStep {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 1;
  const i = Math.floor(n);
  return (SALARY_MINUTE_STEPS as readonly number[]).includes(i) ? (i as SalaryMinuteStep) : 1;
}

function coerceTimeRounding(raw: unknown): SalaryTimeRounding {
  return raw === "ceil" || raw === "round" ? raw : "floor";
}

function coerceYenRounding(raw: unknown): SalaryYenRounding {
  return raw === "floor" || raw === "ceil" ? raw : "round";
}

export function coerceSalaryPrefs(raw: unknown): SalaryPrefsV1 {
  const p = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    version: 1,
    minuteStep: coerceMinuteStep(p.minuteStep),
    timeRounding: coerceTimeRounding(p.timeRounding),
    yenRounding: coerceYenRounding(p.yenRounding),
  };
}

export function mergeSalaryPrefsPut(prev: SalaryPrefsV1, body: Record<string, unknown>): SalaryPrefsV1 {
  if (body.salaryPrefs !== undefined && typeof body.salaryPrefs === "object" && body.salaryPrefs !== null) {
    return coerceSalaryPrefs(body.salaryPrefs);
  }
  const next: SalaryPrefsV1 = { ...prev };
  if (body.minuteStep !== undefined) next.minuteStep = coerceMinuteStep(body.minuteStep);
  if (body.timeRounding !== undefined) next.timeRounding = coerceTimeRounding(body.timeRounding);
  if (body.yenRounding !== undefined) next.yenRounding = coerceYenRounding(body.yenRounding);
  return next;
}

/** 給料計算に使う「基準となる労働分数」（刻み適用後、または 1 分未満を含む実分数） */
export function wageBasisMinutesFromWorkMs(workMs: number, prefs: SalaryPrefsV1): number {
  if (!Number.isFinite(workMs) || workMs <= 0) return 0;
  const exactMin = workMs / 60000;
  if (!prefs.minuteStep || prefs.minuteStep <= 1) return exactMin;
  return snapWorkMinutesExact(exactMin, prefs.minuteStep, prefs.timeRounding);
}

export function computeWageFromWorkMs(workMs: number, hourlyYen: number, prefs: SalaryPrefsV1): number | null {
  if (!hourlyYen || hourlyYen < 0) return null;
  if (!Number.isFinite(workMs) || workMs <= 0) return null;
  const basisMin = wageBasisMinutesFromWorkMs(workMs, prefs);
  const rawYen = (basisMin / 60) * hourlyYen;
  return roundYenFromRaw(rawYen, prefs.yenRounding);
}

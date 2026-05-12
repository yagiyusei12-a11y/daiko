import { randomUUID } from "node:crypto";

type JsonObj = Record<string, unknown>;

function asObj(v: unknown): JsonObj {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as JsonObj) : {};
}

/** 0:00〜48:59（例: 翌2時 = 26:00） */
const FLEX_HM = /^(\d{1,2}):(\d{2})$/;

export function isValidFlexHm(s: string): boolean {
  const m = FLEX_HM.exec(s.trim());
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h >= 0 && h <= 48 && min >= 0 && min <= 59;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export type BusinessHoursSlot = { id: string; open: string; close: string };

export type RegularHolidayWeekly = { id: string; kind: "weekly"; weekdays: number[] };
export type RegularHolidayNthWeekday = { id: string; kind: "nthWeekday"; nth: number; weekday: number };
export type RegularHolidayMonthlyDay = { id: string; kind: "monthlyDay"; day: number };
export type RegularHolidayEntry = RegularHolidayWeekly | RegularHolidayNthWeekday | RegularHolidayMonthlyDay;

export type BusinessBasicsV1 = {
  version: 1;
  businessHours: BusinessHoursSlot[];
  regularHolidays: RegularHolidayEntry[];
  temporaryClosureDates: string[];
};

const DEFAULTS: BusinessBasicsV1 = {
  version: 1,
  businessHours: [],
  regularHolidays: [],
  temporaryClosureDates: [],
};

function newId(): string {
  return randomUUID();
}

function coerceSlot(raw: unknown): BusinessHoursSlot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const open = typeof o.open === "string" ? o.open.trim() : "";
  const close = typeof o.close === "string" ? o.close.trim() : "";
  if (!isValidFlexHm(open) || !isValidFlexHm(close)) return null;
  const id = typeof o.id === "string" && o.id.trim() ? o.id.trim() : newId();
  return { id, open, close };
}

function coerceWeekdays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const x of raw) {
    const n = typeof x === "number" ? x : Number(x);
    if (Number.isInteger(n) && n >= 0 && n <= 6) out.push(n);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function coerceRegular(raw: unknown): RegularHolidayEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" && o.id.trim() ? o.id.trim() : newId();
  const kind = o.kind;
  if (kind === "weekly") {
    const weekdays = coerceWeekdays(o.weekdays);
    if (weekdays.length === 0) return null;
    return { id, kind: "weekly", weekdays };
  }
  if (kind === "nthWeekday") {
    const nth = typeof o.nth === "number" ? o.nth : Number(o.nth);
    const weekday = typeof o.weekday === "number" ? o.weekday : Number(o.weekday);
    if (![1, 2, 3, 4, -1].includes(nth)) return null;
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
    return { id, kind: "nthWeekday", nth, weekday };
  }
  if (kind === "monthlyDay") {
    const day = typeof o.day === "number" ? o.day : Number(o.day);
    if (!Number.isInteger(day) || day < 1 || day > 31) return null;
    return { id, kind: "monthlyDay", day };
  }
  return null;
}

function coerceDates(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x === "string" && YMD_RE.test(x)) out.push(x);
  }
  return [...new Set(out)].sort((a, b) => a.localeCompare(b));
}

/** customJson の一部から正規化（不正要素は落とす） */
export function coerceBusinessBasicsFromCustomJson(customJson: unknown): BusinessBasicsV1 {
  const root = asObj(customJson);
  const raw = root.businessBasics;
  if (!raw || typeof raw !== "object") return { ...DEFAULTS };

  const o = raw as Record<string, unknown>;
  const slots: BusinessHoursSlot[] = [];
  if (Array.isArray(o.businessHours)) {
    for (const x of o.businessHours) {
      const s = coerceSlot(x);
      if (s) slots.push(s);
    }
  }

  const regular: RegularHolidayEntry[] = [];
  if (Array.isArray(o.regularHolidays)) {
    for (const x of o.regularHolidays) {
      const r = coerceRegular(x);
      if (r) regular.push(r);
    }
  }

  return {
    version: 1,
    businessHours: slots,
    regularHolidays: regular,
    temporaryClosureDates: coerceDates(o.temporaryClosureDates),
  };
}

export function parseBusinessBasicsPut(body: Record<string, unknown>): { ok: true; value: BusinessBasicsV1 } | { ok: false; error: string } {
  const slots: BusinessHoursSlot[] = [];
  if (!Array.isArray(body.businessHours)) {
    return { ok: false, error: "businessHours は配列で指定してください" };
  }
  for (const x of body.businessHours) {
    const s = coerceSlot(x);
    if (!s) return { ok: false, error: "営業時間の各行は id（任意）・open・close（0:00〜48:59）で指定してください" };
    slots.push(s);
  }

  const regular: RegularHolidayEntry[] = [];
  if (!Array.isArray(body.regularHolidays)) {
    return { ok: false, error: "regularHolidays は配列で指定してください" };
  }
  for (const x of body.regularHolidays) {
    const r = coerceRegular(x);
    if (!r) return { ok: false, error: "定休日パターンの形式が不正です" };
    regular.push(r);
  }

  if (!Array.isArray(body.temporaryClosureDates)) {
    return { ok: false, error: "temporaryClosureDates は配列で指定してください" };
  }
  for (const x of body.temporaryClosureDates) {
    if (typeof x !== "string" || !YMD_RE.test(x)) {
      return { ok: false, error: "臨時休業日は yyyy-MM-dd 形式の文字列のみにしてください" };
    }
  }
  const dates = coerceDates(body.temporaryClosureDates);

  return {
    ok: true,
    value: {
      version: 1,
      businessHours: slots,
      regularHolidays: regular,
      temporaryClosureDates: dates,
    },
  };
}

export function mergeBusinessBasicsIntoCustomJson(
  prevCustomJson: unknown,
  basics: BusinessBasicsV1,
): JsonObj {
  const prev = asObj(prevCustomJson);
  return { ...prev, businessBasics: basics as unknown as JsonObj };
}

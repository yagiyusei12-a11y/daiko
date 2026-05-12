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

/** 保存形式 v2（v1 は読み込み時に昇格） */
export type BusinessBasicsV2 = {
  version: 2;
  businessHours: BusinessHoursSlot[];
  /** 曜日 0–6 の文字列キー → 営業時間（空でないときのみデフォルトより優先） */
  businessHoursByWeekday: Record<string, BusinessHoursSlot[]>;
  /** yyyy-MM-dd → 営業時間（曜日より優先） */
  businessHoursByDate: Record<string, BusinessHoursSlot[]>;
  paymentMethods: string[];
  regularHolidays: RegularHolidayEntry[];
  temporaryClosureDates: string[];
};

const DEFAULTS_V2: BusinessBasicsV2 = {
  version: 2,
  businessHours: [],
  businessHoursByWeekday: {},
  businessHoursByDate: {},
  paymentMethods: [],
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

function coerceSlotArray(raw: unknown): BusinessHoursSlot[] {
  if (!Array.isArray(raw)) return [];
  const out: BusinessHoursSlot[] = [];
  for (const x of raw) {
    const s = coerceSlot(x);
    if (s) out.push(s);
  }
  return out;
}

function coercePaymentMethods(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== "string") continue;
    const t = x.trim();
    if (t.length === 0 || t.length > 80) continue;
    out.push(t);
  }
  return [...new Set(out)];
}

function coerceHoursMap(raw: unknown, keyKind: "weekday" | "date"): Record<string, BusinessHoursSlot[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, BusinessHoursSlot[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (keyKind === "weekday") {
      if (!/^[0-6]$/.test(k)) continue;
    } else if (!YMD_RE.test(k)) continue;
    const slots = coerceSlotArray(v);
    if (slots.length > 0) out[k] = slots;
  }
  return out;
}

/** customJson の一部から正規化（v1 は v2 に昇格） */
export function coerceBusinessBasicsFromCustomJson(customJson: unknown): BusinessBasicsV2 {
  const root = asObj(customJson);
  const raw = root.businessBasics;
  if (!raw || typeof raw !== "object") return { ...DEFAULTS_V2 };

  const o = raw as Record<string, unknown>;
  const ver = o.version === 2 ? 2 : 1;

  const slots = coerceSlotArray(o.businessHours);
  const regular: RegularHolidayEntry[] = [];
  if (Array.isArray(o.regularHolidays)) {
    for (const x of o.regularHolidays) {
      const r = coerceRegular(x);
      if (r) regular.push(r);
    }
  }
  const temporaryClosureDates = coerceDates(o.temporaryClosureDates);

  if (ver === 1) {
    return {
      version: 2,
      businessHours: slots,
      businessHoursByWeekday: {},
      businessHoursByDate: {},
      paymentMethods: [],
      regularHolidays: regular,
      temporaryClosureDates,
    };
  }

  return {
    version: 2,
    businessHours: slots,
    businessHoursByWeekday: coerceHoursMap(o.businessHoursByWeekday, "weekday"),
    businessHoursByDate: coerceHoursMap(o.businessHoursByDate, "date"),
    paymentMethods: coercePaymentMethods(o.paymentMethods),
    regularHolidays: regular,
    temporaryClosureDates,
  };
}

/** 指定日の営業時間（特定日 → 曜日 → デフォルト） */
export function resolveBusinessHoursForYmd(ymd: string, basics: BusinessBasicsV2): BusinessHoursSlot[] {
  if (!YMD_RE.test(ymd)) return basics.businessHours;
  const byDate = basics.businessHoursByDate[ymd];
  if (byDate && byDate.length > 0) return byDate;
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return basics.businessHours;
  const wd = String(d.getDay());
  const byWd = basics.businessHoursByWeekday[wd];
  if (byWd && byWd.length > 0) return byWd;
  return basics.businessHours;
}

export function parseBusinessBasicsPut(body: Record<string, unknown>): { ok: true; value: BusinessBasicsV2 } | { ok: false; error: string } {
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

  let businessHoursByWeekday: Record<string, BusinessHoursSlot[]> = {};
  if (body.businessHoursByWeekday === undefined) {
    businessHoursByWeekday = {};
  } else if (!body.businessHoursByWeekday || typeof body.businessHoursByWeekday !== "object" || Array.isArray(body.businessHoursByWeekday)) {
    return { ok: false, error: "businessHoursByWeekday はオブジェクトで指定してください" };
  } else {
    businessHoursByWeekday = {};
    for (const [k, v] of Object.entries(body.businessHoursByWeekday as Record<string, unknown>)) {
      if (!/^[0-6]$/.test(k)) return { ok: false, error: "businessHoursByWeekday のキーは 0〜6 の文字列にしてください" };
      if (!Array.isArray(v)) return { ok: false, error: `businessHoursByWeekday[${k}] は配列で指定してください` };
      const row: BusinessHoursSlot[] = [];
      for (const x of v) {
        const s = coerceSlot(x);
        if (!s) return { ok: false, error: `営業時間（曜日 ${k}）の形式が不正です` };
        row.push(s);
      }
      if (row.length > 0) businessHoursByWeekday[k] = row;
    }
  }

  let businessHoursByDate: Record<string, BusinessHoursSlot[]> = {};
  if (body.businessHoursByDate === undefined) {
    businessHoursByDate = {};
  } else if (!body.businessHoursByDate || typeof body.businessHoursByDate !== "object" || Array.isArray(body.businessHoursByDate)) {
    return { ok: false, error: "businessHoursByDate はオブジェクトで指定してください" };
  } else {
    businessHoursByDate = {};
    for (const [k, v] of Object.entries(body.businessHoursByDate as Record<string, unknown>)) {
      if (!YMD_RE.test(k)) return { ok: false, error: "businessHoursByDate のキーは yyyy-MM-dd 形式にしてください" };
      if (!Array.isArray(v)) return { ok: false, error: `businessHoursByDate[${k}] は配列で指定してください` };
      const row: BusinessHoursSlot[] = [];
      for (const x of v) {
        const s = coerceSlot(x);
        if (!s) return { ok: false, error: `営業時間（日付 ${k}）の形式が不正です` };
        row.push(s);
      }
      if (row.length > 0) businessHoursByDate[k] = row;
    }
  }

  let paymentMethods: string[] = [];
  if (body.paymentMethods === undefined) {
    paymentMethods = [];
  } else if (!Array.isArray(body.paymentMethods)) {
    return { ok: false, error: "paymentMethods は文字列の配列で指定してください" };
  } else {
    paymentMethods = coercePaymentMethods(body.paymentMethods);
  }

  return {
    ok: true,
    value: {
      version: 2,
      businessHours: slots,
      businessHoursByWeekday,
      businessHoursByDate,
      paymentMethods,
      regularHolidays: regular,
      temporaryClosureDates: dates,
    },
  };
}

export function mergeBusinessBasicsIntoCustomJson(prevCustomJson: unknown, basics: BusinessBasicsV2): JsonObj {
  const prev = asObj(prevCustomJson);
  return { ...prev, businessBasics: basics as unknown as JsonObj };
}

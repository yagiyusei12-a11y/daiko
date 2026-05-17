/** 0:00〜48:59（28時間表記など） */
export const FLEX_HM_RE = /^(\d{1,2}):(\d{2})$/;

/** 全角数字・コロンなどを半角に */
export function toHalfWidthTimeChars(s: string): string {
  return s
    .replace(/[\uFF10-\uFF19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30))
    .replace(/[：．。]/g, (m) => (m === "：" ? ":" : "."))
    .replace(/\u3000/g, "");
}

/** 入力中: 半角数字とコロンのみ残す */
export function sanitizeFlexTimeTyping(raw: string): string {
  return toHalfWidthTimeChars(raw).replace(/[^\d:]/g, "");
}

/**
 * フォーカス離脱時: 1800→18:00、18→18:00、9:5→9:05 などに整形
 */
export function formatFlexTimeOnBlur(raw: string): string {
  const s = sanitizeFlexTimeTyping(raw.trim());
  if (!s) return "";

  const colon = /^(\d{1,2}):(\d{1,2})$/.exec(s);
  if (colon) {
    const h = Number(colon[1]);
    const min = Number(colon[2]);
    if (!Number.isFinite(h) || !Number.isFinite(min)) return s;
    return `${h}:${String(min).padStart(2, "0")}`;
  }

  const digits = s.replace(/:/g, "");
  if (!/^\d+$/.test(digits)) return s;

  let h: number;
  let min: number;
  if (digits.length <= 2) {
    h = Number(digits);
    min = 0;
  } else if (digits.length === 3) {
    h = Number(digits[0]);
    min = Number(digits.slice(1));
  } else if (digits.length === 4) {
    h = Number(digits.slice(0, 2));
    min = Number(digits.slice(2));
  } else {
    return s;
  }
  return `${h}:${String(min).padStart(2, "0")}`;
}

export function isValidFlexHm(s: string): boolean {
  const m = FLEX_HM_RE.exec(s.trim());
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h >= 0 && h <= 48 && min >= 0 && min <= 59;
}

export function flexHmToMinutes(s: string): number {
  const m = FLEX_HM_RE.exec(s.trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function normalizeShiftDaySlot(slot: { start: string; end: string }): { start: string; end: string } {
  return {
    start: formatFlexTimeOnBlur(slot.start),
    end: formatFlexTimeOnBlur(slot.end),
  };
}

export function normalizeOpenCloseSlot(slot: { open: string; close: string }): { open: string; close: string } {
  return {
    open: formatFlexTimeOnBlur(slot.open),
    close: formatFlexTimeOnBlur(slot.close),
  };
}

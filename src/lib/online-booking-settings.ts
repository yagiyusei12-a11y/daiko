import { flexHmToMinutesSinceMidnight } from "./dispatch-reservation.js";

type JsonObj = Record<string, unknown>;

function asObj(v: unknown): JsonObj {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as JsonObj) : {};
}

const DEFAULT_DURATION_OPTIONS = [30, 45, 60, 75, 90, 120, 150, 180, 240];
const MAX_MESSAGE_LENGTH = 400;

export type OnlineBookingSettings = {
  /** ネット予約を受け付けるか */
  enabled: boolean;
  /** 予約ページに表示するメッセージ（空でも可） */
  message: string;
  /** ゲストが選べる所要時間オプション（分）*/
  durationOptions: number[];
  /** 何日先まで予約可能か（0 = 制限なし） */
  daysAhead: number;
  /**
   * ネット予約で出す空き枠の終了（営業時間より早く切る場合）。
   * 28時間表記の "HH:mm"（例 26:00）。空なら営業時間の終端まで。
   */
  onlineLatestCloseHm: string | null;
};

const DEFAULTS: OnlineBookingSettings = {
  enabled: false,
  message: "",
  durationOptions: DEFAULT_DURATION_OPTIONS,
  daysAhead: 30,
  onlineLatestCloseHm: null,
};

export function coerceOnlineBookingFromCustomJson(customJson: unknown): OnlineBookingSettings {
  const root = asObj(customJson);
  const raw = root.onlineBooking;
  if (!raw || typeof raw !== "object") return { ...DEFAULTS };
  const o = raw as JsonObj;

  const enabled = o.enabled === true;
  const message = typeof o.message === "string" ? o.message.slice(0, MAX_MESSAGE_LENGTH) : "";

  let durationOptions: number[] = DEFAULT_DURATION_OPTIONS;
  if (Array.isArray(o.durationOptions)) {
    const parsed = (o.durationOptions as unknown[])
      .map((x) => (typeof x === "number" ? x : Number(x)))
      .filter((n) => Number.isInteger(n) && n >= 15 && n <= 480 && n % 15 === 0);
    if (parsed.length > 0) durationOptions = [...new Set(parsed)].sort((a, b) => a - b);
  }

  let daysAhead = typeof o.daysAhead === "number" ? Math.floor(o.daysAhead) : DEFAULTS.daysAhead;
  if (!Number.isFinite(daysAhead) || daysAhead < 0 || daysAhead > 365) daysAhead = DEFAULTS.daysAhead;

  let onlineLatestCloseHm: string | null = DEFAULTS.onlineLatestCloseHm;
  if (typeof o.onlineLatestCloseHm === "string") {
    const t = o.onlineLatestCloseHm.trim();
    if (t.length > 0) {
      const mm = flexHmToMinutesSinceMidnight(t);
      onlineLatestCloseHm = mm !== null && mm > 0 ? t : null;
    }
  }

  return { enabled, message, durationOptions, daysAhead, onlineLatestCloseHm };
}

export function mergeOnlineBookingIntoCustomJson(prevCustomJson: unknown, settings: OnlineBookingSettings): JsonObj {
  const prev = asObj(prevCustomJson);
  return { ...prev, onlineBooking: settings as unknown as JsonObj };
}

export function parseOnlineBookingPut(
  body: Record<string, unknown>,
  prev?: OnlineBookingSettings | null,
): { ok: true; value: OnlineBookingSettings } | { ok: false; error: string } {
  const enabled = body.enabled === true || body.enabled === "true";
  const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE_LENGTH) : "";

  let durationOptions: number[] = DEFAULT_DURATION_OPTIONS;
  if (body.durationOptions !== undefined) {
    if (!Array.isArray(body.durationOptions)) {
      return { ok: false, error: "durationOptions は配列で指定してください" };
    }
    const parsed = (body.durationOptions as unknown[])
      .map((x) => (typeof x === "number" ? x : Number(x)))
      .filter((n) => Number.isInteger(n) && n >= 15 && n <= 480 && n % 15 === 0);
    if (parsed.length === 0) return { ok: false, error: "有効な所要時間オプションが1つ以上必要です（15〜480分・15分刻み）" };
    durationOptions = [...new Set(parsed)].sort((a, b) => a - b);
  }

  let daysAhead = body.daysAhead !== undefined ? Number(body.daysAhead) : DEFAULTS.daysAhead;
  if (!Number.isInteger(daysAhead) || daysAhead < 0 || daysAhead > 365) {
    return { ok: false, error: "daysAhead は 0〜365 の整数で指定してください（0 = 制限なし）" };
  }

  let onlineLatestCloseHm: string | null = prev?.onlineLatestCloseHm ?? DEFAULTS.onlineLatestCloseHm;
  if (body.onlineLatestCloseHm !== undefined) {
    if (body.onlineLatestCloseHm === null) {
      onlineLatestCloseHm = null;
    } else if (typeof body.onlineLatestCloseHm !== "string") {
      return { ok: false, error: "onlineLatestCloseHm は文字列か null で指定してください" };
    } else {
      const t = body.onlineLatestCloseHm.trim();
      if (t.length === 0) onlineLatestCloseHm = null;
      else {
        const mm = flexHmToMinutesSinceMidnight(t);
        if (mm === null || mm <= 0) {
          return { ok: false, error: "ネット予約の終了時刻は 0:01〜48:59 の HH:mm（例 26:00）で指定してください" };
        }
        onlineLatestCloseHm = t;
      }
    }
  }

  return { ok: true, value: { enabled, message, durationOptions, daysAhead, onlineLatestCloseHm } };
}

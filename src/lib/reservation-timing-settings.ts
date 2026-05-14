/**
 * 送り先までの目安（分）から、スケジュール上のブロック時間（分）を算出し、
 * 空き枠モード（確定シフト / 仮想同時枠）を `customJson.reservationTiming` に保存する。
 */

type JsonObj = Record<string, unknown>;

function asObj(v: unknown): JsonObj {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as JsonObj) : {};
}

export type AvailabilityMode = "confirmed_shifts" | "virtual_concurrent";

export type BlockedTimeMode = "multiply" | "add";

export type ReservationTimingSettings = {
  /** フォーム初期値（送り先までの目安・分） */
  defaultTripEstimateMinutes: number;
  blockedTimeMode: BlockedTimeMode;
  /** multiply 時の係数（例: 2） */
  blockedTimeMultiply: number;
  /** add 時に目安へ足す分 */
  blockedTimeAddMinutes: number;
  availabilityMode: AvailabilityMode;
  /** virtual_concurrent 時の同時予約上限（日別未指定時のデフォルト） */
  virtualConcurrentSlots: number;
  /**
   * 日別の同時予約上限（yyyy-MM-dd → 1〜50）。キーが無い日は virtualConcurrentSlots。
   * 将来カレンダーUIで編集しやすくする余地あり。
   */
  virtualSlotsByDate: Record<string, number>;
};

const DEFAULTS: ReservationTimingSettings = {
  defaultTripEstimateMinutes: 60,
  blockedTimeMode: "multiply",
  blockedTimeMultiply: 2,
  blockedTimeAddMinutes: 10,
  availabilityMode: "confirmed_shifts",
  virtualConcurrentSlots: 2,
  virtualSlotsByDate: {},
};

function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

const YMD_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_VIRTUAL_SLOTS_BY_DATE_ENTRIES = 400;

/** 指定日の仮想同時枠の上限（1〜50） */
export function resolveVirtualConcurrentSlotsForDate(ymd: string, cfg: ReservationTimingSettings): number {
  const raw = cfg.virtualSlotsByDate[ymd];
  if (raw !== undefined && Number.isInteger(raw) && raw >= 1 && raw <= 50) {
    return raw;
  }
  return Math.max(1, Math.min(50, Math.floor(cfg.virtualConcurrentSlots)));
}

function coerceVirtualSlotsByDate(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!YMD_KEY_RE.test(k)) continue;
    const n = typeof v === "number" ? Math.floor(v) : Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 50) continue;
    out[k] = n;
    if (Object.keys(out).length >= MAX_VIRTUAL_SLOTS_BY_DATE_ENTRIES) break;
  }
  return out;
}

/** 15〜480 に収め、15 分単位へ切り上げ（ブロック時間は控えめに取りすぎないよう上限クランプ） */
export function roundBlockedMinutesUp(raw: number): number {
  if (!Number.isFinite(raw)) return 60;
  const up = Math.ceil(raw / 15) * 15;
  return clampInt(up, 15, 480);
}

/**
 * 送り先までの目安（分）から、DB の startsAt/endsAt に使うブロック分数を求める。
 * `estimateMinutes` は 15〜480・15 分刻みを前提（呼び出し側で検証）。
 */
export function computeBlockedMinutes(estimateMinutes: number, cfg: ReservationTimingSettings): number {
  if (cfg.blockedTimeMode === "add") {
    const add = clampInt(cfg.blockedTimeAddMinutes, 0, 480);
    return roundBlockedMinutesUp(estimateMinutes + add);
  }
  const factor = Number.isFinite(cfg.blockedTimeMultiply) && cfg.blockedTimeMultiply > 0 ? cfg.blockedTimeMultiply : 2;
  return roundBlockedMinutesUp(estimateMinutes * factor);
}

export function coerceReservationTimingFromCustomJson(customJson: unknown): ReservationTimingSettings {
  const root = asObj(customJson);
  const raw = root.reservationTiming;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULTS };
  const o = raw as JsonObj;

  let defaultTripEstimateMinutes =
    typeof o.defaultTripEstimateMinutes === "number" ? Math.floor(o.defaultTripEstimateMinutes) : DEFAULTS.defaultTripEstimateMinutes;
  if (!Number.isFinite(defaultTripEstimateMinutes) || defaultTripEstimateMinutes < 15 || defaultTripEstimateMinutes > 480) {
    defaultTripEstimateMinutes = DEFAULTS.defaultTripEstimateMinutes;
  }
  if (defaultTripEstimateMinutes % 15 !== 0) defaultTripEstimateMinutes = Math.round(defaultTripEstimateMinutes / 15) * 15;

  const modeRaw = String(o.blockedTimeMode ?? "").trim();
  const blockedTimeMode: BlockedTimeMode = modeRaw === "add" ? "add" : "multiply";

  let blockedTimeMultiply =
    typeof o.blockedTimeMultiply === "number" ? o.blockedTimeMultiply : Number(o.blockedTimeMultiply);
  if (!Number.isFinite(blockedTimeMultiply) || blockedTimeMultiply <= 0 || blockedTimeMultiply > 10) {
    blockedTimeMultiply = DEFAULTS.blockedTimeMultiply;
  }

  let blockedTimeAddMinutes =
    typeof o.blockedTimeAddMinutes === "number" ? Math.floor(o.blockedTimeAddMinutes) : Number(o.blockedTimeAddMinutes);
  if (!Number.isFinite(blockedTimeAddMinutes) || blockedTimeAddMinutes < 0 || blockedTimeAddMinutes > 480) {
    blockedTimeAddMinutes = DEFAULTS.blockedTimeAddMinutes;
  }

  const amRaw = String(o.availabilityMode ?? "").trim();
  const availabilityMode: AvailabilityMode = amRaw === "virtual_concurrent" ? "virtual_concurrent" : "confirmed_shifts";

  let virtualConcurrentSlots =
    typeof o.virtualConcurrentSlots === "number" ? Math.floor(o.virtualConcurrentSlots) : Number(o.virtualConcurrentSlots);
  if (!Number.isInteger(virtualConcurrentSlots) || virtualConcurrentSlots < 1 || virtualConcurrentSlots > 50) {
    virtualConcurrentSlots = DEFAULTS.virtualConcurrentSlots;
  }

  const virtualSlotsByDate = coerceVirtualSlotsByDate(o.virtualSlotsByDate);

  return {
    defaultTripEstimateMinutes,
    blockedTimeMode,
    blockedTimeMultiply,
    blockedTimeAddMinutes,
    availabilityMode,
    virtualConcurrentSlots,
    virtualSlotsByDate,
  };
}

export function mergeReservationTimingIntoCustomJson(prevCustomJson: unknown, timing: ReservationTimingSettings): JsonObj {
  const prev = asObj(prevCustomJson);
  return { ...prev, reservationTiming: timing as unknown as JsonObj };
}

export function parseReservationTimingPut(
  body: Record<string, unknown>,
): { ok: true; value: ReservationTimingSettings } | { ok: false; error: string } {
  const o = body;
  const defaultTripEstimateMinutes =
    o.defaultTripEstimateMinutes !== undefined ? Number(o.defaultTripEstimateMinutes) : DEFAULTS.defaultTripEstimateMinutes;
  if (
    !Number.isInteger(defaultTripEstimateMinutes) ||
    defaultTripEstimateMinutes < 15 ||
    defaultTripEstimateMinutes > 480 ||
    defaultTripEstimateMinutes % 15 !== 0
  ) {
    return { ok: false, error: "defaultTripEstimateMinutes は 15〜480 の 15 分刻みで指定してください" };
  }

  const modeStr = String(o.blockedTimeMode ?? "multiply").trim();
  const blockedTimeMode: BlockedTimeMode = modeStr === "add" ? "add" : "multiply";

  const blockedTimeMultiply =
    o.blockedTimeMultiply !== undefined ? Number(o.blockedTimeMultiply) : DEFAULTS.blockedTimeMultiply;
  if (!Number.isFinite(blockedTimeMultiply) || blockedTimeMultiply <= 0 || blockedTimeMultiply > 10) {
    return { ok: false, error: "blockedTimeMultiply は 0 より大きく 10 以下の数にしてください" };
  }

  const blockedTimeAddMinutes =
    o.blockedTimeAddMinutes !== undefined ? Number(o.blockedTimeAddMinutes) : DEFAULTS.blockedTimeAddMinutes;
  if (!Number.isInteger(blockedTimeAddMinutes) || blockedTimeAddMinutes < 0 || blockedTimeAddMinutes > 480) {
    return { ok: false, error: "blockedTimeAddMinutes は 0〜480 の整数にしてください" };
  }

  const amStr = String(o.availabilityMode ?? "confirmed_shifts").trim();
  const availabilityMode: AvailabilityMode = amStr === "virtual_concurrent" ? "virtual_concurrent" : "confirmed_shifts";

  const virtualConcurrentSlots =
    o.virtualConcurrentSlots !== undefined ? Number(o.virtualConcurrentSlots) : DEFAULTS.virtualConcurrentSlots;
  if (!Number.isInteger(virtualConcurrentSlots) || virtualConcurrentSlots < 1 || virtualConcurrentSlots > 50) {
    return { ok: false, error: "virtualConcurrentSlots は 1〜50 の整数にしてください" };
  }

  let virtualSlotsByDate: Record<string, number> = {};
  if (o.virtualSlotsByDate !== undefined && o.virtualSlotsByDate !== null) {
    if (typeof o.virtualSlotsByDate !== "object" || Array.isArray(o.virtualSlotsByDate)) {
      return { ok: false, error: "virtualSlotsByDate はオブジェクトで指定してください" };
    }
    let count = 0;
    for (const [k, v] of Object.entries(o.virtualSlotsByDate as Record<string, unknown>)) {
      if (!YMD_KEY_RE.test(k)) {
        return { ok: false, error: `virtualSlotsByDate のキーは yyyy-MM-dd 形式にしてください: ${k}` };
      }
      const n = typeof v === "number" ? Math.floor(v) : Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 50) {
        return { ok: false, error: `virtualSlotsByDate.${k} は 1〜50 の整数にしてください` };
      }
      virtualSlotsByDate[k] = n;
      count++;
      if (count > MAX_VIRTUAL_SLOTS_BY_DATE_ENTRIES) {
        return { ok: false, error: `virtualSlotsByDate は最大 ${MAX_VIRTUAL_SLOTS_BY_DATE_ENTRIES} 件までです` };
      }
    }
  }

  return {
    ok: true,
    value: {
      defaultTripEstimateMinutes,
      blockedTimeMode,
      blockedTimeMultiply,
      blockedTimeAddMinutes,
      availabilityMode,
      virtualConcurrentSlots,
      virtualSlotsByDate,
    },
  };
}

/** クエリ `tripEstimateMinutes` を優先。無い場合は `durationMinutes` を目安として解釈（後方互換）。 */
export function parseTripEstimateMinutesFromQuery(
  tripEstimateRaw: string | undefined | null,
  legacyDurationRaw: string | undefined | null,
): { ok: true; estimateMinutes: number } | { ok: false; error: string } {
  const t =
    tripEstimateRaw !== undefined && tripEstimateRaw !== null && String(tripEstimateRaw).trim() !== ""
      ? Number(String(tripEstimateRaw).trim())
      : NaN;
  if (Number.isFinite(t) && t >= 15 && t <= 480 && t % 15 === 0) {
    return { ok: true, estimateMinutes: t };
  }
  const leg =
    legacyDurationRaw !== undefined && legacyDurationRaw !== null && String(legacyDurationRaw).trim() !== ""
      ? Number(String(legacyDurationRaw).trim())
      : NaN;
  if (Number.isFinite(leg) && leg >= 15 && leg <= 480 && leg % 15 === 0) {
    return { ok: true, estimateMinutes: leg };
  }
  return { ok: false, error: "tripEstimateMinutes（または durationMinutes）は 15〜480 分で 15 分刻みで指定してください" };
}

/** JSON body: `tripEstimateMinutes` を優先。無い場合は `durationMinutes` を目安として解釈。 */
export function parseTripEstimateMinutesFromBody(body: Record<string, unknown>): { ok: true; estimateMinutes: number } | { ok: false; error: string } {
  const trip = body.tripEstimateMinutes;
  const dur = body.durationMinutes;
  const t = typeof trip === "number" ? trip : typeof trip === "string" && String(trip).trim() !== "" ? Number(String(trip).trim()) : NaN;
  if (Number.isFinite(t) && t >= 15 && t <= 480 && t % 15 === 0) {
    return { ok: true, estimateMinutes: t };
  }
  const d = typeof dur === "number" ? dur : typeof dur === "string" && String(dur).trim() !== "" ? Number(String(dur).trim()) : NaN;
  if (Number.isFinite(d) && d >= 15 && d <= 480 && d % 15 === 0) {
    return { ok: true, estimateMinutes: d };
  }
  return { ok: false, error: "tripEstimateMinutes（または durationMinutes）は 15〜480 分で 15 分刻みで指定してください" };
}

function parseBlockField(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || n < 15 || n > 480 || n % 15 !== 0) return null;
  return n;
}

/**
 * スタッフ API 後方互換: `tripEstimateMinutes` があれば目安からブロックを算出。
 * 無く `durationMinutes` のみの場合は、その値をブロック分数としてそのまま使う（従来の「実車時間」指定）。
 */
export function resolveBlockedMinutesForDispatchBody(
  body: Record<string, unknown>,
  timing: ReservationTimingSettings,
): { ok: true; blockedMinutes: number; usedLiteralDuration: boolean } | { ok: false; error: string } {
  const trip = parseBlockField(body.tripEstimateMinutes);
  if (trip !== null) {
    return { ok: true, blockedMinutes: computeBlockedMinutes(trip, timing), usedLiteralDuration: false };
  }
  const lit = parseBlockField(body.durationMinutes);
  if (lit !== null) {
    return { ok: true, blockedMinutes: lit, usedLiteralDuration: true };
  }
  return { ok: false, error: "tripEstimateMinutes または durationMinutes を指定してください" };
}
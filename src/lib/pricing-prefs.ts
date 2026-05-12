/** テナント設定 customJson.pricingPrefs の正規化（v1） */

export const PRICING_STRIP = new Set(["distance", "time"]);

export type DistanceBand = {
  baseFareYen: number;
  includedDistanceM: number;
  addEveryM: number;
  addFareYen: number;
};

export type TimeBand = {
  baseFareYen: number;
  includedMinutes: number;
  addEveryMin: number;
  addFareYen: number;
};

export type SpecialFareEntry = {
  id: string;
  name: string;
  regime: "distance" | "time" | "both";
  distance?: DistanceBand;
  time?: TimeBand;
  nightExtraYen?: number;
  earlyExtraYen?: number;
  memberExtraYen?: number;
};

export type PricingPrefsV1 = {
  version: 1;
  regime: "" | "distance" | "time" | "both";
  features: string[];
  mainDistance?: DistanceBand;
  mainTime?: TimeBand;
  pickupBaseYen?: number;
  waiting?: TimeBand;
  leftHandBaseYen?: number;
  foreignCarBaseYen?: number;
  cancelBaseYen?: number;
  specialFares: SpecialFareEntry[];
};

function num(v: unknown, d = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : d;
}

function distanceBand(o: unknown): DistanceBand {
  const x = o && typeof o === "object" ? (o as Record<string, unknown>) : {};
  return {
    baseFareYen: num(x.baseFareYen),
    includedDistanceM: num(x.includedDistanceM),
    addEveryM: num(x.addEveryM),
    addFareYen: num(x.addFareYen),
  };
}

function timeBand(o: unknown): TimeBand {
  const x = o && typeof o === "object" ? (o as Record<string, unknown>) : {};
  return {
    baseFareYen: num(x.baseFareYen),
    includedMinutes: num(x.includedMinutes),
    addEveryMin: num(x.addEveryMin),
    addFareYen: num(x.addFareYen),
  };
}

function optionalDistance(o: unknown): DistanceBand | undefined {
  if (!o || typeof o !== "object") return undefined;
  return distanceBand(o);
}

function optionalTime(o: unknown): TimeBand | undefined {
  if (!o || typeof o !== "object") return undefined;
  return timeBand(o);
}

export function emptyDistanceBand(): DistanceBand {
  return { baseFareYen: 0, includedDistanceM: 0, addEveryM: 0, addFareYen: 0 };
}

export function emptyTimeBand(): TimeBand {
  return { baseFareYen: 0, includedMinutes: 0, addEveryMin: 0, addFareYen: 0 };
}

export function sanitizeFeatureList(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  return [...new Set(arr.filter((id) => !PRICING_STRIP.has(id)))];
}

export function coercePricingPrefs(raw: unknown): PricingPrefsV1 {
  const p = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const regime =
    p.regime === "distance" || p.regime === "time" || p.regime === "both" || p.regime === ""
      ? (p.regime as PricingPrefsV1["regime"])
      : "";
  const features = sanitizeFeatureList(p.features);

  const specialRaw = Array.isArray(p.specialFares) ? p.specialFares : [];
  const specialFares: SpecialFareEntry[] = specialRaw
    .map((item, i) => {
      const it = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const id = typeof it.id === "string" && it.id.trim() ? it.id.trim() : `sf_${i}`;
      const name = String(it.name ?? "").trim().slice(0, 120);
      const reg: SpecialFareEntry["regime"] =
        it.regime === "distance" || it.regime === "time" || it.regime === "both" ? it.regime : "distance";
      const row: SpecialFareEntry = {
        id,
        name,
        regime: reg,
        distance: optionalDistance(it.distance) ?? emptyDistanceBand(),
        time: optionalTime(it.time) ?? emptyTimeBand(),
        nightExtraYen: num(it.nightExtraYen),
        earlyExtraYen: num(it.earlyExtraYen),
        memberExtraYen: num(it.memberExtraYen),
      };
      return row;
    })
    .filter((x) => x.name.length > 0);

  return {
    version: 1,
    regime,
    features,
    mainDistance: optionalDistance(p.mainDistance) ?? emptyDistanceBand(),
    mainTime: optionalTime(p.mainTime) ?? emptyTimeBand(),
    pickupBaseYen: num(p.pickupBaseYen),
    waiting: optionalTime(p.waiting) ?? emptyTimeBand(),
    leftHandBaseYen: num(p.leftHandBaseYen),
    foreignCarBaseYen: num(p.foreignCarBaseYen),
    cancelBaseYen: num(p.cancelBaseYen),
    specialFares,
  };
}

export function mergePricingPrefsUpdate(
  prev: PricingPrefsV1,
  body: Record<string, unknown>,
): PricingPrefsV1 {
  if (body.pricingPrefs !== undefined && typeof body.pricingPrefs === "object") {
    return coercePricingPrefs(body.pricingPrefs);
  }
  return {
    ...prev,
    regime:
      body.regime !== undefined && (body.regime === "" || body.regime === "distance" || body.regime === "time" || body.regime === "both")
        ? (body.regime as PricingPrefsV1["regime"])
        : prev.regime,
    features: body.features !== undefined ? sanitizeFeatureList(body.features) : prev.features,
  };
}

/** 日報の付帯料金デフォルト（チェック時にクライアントが使う） */
export function tripSurchargeDefaults(prefs: PricingPrefsV1): {
  pickupYen: number;
  leftHandYen: number;
  foreignCarYen: number;
  cancelYen: number;
} {
  return {
    pickupYen: prefs.pickupBaseYen ?? 0,
    leftHandYen: prefs.leftHandBaseYen ?? 0,
    foreignCarYen: prefs.foreignCarBaseYen ?? 0,
    cancelYen: prefs.cancelBaseYen ?? 0,
  };
}

export type LegSurchargesV1 = {
  pickup?: { apply: boolean; yen: number };
  leftHand?: { apply: boolean; yen: number };
  foreignCar?: { apply: boolean; yen: number };
  cancel?: { apply: boolean; yen: number };
};

export function coerceLegSurcharges(raw: unknown): LegSurchargesV1 {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const slot = (k: string): { apply: boolean; yen: number } | undefined => {
    const v = o[k];
    if (!v || typeof v !== "object") return undefined;
    const x = v as Record<string, unknown>;
    return { apply: Boolean(x.apply), yen: num(x.yen) };
  };
  return {
    pickup: slot("pickup"),
    leftHand: slot("leftHand"),
    foreignCar: slot("foreignCar"),
    cancel: slot("cancel"),
  };
}

/** PATCH 用: 既存 legSurchargesJson に部分更新をマージ */
export function mergeLegSurchargesJson(existing: unknown, patch: unknown): Record<string, unknown> {
  const cur = coerceLegSurcharges(existing);
  const p = patch && typeof patch === "object" ? (patch as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const k of ["pickup", "leftHand", "foreignCar", "cancel"] as const) {
    const prev = (cur as Record<string, { apply: boolean; yen: number } | undefined>)[k];
    const next = p[k];
    if (next !== undefined && next !== null && typeof next === "object") {
      const slot = next as Record<string, unknown>;
      out[k] = {
        apply: slot.apply !== undefined ? Boolean(slot.apply) : prev?.apply ?? false,
        yen: num(slot.yen !== undefined ? slot.yen : prev?.yen ?? 0),
      };
    } else if (prev) {
      out[k] = { apply: prev.apply, yen: prev.yen };
    }
  }
  return out;
}

/**
 * サーバの `src/lib/pricing.ts` / `tariff-waiting.ts` と同ロジック（料金画面シミュレータ用）。
 * Web 依存に zod を足さないため、待機ルールは手動パースで同等判定。
 */

export type WaitingRule =
  | { type: "linear"; graceMin: number; perMinYen: number }
  | { type: "block"; graceMin: number; blockEveryMin: number; blockYen: number }
  | { type: "grace_flat_then_linear"; graceMin: number; firstChargeYen: number; perMinAfterFirstYen: number }
  | {
      type: "prefix_block_then_block";
      graceMin: number;
      prefixMin: number;
      prefixYen: number;
      blockEveryMin: number;
      blockYen: number;
    };

export function parseWaitingRule(input: unknown, legacyPerMinYen: number): WaitingRule {
  const leg = Math.max(0, Math.floor(legacyPerMinYen));
  if (!input || typeof input !== "object") {
    return { type: "linear", graceMin: 0, perMinYen: leg };
  }
  const o = input as Record<string, unknown>;
  const t = o.type;
  if (t === "linear") {
    const graceMin = Math.max(0, Math.floor(Number(o.graceMin ?? 0)));
    const perMinYen = Math.max(0, Math.floor(Number(o.perMinYen ?? leg)));
    return { type: "linear", graceMin, perMinYen };
  }
  if (t === "block") {
    const graceMin = Math.max(0, Math.floor(Number(o.graceMin ?? 0)));
    const blockEveryMin = Math.max(1, Math.floor(Number(o.blockEveryMin ?? 1)));
    const blockYen = Math.max(0, Math.floor(Number(o.blockYen ?? 0)));
    return { type: "block", graceMin, blockEveryMin, blockYen };
  }
  if (t === "grace_flat_then_linear") {
    const graceMin = Math.max(0, Math.floor(Number(o.graceMin ?? 0)));
    const firstChargeYen = Math.max(0, Math.floor(Number(o.firstChargeYen ?? 0)));
    const perMinAfterFirstYen = Math.max(0, Math.floor(Number(o.perMinAfterFirstYen ?? 0)));
    return { type: "grace_flat_then_linear", graceMin, firstChargeYen, perMinAfterFirstYen };
  }
  if (t === "prefix_block_then_block") {
    const graceMin = Math.max(0, Math.floor(Number(o.graceMin ?? 0)));
    const prefixMin = Math.max(0, Math.floor(Number(o.prefixMin ?? 0)));
    const prefixYen = Math.max(0, Math.floor(Number(o.prefixYen ?? 0)));
    const blockEveryMin = Math.max(1, Math.floor(Number(o.blockEveryMin ?? 1)));
    const blockYen = Math.max(0, Math.floor(Number(o.blockYen ?? 0)));
    return { type: "prefix_block_then_block", graceMin, prefixMin, prefixYen, blockEveryMin, blockYen };
  }
  return { type: "linear", graceMin: 0, perMinYen: leg };
}

export function waitingFareYen(rule: WaitingRule, waitingMinutes: number): number {
  const m = Math.max(0, Math.floor(waitingMinutes));
  if (rule.type === "linear") {
    const billable = Math.max(0, m - rule.graceMin);
    return billable * rule.perMinYen;
  }
  if (rule.type === "block") {
    const billable = Math.max(0, m - rule.graceMin);
    if (billable <= 0) return 0;
    return Math.ceil(billable / rule.blockEveryMin) * rule.blockYen;
  }
  if (rule.type === "prefix_block_then_block") {
    if (m <= rule.graceMin) return 0;
    if (m <= rule.graceMin + rule.prefixMin) return rule.prefixYen;
    const over = m - rule.graceMin - rule.prefixMin;
    return rule.prefixYen + Math.ceil(over / rule.blockEveryMin) * rule.blockYen;
  }
  const billable = Math.max(0, m - rule.graceMin);
  if (billable <= 0) return 0;
  if (billable === 1) return rule.firstChargeYen;
  return rule.firstChargeYen + (billable - 1) * rule.perMinAfterFirstYen;
}

export type SegmentPick = {
  fromM: number;
  toM: number;
  fareYen: number;
  fareMemberYen?: number | null;
};

export type TierPick = {
  sortOrder: number;
  fromM: number;
  untilM: number | null;
  stepM: number;
  addYenPerStep: number;
};

export type VersionPricingInput = {
  distanceMode: string;
  initialDistanceM: number;
  initialFareYen: number;
  addUnitDistanceM: number;
  addFareYen: number;
  waitingFareYenPerMin: number;
  waitingRuleJson: unknown;
  perViaStopYen?: number | null;
  nightSurchargeBps?: number | null;
  leftHandSurchargeBps?: number | null;
  pickupRuleJson?: unknown;
  distanceDiscountFromM?: number | null;
  distanceDiscountBps?: number | null;
  nightSurchargeFlatYen?: number | null;
  lateNightFlatYen?: number | null;
  earlyMorningFlatYen?: number | null;
  earlyRushFlatYen?: number | null;
};

export type TripPricingOpts = {
  isMember?: boolean;
  viaStopCount?: number;
  applyNightSurcharge?: boolean;
  applyLeftHandSurcharge?: boolean;
  pickupFromBaseM?: number | null;
  applyNightSurchargeFlat?: boolean;
  applyLateNightFlatYen?: boolean;
  applyEarlyMorningFlatYen?: boolean;
  applyEarlyRushFlatYen?: boolean;
};

function modeOf(v: VersionPricingInput): string {
  return String(v.distanceMode);
}

function segmentHitFare(seg: SegmentPick, isMember: boolean): number {
  if (isMember && seg.fareMemberYen != null && seg.fareMemberYen !== undefined) {
    return Math.max(0, seg.fareMemberYen);
  }
  return Math.max(0, seg.fareYen);
}

export function segmentFareYen(segments: SegmentPick[], distanceM: number, isMember: boolean): number | null {
  if (!segments.length) return null;
  const dist = Math.max(0, Math.floor(distanceM));
  const sorted = [...segments].sort((a, b) => a.fromM - b.fromM);
  for (const s of sorted) {
    if (dist >= s.fromM && dist <= s.toM) return segmentHitFare(s, isMember);
  }
  return null;
}

function fareInitialAdd(version: VersionPricingInput, distanceM: number, segments: SegmentPick[], isMember: boolean): number {
  const seg = segmentFareYen(segments, distanceM, isMember);
  if (seg !== null) return seg;
  const dist = Math.max(0, Math.floor(distanceM));
  if (dist <= version.initialDistanceM) return Math.max(0, version.initialFareYen);
  const extra = dist - version.initialDistanceM;
  const unit = Math.max(1, version.addUnitDistanceM);
  const units = Math.ceil(extra / unit);
  return Math.max(0, version.initialFareYen + units * version.addFareYen);
}

function fareSegmentsOnly(distanceM: number, segments: SegmentPick[], isMember: boolean): number | null {
  return segmentFareYen(segments, distanceM, isMember);
}

function sortedTiers(tiers: TierPick[]): TierPick[] {
  return [...tiers].sort((a, b) => a.sortOrder - b.sortOrder || a.fromM - b.fromM);
}

function pickTierForPosition(list: TierPick[], pos: number): TierPick | null {
  const candidates = list.filter((t) => pos >= t.fromM && (t.untilM == null || pos < t.untilM));
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.fromM - a.fromM || a.sortOrder - b.sortOrder);
  return candidates[0] ?? null;
}

export function fareYenTieredAdd(
  initialDistanceM: number,
  initialFareYen: number,
  tiers: TierPick[],
  distanceM: number,
): number | null {
  const D = Math.max(0, Math.floor(distanceM));
  if (D <= initialDistanceM) return Math.max(0, initialFareYen);
  let fare = Math.max(0, initialFareYen);
  let pos = initialDistanceM;
  const list = sortedTiers(tiers);
  if (!list.length) return null;
  let guard = 0;
  while (pos < D && guard++ < 100000) {
    const tier = pickTierForPosition(list, pos);
    if (!tier || tier.stepM < 1) return null;
    const cap = tier.untilM == null ? D : Math.min(D, tier.untilM);
    if (cap <= pos) return null;
    const span = cap - pos;
    const steps = Math.ceil(span / tier.stepM);
    fare += steps * tier.addYenPerStep;
    pos = cap;
  }
  return fare;
}

export function fareYenForDistance(
  version: VersionPricingInput,
  distanceM: number,
  segments: SegmentPick[] = [],
  tiers: TierPick[] = [],
  isMember = false,
): number | null {
  const mode = modeOf(version);
  if (mode === "SEGMENTS_ONLY") {
    return fareSegmentsOnly(distanceM, segments, isMember);
  }
  if (mode === "TIERED_ADD") {
    return fareYenTieredAdd(version.initialDistanceM, version.initialFareYen, tiers, distanceM);
  }
  return fareInitialAdd(version, distanceM, segments, isMember);
}

function applyBps(amount: number, bps: number): number {
  if (!bps) return amount;
  return Math.round((amount * (10000 + bps)) / 10000);
}

type PickupTier = { fromM: number; toM: number | null; yen: number };

function parsePickupTiersWeb(input: unknown): PickupTier[] {
  if (!Array.isArray(input)) return [];
  const out: PickupTier[] = [];
  for (const row of input) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const fromM = Math.floor(Number(r.fromM));
    const yen = Math.floor(Number(r.yen));
    if (!Number.isFinite(fromM) || fromM < 0 || !Number.isFinite(yen) || yen < 0) continue;
    const toRaw = r.toM;
    const toM = toRaw === null || toRaw === undefined || toRaw === "" ? null : Math.floor(Number(toRaw));
    if (toM !== null && (!Number.isFinite(toM) || toM < fromM)) continue;
    out.push({ fromM, toM, yen });
  }
  return out;
}

export function pickupFareYen(pickupRuleJson: unknown, pickupFromBaseM: number | null | undefined): number {
  if (pickupFromBaseM == null || !Number.isFinite(pickupFromBaseM)) return 0;
  const d = Math.max(0, Math.floor(pickupFromBaseM));
  const tiers = [...parsePickupTiersWeb(pickupRuleJson)].sort((a, b) => a.fromM - b.fromM);
  for (const t of tiers) {
    if (d >= t.fromM && (t.toM == null || d <= t.toM)) return t.yen;
  }
  return 0;
}

export function fareYenForTrip(
  version: VersionPricingInput,
  distanceM: number,
  waitingMinutes: number,
  segments: SegmentPick[] = [],
  tiers: TierPick[] = [],
  opts: TripPricingOpts = {},
): number {
  const rawDistance = fareYenForDistance(version, distanceM, segments, tiers, opts.isMember ?? false);
  let distanceFare = rawDistance === null ? 0 : rawDistance;
  const dist = Math.max(0, Math.floor(distanceM));
  const fromM = version.distanceDiscountFromM;
  if (fromM != null && dist >= fromM) {
    distanceFare = applyBps(distanceFare, version.distanceDiscountBps ?? 0);
  }
  if (opts.applyNightSurcharge) {
    const bps = version.nightSurchargeBps ?? 0;
    distanceFare = applyBps(distanceFare, bps);
  }
  if (opts.applyLeftHandSurcharge) {
    const bps = version.leftHandSurchargeBps ?? 0;
    distanceFare = applyBps(distanceFare, bps);
  }

  let total = distanceFare;
  if (opts.applyNightSurchargeFlat) total += Math.max(0, version.nightSurchargeFlatYen ?? 0);
  if (opts.applyLateNightFlatYen) total += Math.max(0, version.lateNightFlatYen ?? 0);
  if (opts.applyEarlyMorningFlatYen) total += Math.max(0, version.earlyMorningFlatYen ?? 0);
  if (opts.applyEarlyRushFlatYen) total += Math.max(0, version.earlyRushFlatYen ?? 0);

  const rule = parseWaitingRule(version.waitingRuleJson, version.waitingFareYenPerMin);
  const wait = waitingFareYen(rule, waitingMinutes);
  const via = Math.max(0, Math.floor(opts.viaStopCount ?? 0)) * Math.max(0, version.perViaStopYen ?? 0);
  const pickup = pickupFareYen(version.pickupRuleJson, opts.pickupFromBaseM);
  return Math.max(0, total + wait + via + pickup);
}

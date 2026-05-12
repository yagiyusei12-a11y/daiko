import type { TariffDistanceMode } from "@prisma/client";
import { pickupFareYen } from "./pickup-pricing.js";
import { parseWaitingRule, waitingFareYen, type WaitingRule } from "./tariff-waiting.js";

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
  distanceMode: TariffDistanceMode | string;
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
  leftHandSurchargeFlatYen?: number | null;
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
  applyLeftHandSurchargeFlat?: boolean;
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

/**
 * 距離帯セグメントに該当すれば運賃（円）を返す。該当なしは null。
 */
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

/**
 * TIERED_ADD: 初乗り区間は initial。超過分を tier の区間ごとに step 単位で加算（セグメントは無視）。
 */
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

/**
 * 料金版と実車距離から距離運賃（円）。SEGMENTS_ONLY で未ヒットは null。
 */
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

/**
 * 距離運賃（割引・％割増は距離部分のみ）＋定額割増＋待機＋経由＋迎車。
 */
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
  if (opts.applyLeftHandSurchargeFlat) total += Math.max(0, version.leftHandSurchargeFlatYen ?? 0);

  const rule: WaitingRule = parseWaitingRule(version.waitingRuleJson, version.waitingFareYenPerMin);
  const wait = waitingFareYen(rule, waitingMinutes);
  const via = Math.max(0, Math.floor(opts.viaStopCount ?? 0)) * Math.max(0, version.perViaStopYen ?? 0);
  const pickup = pickupFareYen(version.pickupRuleJson, opts.pickupFromBaseM);
  return Math.max(0, total + wait + via + pickup);
}

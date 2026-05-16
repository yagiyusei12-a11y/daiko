/** 設定料金（距離/時間制）→ 日報運賃の算出（サーバー pricing-prefs と同ロジック） */

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

export type PricingForTrips = {
  regime: "" | "distance" | "time" | "both";
  mainDistance: DistanceBand;
  mainTime: TimeBand;
};

export function fareFromDistanceBand(band: DistanceBand, distanceM: number): number {
  const dist = Math.max(0, Math.floor(distanceM));
  if (dist <= 0) return 0;
  const included = Math.max(0, band.includedDistanceM);
  let fare = Math.max(0, band.baseFareYen);
  if (dist <= included) return fare;
  const step = Math.max(0, band.addEveryM);
  if (step <= 0) return fare;
  const over = dist - included;
  const steps = Math.ceil(over / step);
  return fare + steps * Math.max(0, band.addFareYen);
}

export function fareFromTimeBand(band: TimeBand, travelMinutes: number): number {
  const mins = Math.max(0, Math.floor(travelMinutes));
  if (mins <= 0) return 0;
  const included = Math.max(0, band.includedMinutes);
  let fare = Math.max(0, band.baseFareYen);
  if (mins <= included) return fare;
  const step = Math.max(0, band.addEveryMin);
  if (step <= 0) return fare;
  const over = mins - included;
  const steps = Math.ceil(over / step);
  return fare + steps * Math.max(0, band.addFareYen);
}

export function computeMainFareYenFromPrefs(
  prefs: PricingForTrips,
  distanceM: number,
  travelMinutes: number,
): number | null {
  if (!prefs.regime) return null;
  let total = 0;
  if (prefs.regime === "distance" || prefs.regime === "both") {
    total += fareFromDistanceBand(prefs.mainDistance, distanceM);
  }
  if (prefs.regime === "time" || prefs.regime === "both") {
    total += fareFromTimeBand(prefs.mainTime, travelMinutes);
  }
  return total;
}

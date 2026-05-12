/** サーバの `src/lib/pricing.ts` と同ロジック（料金画面シミュレータ用） */

type VersionBase = {
  initialDistanceM: number;
  initialFareYen: number;
  addUnitDistanceM: number;
  addFareYen: number;
  waitingFareYenPerMin: number;
};

type SegmentPick = { fromM: number; toM: number; fareYen: number };

export function segmentFareYen(segments: SegmentPick[], distanceM: number): number | null {
  if (!segments.length) return null;
  const dist = Math.max(0, Math.floor(distanceM));
  const sorted = [...segments].sort((a, b) => a.fromM - b.fromM);
  for (const s of sorted) {
    if (dist >= s.fromM && dist <= s.toM) return Math.max(0, s.fareYen);
  }
  return null;
}

export function fareYenForDistance(
  version: VersionBase,
  distanceM: number,
  segments: SegmentPick[] = [],
): number {
  const seg = segmentFareYen(segments, distanceM);
  if (seg !== null) return seg;
  const dist = Math.max(0, Math.floor(distanceM));
  if (dist <= version.initialDistanceM) return Math.max(0, version.initialFareYen);
  const extra = dist - version.initialDistanceM;
  const unit = Math.max(1, version.addUnitDistanceM);
  const units = Math.ceil(extra / unit);
  return Math.max(0, version.initialFareYen + units * version.addFareYen);
}

export function fareYenForTrip(
  version: VersionBase,
  distanceM: number,
  waitingMinutes: number,
  segments: SegmentPick[] = [],
): number {
  const base = fareYenForDistance(version, distanceM, segments);
  const waitMin = Math.max(0, Math.floor(waitingMinutes));
  const perMin = Math.max(0, version.waitingFareYenPerMin);
  return base + waitMin * perMin;
}

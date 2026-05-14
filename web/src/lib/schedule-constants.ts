/** Must match `src/lib/schedule-constants.ts` (GET drivers 仮想行 / POST で null に変換). */
export const SCHEDULE_UNASSIGNED_DRIVER_ID = "__daiko_schedule_unassigned__" as const;

const UNASSIGNED_LANE_RE = /^__daiko_unassigned_lane_(\d+)__$/;

export function scheduleUnassignedLaneEmployeeId(lane: number): string {
  const n = Math.max(1, Math.min(50, Math.floor(lane)));
  return `__daiko_unassigned_lane_${n}__`;
}

export function parseScheduleUnassignedLaneEmployeeId(id: string): number | null {
  const m = UNASSIGNED_LANE_RE.exec(id.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : null;
}

export function scheduleDriverFieldToDb(
  driverRaw: string,
): { driverEmployeeId: string | null; virtualLane: number | null } {
  if (driverRaw === SCHEDULE_UNASSIGNED_DRIVER_ID) {
    return { driverEmployeeId: null, virtualLane: 1 };
  }
  const lane = parseScheduleUnassignedLaneEmployeeId(driverRaw);
  if (lane !== null) {
    return { driverEmployeeId: null, virtualLane: lane };
  }
  return { driverEmployeeId: driverRaw, virtualLane: null };
}

export function scheduleDbUnassignedToDriverColumnKey(virtualLane: number | null | undefined): string {
  const lane = virtualLane == null || virtualLane < 1 ? 1 : Math.min(50, Math.floor(virtualLane));
  if (lane === 1) return SCHEDULE_UNASSIGNED_DRIVER_ID;
  return scheduleUnassignedLaneEmployeeId(lane);
}

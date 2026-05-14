/** GET /dispatch/schedule の drivers にだけ出す仮想行。POST では null 保存に変換する（レーン1・従来）。 */
export const SCHEDULE_UNASSIGNED_DRIVER_ID = "__daiko_schedule_unassigned__" as const;

const UNASSIGNED_LANE_RE = /^__daiko_unassigned_lane_(\d+)__$/;

/** 未予定レーン2以降の列 id（1 は従来の SCHEDULE_UNASSIGNED_DRIVER_ID と同義扱い）。 */
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

/** フォームの担当値 → DB の driverEmployeeId と virtualLane */
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

/** DB の null 担当行 → スケジュール列キー */
export function scheduleDbUnassignedToDriverColumnKey(virtualLane: number | null | undefined): string {
  const lane = virtualLane == null || virtualLane < 1 ? 1 : Math.min(50, Math.floor(virtualLane));
  if (lane === 1) return SCHEDULE_UNASSIGNED_DRIVER_ID;
  return scheduleUnassignedLaneEmployeeId(lane);
}

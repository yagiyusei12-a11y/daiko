/** スケジュール保存時・枠が埋まっている／重なっているときのトースト文言 */
export const SCHEDULE_SLOT_UNAVAILABLE_MSG = "その時間は空きがありません。";

export function isScheduleSlotUnavailableError(status: number, error: string): boolean {
  if (status === 409) return true;
  if (status !== 400) return false;
  return (
    error.includes("重な") ||
    error.includes("空き") ||
    error.includes("別の予定") ||
    error.includes("未予定列") ||
    error.includes("同時予約")
  );
}

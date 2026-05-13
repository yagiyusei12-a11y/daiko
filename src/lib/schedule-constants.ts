/** GET /dispatch/schedule の drivers にだけ出す仮想行。POST では null 保存に変換する。 */
export const SCHEDULE_UNASSIGNED_DRIVER_ID = "__daiko_schedule_unassigned__" as const;

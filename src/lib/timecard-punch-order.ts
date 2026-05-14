/** タイムカード打刻の許可順（同日・1勤務あたり）: 出勤 →（休憩入→休憩終）任意 → 退勤。出勤は1回のみ。退勤後は打刻不可。 */

export function validateNextTimecardPunch(
  existingSortedAsc: { kind: string }[],
  nextKind: string,
): string | null {
  const nk = String(nextKind).trim();
  const sorted = existingSortedAsc;
  const hasClockIn = sorted.some((p) => p.kind === "CLOCK_IN");

  if (nk === "CLOCK_IN") {
    if (hasClockIn) return "この事業日はすでに出勤打刻があるため、出勤は1回だけです";
    if (sorted.length > 0) return "出勤で始めてください";
    return null;
  }

  if (!hasClockIn) return "先に出勤打刻を行ってください";

  const last = sorted[sorted.length - 1]?.kind;
  if (last === "CLOCK_OUT") return "本日はすでに退勤済みのため、これ以上打刻できません";

  if (nk === "CLOCK_OUT") {
    if (last === "CLOCK_IN" || last === "BREAK_END") return null;
    if (last === "BREAK_START") return "休憩入のあとに退勤するには、先に休憩終を打刻してください";
    return "この打刻は現在の手順ではできません";
  }
  if (nk === "BREAK_START") {
    if (last === "CLOCK_IN") return null;
    return "休憩入は出勤の直後にだけ打刻できます（休憩は1セットまで）";
  }
  if (nk === "BREAK_END") {
    if (last === "BREAK_START") return null;
    return "休憩終は休憩入の直後にだけ打刻できます";
  }
  return "不正な打刻種別です";
}

export function timecardButtonAvailability(existingSortedAsc: { kind: string }[]): {
  clockIn: boolean;
  clockOut: boolean;
  breakStart: boolean;
  breakEnd: boolean;
} {
  return {
    clockIn: validateNextTimecardPunch(existingSortedAsc, "CLOCK_IN") === null,
    clockOut: validateNextTimecardPunch(existingSortedAsc, "CLOCK_OUT") === null,
    breakStart: validateNextTimecardPunch(existingSortedAsc, "BREAK_START") === null,
    breakEnd: validateNextTimecardPunch(existingSortedAsc, "BREAK_END") === null,
  };
}

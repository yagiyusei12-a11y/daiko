/** 15分刻みの分（0, 15, 30, 45） */
export const QUARTER_MINUTES = [0, 15, 30, 45] as const;

export function snapMinuteToQuarter(minute: number): (typeof QUARTER_MINUTES)[number] {
  const m = Math.max(0, Math.min(59, Math.round(minute)));
  const snapped = Math.round(m / 15) * 15;
  return (snapped === 60 ? 0 : snapped) as (typeof QUARTER_MINUTES)[number];
}

export type QuarterHourDatetimeParts = {
  date: string;
  hour: number;
  minute: (typeof QUARTER_MINUTES)[number];
};

/** `datetime-local` 形式 `YYYY-MM-DDTHH:mm` を分解（不正時は今日・0:00） */
export function parseQuarterHourDatetimeLocal(value: string): QuarterHourDatetimeParts {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return {
      date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      hour: now.getHours(),
      minute: snapMinuteToQuarter(now.getMinutes()),
    };
  }
  const hour = Math.max(0, Math.min(23, Number(m[2]) || 0));
  return {
    date: m[1],
    hour,
    minute: snapMinuteToQuarter(Number(m[3]) || 0),
  };
}

export function formatQuarterHourDatetimeLocal(parts: QuarterHourDatetimeParts): string {
  const h = String(parts.hour).padStart(2, "0");
  const min = String(parts.minute).padStart(2, "0");
  return `${parts.date}T${h}:${min}`;
}

export function snapQuarterHourDatetimeLocal(value: string): string {
  return formatQuarterHourDatetimeLocal(parseQuarterHourDatetimeLocal(value));
}

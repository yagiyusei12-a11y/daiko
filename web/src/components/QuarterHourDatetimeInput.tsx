import {
  QUARTER_MINUTES,
  formatQuarterHourDatetimeLocal,
  parseQuarterHourDatetimeLocal,
  snapQuarterHourDatetimeLocal,
} from "../lib/quarter-hour-datetime";

type Props = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
};

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export default function QuarterHourDatetimeInput({ id, value, onChange }: Props): JSX.Element {
  const parts = parseQuarterHourDatetimeLocal(value);

  function emit(next: Partial<typeof parts>): void {
    onChange(formatQuarterHourDatetimeLocal({ ...parts, ...next }));
  }

  return (
    <div className="quarter-hour-datetime" role="group">
      <input
        id={id}
        type="date"
        className="quarter-hour-datetime-date"
        value={parts.date}
        onChange={(e) => emit({ date: e.target.value })}
      />
      <select
        className="quarter-hour-datetime-hour"
        aria-label="時"
        value={parts.hour}
        onChange={(e) => emit({ hour: Number(e.target.value) })}
      >
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {String(h).padStart(2, "0")}時
          </option>
        ))}
      </select>
      <select
        className="quarter-hour-datetime-minute"
        aria-label="分"
        value={parts.minute}
        onChange={(e) => emit({ minute: Number(e.target.value) as (typeof QUARTER_MINUTES)[number] })}
      >
        {QUARTER_MINUTES.map((min) => (
          <option key={min} value={min}>
            {String(min).padStart(2, "0")}分
          </option>
        ))}
      </select>
    </div>
  );
}

export { snapQuarterHourDatetimeLocal };

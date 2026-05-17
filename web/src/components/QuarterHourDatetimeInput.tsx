import {
  QUARTER_MINUTES,
  flexSchedulePartsToStartLocal,
  startLocalToFlexScheduleParts,
  type FlexScheduleDatetimeParts,
} from "../lib/quarter-hour-datetime";

type Props = {
  id?: string;
  /** 事業日（スケジュール表示日）。日付欄はこの日付を表示 */
  businessDateYmd: string;
  /** 28時間表記の日付変更時刻（通常 28） */
  dayChangeHour: number;
  /** API 用 `YYYY-MM-DDTHH:mm`（東京壁時計） */
  value: string;
  onChange: (value: string) => void;
};

function flexHourOptions(dayChangeHour: number): number[] {
  const max = Math.max(24, Math.min(48, Math.round(dayChangeHour)));
  return Array.from({ length: max + 1 }, (_, i) => i);
}

export default function QuarterHourDatetimeInput({
  id,
  businessDateYmd,
  dayChangeHour,
  value,
  onChange,
}: Props): JSX.Element {
  const parts = startLocalToFlexScheduleParts(businessDateYmd, value, dayChangeHour);
  const hours = flexHourOptions(dayChangeHour);

  function emit(next: Partial<FlexScheduleDatetimeParts>): void {
    onChange(
      flexSchedulePartsToStartLocal({
        businessDateYmd: next.businessDateYmd ?? parts.businessDateYmd,
        flexHour: next.flexHour ?? parts.flexHour,
        minute: next.minute ?? parts.minute,
      }),
    );
  }

  return (
    <div className="quarter-hour-datetime" role="group" aria-label="日時（事業日・28時間表記）">
      <input
        id={id}
        type="date"
        className="quarter-hour-datetime-date"
        value={parts.businessDateYmd}
        readOnly
        aria-readonly="true"
        title="事業日（日マタギ基準）"
      />
      <select
        className="quarter-hour-datetime-hour"
        aria-label="時（28時間表記）"
        value={parts.flexHour}
        onChange={(e) => emit({ flexHour: Number(e.target.value) })}
      >
        {hours.map((h) => (
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

export {
  defaultStartLocalForScheduleBusinessDay,
  snapQuarterHourDatetimeLocal,
  startLocalFromIsoForBusinessDay,
} from "../lib/quarter-hour-datetime";

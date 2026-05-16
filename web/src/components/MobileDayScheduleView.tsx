import { useEffect, useMemo, useRef } from "react";
import { currentBusinessYmd } from "../auth";
import { SCHEDULE_UNASSIGNED_DRIVER_ID } from "../lib/schedule-constants";
import {
  GCAL_HOUR_HEIGHT_PX,
  axisGridHeightPx,
  formatAxisTimeLabel,
  hourTicks,
  layoutTimedEvents,
  minutesToTopPx,
  type ScheduleAxis,
} from "../lib/schedule-day-layout";

export type MobileReservation = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  driverEmployeeId: string | null;
  detail: {
    customerName: string;
    pickup: string;
    dropoff: string;
  };
};

type DriverRow = { employeeId: string; name: string };

type Props = {
  viewDate: string;
  axis: ScheduleAxis;
  reservations: MobileReservation[];
  drivers: DriverRow[];
  dayChangeHour: number;
  getMinutes: (rv: MobileReservation) => { startMin: number; endMin: number };
  onEventPointerDown: (e: React.PointerEvent, rv: MobileReservation, track: HTMLDivElement) => void;
  onFabClick: () => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  onPickDate: (ymd: string) => void;
};

const EVENT_PALETTE = [
  { bg: "#FDE68A", border: "#F59E0B", text: "#78350F" },
  { bg: "#BFDBFE", border: "#3B82F6", text: "#1E3A8A" },
  { bg: "#BBF7D0", border: "#22C55E", text: "#14532D" },
  { bg: "#FBCFE8", border: "#EC4899", text: "#831843" },
  { bg: "#DDD6FE", border: "#8B5CF6", text: "#4C1D95" },
  { bg: "#FECACA", border: "#EF4444", text: "#7F1D1D" },
] as const;

function colorForColumnKey(key: string): (typeof EVENT_PALETTE)[number] {
  if (key === SCHEDULE_UNASSIGNED_DRIVER_ID) {
    return { bg: "#E2E8F0", border: "#94A3B8", text: "#334155" };
  }
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return EVENT_PALETTE[h % EVENT_PALETTE.length];
}

function formatHeaderMonthJa(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!Number.isFinite(y)) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat("ja-JP", { month: "long", timeZone: "Asia/Tokyo" }).format(dt);
}

function formatHeaderWeekdayJa(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat("ja-JP", { weekday: "short", timeZone: "Asia/Tokyo" }).format(dt);
}

function formatEventTimeRange(startMin: number, endMin: number): string {
  return `${formatAxisTimeLabel(startMin)} – ${formatAxisTimeLabel(endMin)}`;
}

export default function MobileDayScheduleView({
  viewDate,
  axis,
  reservations,
  drivers,
  dayChangeHour,
  getMinutes,
  onEventPointerDown,
  onFabClick,
  onPrevDay,
  onNextDay,
  onPickDate,
}: Props): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const gridHeightPx = axisGridHeightPx(axis, GCAL_HOUR_HEIGHT_PX);
  const ticks = hourTicks(axis);

  const driverNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of drivers) m.set(d.employeeId, d.name);
    return m;
  }, [drivers]);

  const timedEvents = useMemo(
    () =>
      reservations.map((rv) => {
        const { startMin, endMin } = getMinutes(rv);
        return { id: rv.id, startMin, endMin };
      }),
    [reservations, getMinutes],
  );

  const layout = useMemo(() => layoutTimedEvents(timedEvents, axis, GCAL_HOUR_HEIGHT_PX), [timedEvents, axis]);

  const todayYmd = currentBusinessYmd(dayChangeHour);
  const isToday = viewDate === todayYmd;

  const nowTopPx = useMemo(() => {
    if (!isToday) return null;
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const nowMin = get("hour") * 60 + get("minute");
    if (nowMin < axis.mn || nowMin > axis.mx) return null;
    return minutesToTopPx(nowMin, axis, GCAL_HOUR_HEIGHT_PX);
  }, [isToday, axis]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || nowTopPx == null) return;
    el.scrollTop = Math.max(0, nowTopPx - el.clientHeight * 0.25);
  }, [viewDate, nowTopPx]);

  const dayNum = Number(viewDate.split("-")[2]) || 1;

  return (
    <div className="gcal-day">
      <header className="gcal-day-header">
        <div className="gcal-day-header-row">
          <button type="button" className="gcal-day-nav" onClick={onPrevDay} aria-label="前の日">
            ‹
          </button>
          <div className="gcal-day-header-center">
            <label className="gcal-day-month">
              <span className="gcal-day-month-label">{formatHeaderMonthJa(viewDate)}</span>
              <input
                type="date"
                className="gcal-day-date-input"
                value={viewDate}
                onChange={(e) => onPickDate(e.target.value)}
                aria-label="表示日を選択"
              />
            </label>
          </div>
          <button type="button" className="gcal-day-nav" onClick={onNextDay} aria-label="次の日">
            ›
          </button>
        </div>
        <div className="gcal-day-subhead">
          <span className="gcal-day-weekday">{formatHeaderWeekdayJa(viewDate)}</span>
          <span className={`gcal-day-num${isToday ? " gcal-day-num--today" : ""}`} aria-current={isToday ? "date" : undefined}>
            {dayNum}
          </span>
        </div>
      </header>

      <div className="gcal-day-scroll" ref={scrollRef}>
        <div className="gcal-day-grid" style={{ height: gridHeightPx }}>
          <div className="gcal-day-rail" aria-hidden="true">
            {ticks.map((min) => (
              <div
                key={min}
                className="gcal-day-hour-label"
                style={{ top: minutesToTopPx(min, axis, GCAL_HOUR_HEIGHT_PX) }}
              >
                {formatAxisTimeLabel(min)}
              </div>
            ))}
          </div>

          <div className="gcal-day-canvas">
            {ticks.map((min) => (
              <div
                key={`line-${min}`}
                className="gcal-day-hour-line"
                style={{ top: minutesToTopPx(min, axis, GCAL_HOUR_HEIGHT_PX) }}
              />
            ))}

            {nowTopPx != null ? (
              <div className="gcal-day-now" style={{ top: nowTopPx }} aria-hidden="true">
                <span className="gcal-day-now-dot" />
                <span className="gcal-day-now-line" />
              </div>
            ) : null}

            <div
              ref={trackRef}
              className="gcal-day-events"
              style={{ height: gridHeightPx }}
            >
              {reservations.map((rv) => {
                const rect = layout.get(rv.id);
                if (!rect) return null;
                const { startMin, endMin } = getMinutes(rv);
                const colKey = rv.driverEmployeeId ?? SCHEDULE_UNASSIGNED_DRIVER_ID;
                const colors = colorForColumnKey(colKey);
                const driverName = rv.driverEmployeeId
                  ? driverNameById.get(rv.driverEmployeeId) ?? ""
                  : "未予定";
                const title = (rv.detail.customerName || rv.title || "予定").trim();
                const route = [rv.detail.pickup, rv.detail.dropoff].filter(Boolean).join(" → ");

                return (
                  <button
                    key={rv.id}
                    type="button"
                    className="gcal-day-event"
                    style={{
                      top: rect.topPx,
                      height: rect.heightPx,
                      left: `calc(${rect.leftPct}% + 2px)`,
                      width: `calc(${rect.widthPct}% - 4px)`,
                      backgroundColor: colors.bg,
                      borderColor: colors.border,
                      color: colors.text,
                    }}
                    title={`${title} ${route}`}
                    onPointerDown={(e) => {
                      const track = trackRef.current;
                      if (track) onEventPointerDown(e, rv, track);
                    }}
                  >
                    <span className="gcal-day-event-title">{title}</span>
                    {rect.heightPx >= 36 ? (
                      <span className="gcal-day-event-meta">{formatEventTimeRange(startMin, endMin)}</span>
                    ) : null}
                    {rect.heightPx >= 52 && driverName ? (
                      <span className="gcal-day-event-meta">{driverName}</span>
                    ) : null}
                    {rect.heightPx >= 68 && route ? (
                      <span className="gcal-day-event-route">{route}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <button type="button" className="gcal-day-fab" onClick={onFabClick} aria-label="予定を追加">
        +
      </button>
    </div>
  );
}

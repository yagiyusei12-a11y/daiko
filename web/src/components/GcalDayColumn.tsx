import { useMemo, useRef } from "react";
import type { DriverColor } from "../lib/schedule-driver-colors";
import { colorForDriver } from "../lib/schedule-driver-colors";
import { formatReservationCustomer, formatReservationRoute } from "../lib/schedule-display";
import {
  GCAL_HOUR_HEIGHT_PX,
  layoutTimedEvents,
  minutesToTopPx,
  type ScheduleAxis,
} from "../lib/schedule-day-layout";
import type { GcalReservation } from "./GcalScheduleView";

type Props = {
  dayYmd: string;
  axis: ScheduleAxis;
  reservations: GcalReservation[];
  driverColorMap: Map<string, DriverColor>;
  getMinutes: (rv: GcalReservation, dayYmd: string) => { startMin: number; endMin: number };
  onEventPointerDown: (
    e: React.PointerEvent,
    rv: GcalReservation,
    track: HTMLDivElement,
    dayYmd: string,
  ) => void;
  showNowLine?: boolean;
  gridHeightPx: number;
  compact?: boolean;
};

export default function GcalDayColumn({
  dayYmd,
  axis,
  reservations,
  driverColorMap,
  getMinutes,
  onEventPointerDown,
  showNowLine = false,
  gridHeightPx,
  compact = false,
}: Props): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null);

  const timedEvents = useMemo(
    () =>
      reservations.map((rv) => {
        const { startMin, endMin } = getMinutes(rv, dayYmd);
        return { id: rv.id, startMin, endMin };
      }),
    [reservations, getMinutes, dayYmd],
  );

  const layout = useMemo(() => layoutTimedEvents(timedEvents, axis, GCAL_HOUR_HEIGHT_PX), [timedEvents, axis]);

  const nowTopPx = useMemo(() => {
    if (!showNowLine) return null;
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
  }, [showNowLine, axis]);

  return (
    <div
      className={`gcal-day-events${compact ? " gcal-day-events--compact" : ""}`}
      style={{ height: gridHeightPx }}
      ref={trackRef}
      data-day-ymd={dayYmd}
    >
      {nowTopPx != null ? (
        <div className="gcal-day-now gcal-day-now--column" style={{ top: nowTopPx }} aria-hidden="true">
          <span className="gcal-day-now-dot" />
          <span className="gcal-day-now-line" />
        </div>
      ) : null}
      {reservations.map((rv) => {
        const rect = layout.get(rv.id);
        if (!rect) return null;
        const colors = colorForDriver(rv.driverEmployeeId, driverColorMap);
        const customer = formatReservationCustomer(rv.detail, rv.title);
        const route = formatReservationRoute(rv.detail);

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
            title={`${customer} ${route}`}
            onPointerDown={(e) => {
              const track = trackRef.current;
              if (track) onEventPointerDown(e, rv, track, dayYmd);
            }}
          >
            <span className="gcal-day-event-title">{customer}</span>
            {route ? <span className="gcal-day-event-route">{route}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

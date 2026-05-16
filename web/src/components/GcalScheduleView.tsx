import { useEffect, useMemo, useRef } from "react";
import { currentBusinessYmd } from "../auth";
import GcalDayColumn from "./GcalDayColumn";
import type { DriverColor } from "../lib/schedule-driver-colors";
import { SCHEDULE_UNASSIGNED_DRIVER_ID } from "../lib/schedule-constants";
import {
  GCAL_HOUR_HEIGHT_PX,
  axisGridHeightPx,
  formatAxisTimeLabel,
  gcalScrollViewportMaxPx,
  hourTicks,
  minutesToTopPx,
  type ScheduleAxis,
} from "../lib/schedule-day-layout";
import { formatWeekRangeJa, shiftYmd, weekDatesContaining } from "../lib/schedule-week";

export type GcalReservation = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  driverEmployeeId: string | null;
  detail: {
    customerName: string;
    pickup: string;
    viaStops: string[];
    dropoff: string;
  };
};

type DriverRow = { employeeId: string; name: string };

export type CalendarViewMode = "day" | "week";

type Props = {
  viewMode: CalendarViewMode;
  onViewModeChange: (mode: CalendarViewMode) => void;
  viewDate: string;
  axis: ScheduleAxis;
  /** 日表示: その日の予定。週表示: 日付キーごとの予定 */
  reservationsByDate: Record<string, GcalReservation[]>;
  drivers: DriverRow[];
  driverColorMap: Map<string, DriverColor>;
  dayChangeHour: number;
  getMinutes: (rv: GcalReservation, dayYmd: string) => { startMin: number; endMin: number };
  onEventPointerDown: (
    e: React.PointerEvent,
    rv: GcalReservation,
    track: HTMLDivElement,
    dayYmd: string,
  ) => void;
  onFabClick: () => void;
  onPrev: () => void;
  onNext: () => void;
  onPickDate: (ymd: string) => void;
  onSelectDay?: (ymd: string) => void;
};

function formatHeaderMonthJa(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat("ja-JP", { month: "long", timeZone: "Asia/Tokyo" }).format(dt);
}

function formatHeaderWeekdayJa(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat("ja-JP", { weekday: "short", timeZone: "Asia/Tokyo" }).format(dt);
}

function TimeGrid({
  axis,
  gridHeightPx,
  ticks,
  children,
}: {
  axis: ScheduleAxis;
  gridHeightPx: number;
  ticks: number[];
  children: React.ReactNode;
}): JSX.Element {
  return (
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
        {children}
      </div>
    </div>
  );
}

export default function GcalScheduleView({
  viewMode,
  onViewModeChange,
  viewDate,
  axis,
  reservationsByDate,
  drivers,
  driverColorMap,
  dayChangeHour,
  getMinutes,
  onEventPointerDown,
  onFabClick,
  onPrev,
  onNext,
  onPickDate,
  onSelectDay,
}: Props): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const weekDates = useMemo(() => weekDatesContaining(viewDate), [viewDate]);
  const todayYmd = currentBusinessYmd(dayChangeHour);
  const gridHeightPx = axisGridHeightPx(axis, GCAL_HOUR_HEIGHT_PX);
  const scrollMaxPx = gcalScrollViewportMaxPx();
  const ticks = hourTicks(axis);

  const dayReservations = reservationsByDate[viewDate] ?? [];

  const nowTopPx = useMemo(() => {
    if (viewMode !== "day" || viewDate !== todayYmd) return null;
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
  }, [viewMode, viewDate, todayYmd, axis]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || nowTopPx == null) return;
    el.scrollTop = Math.max(0, nowTopPx - el.clientHeight * 0.25);
  }, [viewDate, nowTopPx, viewMode]);

  const headerTitle = viewMode === "week" ? formatWeekRangeJa(weekDates) : formatHeaderMonthJa(viewDate);
  const dayNum = Number(viewDate.split("-")[2]) || 1;

  return (
    <div
      className="gcal-day"
      style={{ ["--gcal-scroll-max-height" as string]: `${scrollMaxPx}px` }}
    >
      <header className="gcal-day-header">
        <div className="gcal-day-header-row">
          <button type="button" className="gcal-day-nav" onClick={onPrev} aria-label={viewMode === "week" ? "前の週" : "前の日"}>
            ‹
          </button>
          <div className="gcal-day-header-center">
            <label className="gcal-day-month">
              <span className="gcal-day-month-label">{headerTitle}</span>
              <input
                type="date"
                className="gcal-day-date-input"
                value={viewDate}
                onChange={(e) => onPickDate(e.target.value)}
                aria-label="表示日を選択"
              />
            </label>
          </div>
          <button type="button" className="gcal-day-nav" onClick={onNext} aria-label={viewMode === "week" ? "次の週" : "次の日"}>
            ›
          </button>
        </div>

        <div className="gcal-day-header-tools">
          <div className="gcal-view-toggle" role="group" aria-label="表示切替">
            <button
              type="button"
              className={viewMode === "day" ? "gcal-view-toggle-btn is-active" : "gcal-view-toggle-btn"}
              onClick={() => onViewModeChange("day")}
            >
              日
            </button>
            <button
              type="button"
              className={viewMode === "week" ? "gcal-view-toggle-btn is-active" : "gcal-view-toggle-btn"}
              onClick={() => onViewModeChange("week")}
            >
              週
            </button>
          </div>

          {drivers.length > 0 ? (
            <ul className="gcal-driver-legend" aria-label="担当者の色">
              {drivers
                .filter((d) => d.employeeId !== SCHEDULE_UNASSIGNED_DRIVER_ID)
                .slice(0, 8)
                .map((d) => {
                  const c = driverColorMap.get(d.employeeId);
                  if (!c) return null;
                  return (
                    <li key={d.employeeId}>
                      <span className="gcal-driver-swatch" style={{ background: c.bg, borderColor: c.border }} />
                      {d.name}
                    </li>
                  );
                })}
            </ul>
          ) : null}
        </div>

        {viewMode === "day" ? (
          <div className="gcal-day-subhead">
            <span className="gcal-day-weekday">{formatHeaderWeekdayJa(viewDate)}</span>
            <span
              className={`gcal-day-num${viewDate === todayYmd ? " gcal-day-num--today" : ""}`}
              aria-current={viewDate === todayYmd ? "date" : undefined}
            >
              {dayNum}
            </span>
          </div>
        ) : null}
      </header>

      <div className={`gcal-day-scroll${viewMode === "week" ? " gcal-day-scroll--week" : ""}`} ref={scrollRef}>
        {viewMode === "day" ? (
          <TimeGrid axis={axis} gridHeightPx={gridHeightPx} ticks={ticks}>
            {nowTopPx != null ? (
              <div className="gcal-day-now" style={{ top: nowTopPx }} aria-hidden="true">
                <span className="gcal-day-now-dot" />
                <span className="gcal-day-now-line" />
              </div>
            ) : null}
            <GcalDayColumn
              dayYmd={viewDate}
              axis={axis}
              reservations={dayReservations}
              driverColorMap={driverColorMap}
              getMinutes={getMinutes}
              onEventPointerDown={onEventPointerDown}
              gridHeightPx={gridHeightPx}
            />
          </TimeGrid>
        ) : (
          <div className="gcal-week">
            <div className="gcal-week-head">
              <div className="gcal-week-head-spacer" />
              {weekDates.map((ymd) => {
                const d = Number(ymd.split("-")[2]);
                const isToday = ymd === todayYmd;
                return (
                  <button
                    key={ymd}
                    type="button"
                    className={`gcal-week-head-cell${isToday ? " gcal-week-head-cell--today" : ""}`}
                    onClick={() => onSelectDay?.(ymd)}
                    title="日表示に切り替え"
                  >
                    <span className="gcal-week-head-dow">{formatHeaderWeekdayJa(ymd)}</span>
                    <span className="gcal-week-head-num">{d}</span>
                  </button>
                );
              })}
            </div>
            <div className="gcal-week-body">
              <TimeGrid axis={axis} gridHeightPx={gridHeightPx} ticks={ticks}>
                <div className="gcal-week-cols">
                  {weekDates.map((ymd) => (
                    <div key={ymd} className="gcal-week-col">
                      <GcalDayColumn
                        dayYmd={ymd}
                        axis={axis}
                        reservations={reservationsByDate[ymd] ?? []}
                        driverColorMap={driverColorMap}
                        getMinutes={getMinutes}
                        onEventPointerDown={onEventPointerDown}
                        showNowLine={ymd === todayYmd}
                        gridHeightPx={gridHeightPx}
                        compact
                      />
                    </div>
                  ))}
                </div>
              </TimeGrid>
            </div>
          </div>
        )}
      </div>

      <button type="button" className="gcal-day-fab" onClick={onFabClick} aria-label="予定を追加">
        +
      </button>
    </div>
  );
}

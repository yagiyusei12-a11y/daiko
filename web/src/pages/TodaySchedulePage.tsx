import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../api";
import { useAuth, currentBusinessYmd, formatFlexDatetime } from "../auth";
import {
  SCHEDULE_UNASSIGNED_DRIVER_ID,
  scheduleDbUnassignedToDriverColumnKey,
  parseScheduleUnassignedLaneEmployeeId,
} from "../lib/schedule-constants";
import { useSavedToast } from "../saved-toast";
import GcalScheduleView, { type CalendarViewMode } from "../components/GcalScheduleView";
import { computeScheduleAxis, minutesSinceTokyoDay, tokyoMidnightUtcMs } from "../lib/schedule-axis";
import { buildDriverColorMap } from "../lib/schedule-driver-colors";
import { shiftYmd, weekDatesContaining } from "../lib/schedule-week";
import { Card, Err } from "../ui";

const FLEX_HM = /^(\d{1,2}):(\d{2})$/;

function flexHmToMinutes(s: string): number {
  const m = FLEX_HM.exec(s.trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

function formatUtcAsTokyoDatetimeLocal(d: Date): string {
  const datePart = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const timePart = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${datePart}T${timePart}`;
}

function formatHmFromDayMinutes(ymd: string, iso: string): string {
  const m = minutesSinceTokyoDay(ymd, iso);
  const neg = m < 0;
  const abs = Math.abs(m);
  const h = Math.floor(abs / 60);
  const min = abs % 60;
  const core = `${h}:${String(min).padStart(2, "0")}`;
  return neg ? `−${core}` : core;
}

function snap15(n: number): number {
  return Math.round(n / 15) * 15;
}

type BusinessHourSlot = { id: string; open: string; close: string };

type DriverRow = { employeeId: string; name: string; startTime: string; endTime: string };

type ReservationRow = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  driverEmployeeId: string | null;
  virtualLane: number | null;
  vehicleId: string | null;
  detail: {
    customerName: string;
    phone: string;
    pickup: string;
    viaStops: string[];
    dropoff: string;
    vehicleNumber: string;
    parking: string;
  };
};

type SchedulePayload = {
  date: string;
  businessHours: BusinessHourSlot[];
  availabilityMode: string;
  effectiveVirtualSlots: number;
  drivers: DriverRow[];
  reservations: ReservationRow[];
};

type OnlineBookingForSchedule = {
  durationOptions: number[];
  reservationTiming: {
    defaultTripEstimateMinutes: number;
    blockedTimeMode: string;
    blockedTimeMultiply: number;
    blockedTimeAddMinutes: number;
    availabilityMode: string;
    virtualConcurrentSlots: number;
  };
};

const FALLBACK_DURATION_OPTIONS = Array.from({ length: 32 }, (_, i) => (i + 1) * 15);

function reservationColumnKey(rv: ReservationRow, availabilityMode: string): string {
  if (rv.driverEmployeeId) return rv.driverEmployeeId;
  if (availabilityMode === "virtual_concurrent") {
    return scheduleDbUnassignedToDriverColumnKey(rv.virtualLane);
  }
  return SCHEDULE_UNASSIGNED_DRIVER_ID;
}

type DragMode = "move" | "resize-l" | "resize-r";

type DragCtx = {
  pointerId: number;
  rv: ReservationRow;
  kind: DragMode;
  transpose: boolean;
  spanPx: number;
  axisSpanMin: number;
  originClient: number;
  startMin: number;
  endMin: number;
  last: { a: number; b: number };
  originDriverId: string;
  targetDriverId: string;
  dayYmd: string;
};

function isUnassignedDriverId(id: string): boolean {
  return id === SCHEDULE_UNASSIGNED_DRIVER_ID || parseScheduleUnassignedLaneEmployeeId(id) !== null;
}

export default function TodaySchedulePage(): JSX.Element {
  const { flashSaved } = useSavedToast();
  const { me } = useAuth();
  const [viewDate, setViewDate] = useState(() => currentBusinessYmd(me?.dayChangeHour ?? 28));
  const [calendarViewMode, setCalendarViewMode] = useState<CalendarViewMode>("day");
  const [data, setData] = useState<SchedulePayload | null>(null);
  const [weekByDate, setWeekByDate] = useState<Record<string, SchedulePayload>>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [startLocal, setStartLocal] = useState("");
  const [pickup, setPickup] = useState("");
  const [viaStops, setViaStops] = useState<string[]>([""]);
  const [dropoff, setDropoff] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [parking, setParking] = useState("");
  const [scheduleDurationOptions, setScheduleDurationOptions] = useState<number[]>(FALLBACK_DURATION_OPTIONS);
  const [bookingDefaultEstimate, setBookingDefaultEstimate] = useState(60);
  const [tripEstimateMinutes, setTripEstimateMinutes] = useState(60);
  const [detailRv, setDetailRv] = useState<ReservationRow | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [mStartLocal, setMStartLocal] = useState("");
  const [mDuration, setMDuration] = useState(60);
  const [mDriver, setMDriver] = useState("");
  const [mCustomerName, setMCustomerName] = useState("");
  const [mPhone, setMPhone] = useState("");
  const [mPickup, setMPickup] = useState("");
  const [mVia, setMVia] = useState<string[]>([""]);
  const [mDropoff, setMDropoff] = useState("");
  const [mVehicleNumber, setMVehicleNumber] = useState("");
  const [mParking, setMParking] = useState("");

  const [dragPreview, setDragPreview] = useState<Record<string, { a: number; b: number }>>({});
  const [dragTargetDriverId, setDragTargetDriverId] = useState<string | null>(null);
  const dragRef = useRef<DragCtx | null>(null);
  const dragMovedRef = useRef(false);

  const weekDates = useMemo(() => weekDatesContaining(viewDate), [viewDate]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    if (calendarViewMode === "week") {
      const pairs = await Promise.all(
        weekDates.map(async (d) => {
          const r = await apiFetch<SchedulePayload>(`/dispatch/schedule?date=${encodeURIComponent(d)}`);
          return { d, r };
        }),
      );
      setLoading(false);
      const next: Record<string, SchedulePayload> = {};
      for (const { d, r } of pairs) {
        if (!r.ok) {
          setErr(r.error);
          setWeekByDate({});
          setData(null);
          return;
        }
        next[d] = r.data;
      }
      setWeekByDate(next);
      setData(next[viewDate] ?? pairs[0]?.r.data ?? null);
      return;
    }
    const r = await apiFetch<SchedulePayload>(`/dispatch/schedule?date=${encodeURIComponent(viewDate)}`);
    setLoading(false);
    if (!r.ok) {
      setErr(r.error);
      setData(null);
      return;
    }
    setData(r.data);
  }, [viewDate, calendarViewMode, weekDates]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      const r = await apiFetch<OnlineBookingForSchedule>("/settings/online-booking");
      if (!r.ok) return;
      const opts = r.data.durationOptions?.length ? r.data.durationOptions : FALLBACK_DURATION_OPTIONS;
      setScheduleDurationOptions(opts);
      const def = r.data.reservationTiming?.defaultTripEstimateMinutes ?? 60;
      const next = opts.includes(def) ? def : opts[0] ?? 60;
      setBookingDefaultEstimate(next);
      setTripEstimateMinutes(next);
    })();
  }, []);

  useEffect(() => {
    setTripEstimateMinutes((prev) =>
      scheduleDurationOptions.includes(prev) ? prev : scheduleDurationOptions[0] ?? 60,
    );
  }, [scheduleDurationOptions]);

  const scheduleAxis = useMemo(() => {
    const businessHours: BusinessHourSlot[] = [];
    const reservations: Array<ReservationRow & { viewYmd: string }> = [];
    if (calendarViewMode === "day") {
      if (data) {
        businessHours.push(...data.businessHours);
        for (const rv of data.reservations) {
          reservations.push({ ...rv, viewYmd: viewDate });
        }
      }
    } else {
      for (const d of weekDates) {
        const p = weekByDate[d];
        if (!p) continue;
        businessHours.push(...p.businessHours);
        for (const rv of p.reservations) {
          reservations.push({ ...rv, viewYmd: d });
        }
      }
    }
    return computeScheduleAxis(businessHours, reservations, me?.dayChangeHour ?? 28);
  }, [calendarViewMode, data, weekByDate, weekDates, viewDate, me?.dayChangeHour]);

  const reservationsByDate = useMemo(() => {
    if (calendarViewMode === "day") {
      return { [viewDate]: data?.reservations ?? [] };
    }
    const out: Record<string, ReservationRow[]> = {};
    for (const d of weekDates) {
      out[d] = weekByDate[d]?.reservations ?? [];
    }
    return out;
  }, [calendarViewMode, data, weekByDate, weekDates, viewDate]);

  const driverColorMap = useMemo(() => {
    const seen = new Set<string>();
    const ids: string[] = [];
    const rows =
      calendarViewMode === "day"
        ? (data?.drivers ?? [])
        : weekDates.flatMap((d) => weekByDate[d]?.drivers ?? []);
    for (const row of rows) {
      if (seen.has(row.employeeId)) continue;
      seen.add(row.employeeId);
      ids.push(row.employeeId);
    }
    return buildDriverColorMap(ids);
  }, [calendarViewMode, data, weekByDate, weekDates]);

  const availabilityMode = data?.availabilityMode ?? "confirmed_shifts";

  const onlyUnassignedDriverColumn = useMemo(() => {
    const ds = data?.drivers;
    return Boolean(
      ds &&
        ds.length === 1 &&
        ds[0].employeeId === SCHEDULE_UNASSIGNED_DRIVER_ID &&
        availabilityMode !== "virtual_concurrent",
    );
  }, [data?.drivers, availabilityMode]);

  const shiftDriverCount = useMemo(() => {
    return (data?.drivers ?? []).filter(
      (d) =>
        d.employeeId !== SCHEDULE_UNASSIGNED_DRIVER_ID &&
        parseScheduleUnassignedLaneEmployeeId(d.employeeId) === null,
    ).length;
  }, [data?.drivers]);

  const scheduleConcurrentLimit = useMemo(() => {
    if (shiftDriverCount > 0) return shiftDriverCount;
    return data?.effectiveVirtualSlots ?? 0;
  }, [shiftDriverCount, data?.effectiveVirtualSlots]);

  function openDialog(): void {
    setCustomerName("");
    setPhone("");
    setPickup("");
    setViaStops([""]);
    setDropoff("");
    setVehicleNumber("");
    setParking("");
    setTripEstimateMinutes(bookingDefaultEstimate);
    const nowRounded = new Date(Math.round(Date.now() / (15 * 60 * 1000)) * (15 * 60 * 1000));
    setStartLocal(formatUtcAsTokyoDatetimeLocal(nowRounded));
    setDialogOpen(true);
    setErr(null);
  }

  function openDetail(rv: ReservationRow): void {
    setDetailRv(rv);
    setMStartLocal(formatUtcAsTokyoDatetimeLocal(new Date(rv.startsAt)));
    const dur = Math.round((new Date(rv.endsAt).getTime() - new Date(rv.startsAt).getTime()) / 60000);
    setMDuration(scheduleDurationOptions.includes(dur) ? dur : scheduleDurationOptions[0] ?? dur);
    const dKey = reservationColumnKey(rv, availabilityMode);
    const matchDriver = data?.drivers.some((d) => d.employeeId === dKey) ? dKey : data?.drivers[0]?.employeeId ?? "";
    setMDriver(matchDriver);
    setMCustomerName(rv.detail.customerName);
    setMPhone(rv.detail.phone);
    setMPickup(rv.detail.pickup);
    setMVia(rv.detail.viaStops?.length ? [...rv.detail.viaStops] : [""]);
    setMDropoff(rv.detail.dropoff);
    setMVehicleNumber(rv.detail.vehicleNumber);
    setMParking(rv.detail.parking);
    setErr(null);
  }

  async function submitReservation(): Promise<void> {
    setSubmitBusy(true);
    setErr(null);
    const via = viaStops.map((s) => s.trim()).filter(Boolean);
    const r = await apiFetch("/dispatch/reservations", {
      method: "POST",
      json: {
        startLocal,
        tripEstimateMinutes,
        detail: {
          customerName: customerName.trim(),
          phone: phone.trim(),
          pickup: pickup.trim(),
          viaStops: via,
          dropoff: dropoff.trim(),
          vehicleNumber: vehicleNumber.trim(),
          parking: parking.trim(),
        },
      },
    });
    setSubmitBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    flashSaved();
    setDialogOpen(false);
    void load();
  }

  async function saveDetailModal(): Promise<void> {
    if (!detailRv) return;
    setDetailBusy(true);
    setErr(null);
    const via = mVia.map((s) => s.trim()).filter(Boolean);
    const r = await apiFetch(`/dispatch/reservations/${encodeURIComponent(detailRv.id)}`, {
      method: "PATCH",
      json: {
        startLocal: mStartLocal,
        durationMinutes: mDuration,
        driverEmployeeId: mDriver,
        detail: {
          customerName: mCustomerName.trim(),
          phone: mPhone.trim(),
          pickup: mPickup.trim(),
          viaStops: via,
          dropoff: mDropoff.trim(),
          vehicleNumber: mVehicleNumber.trim(),
          parking: mParking.trim(),
        },
      },
    });
    setDetailBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    flashSaved();
    setDetailRv(null);
    void load();
  }

  async function cancelReservation(): Promise<void> {
    if (!detailRv) return;
    if (!window.confirm(`「${detailRv.customerName || "この予定"}」をキャンセルしますか？`)) return;
    setDetailBusy(true);
    setErr(null);
    const r = await apiFetch(`/dispatch/reservations/${encodeURIComponent(detailRv.id)}`, { method: "DELETE" });
    setDetailBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    flashSaved();
    setDetailRv(null);
    void load();
  }

  const durationSelectOptions = useMemo(() => {
    const s = new Set(scheduleDurationOptions);
    if (detailRv) {
      const cur = Math.round(
        (new Date(detailRv.endsAt).getTime() - new Date(detailRv.startsAt).getTime()) / 60000,
      );
      if (Number.isFinite(cur) && cur > 0) s.add(cur);
    }
    return [...s].sort((a, b) => a - b);
  }, [scheduleDurationOptions, detailRv]);

  function effectiveMinutes(rv: ReservationRow, dayYmd: string): { a: number; b: number } {
    const pr = dragPreview[rv.id];
    if (pr) return pr;
    return {
      a: minutesSinceTokyoDay(dayYmd, rv.startsAt),
      b: minutesSinceTokyoDay(dayYmd, rv.endsAt),
    };
  }

  function beginDrag(
    e: React.PointerEvent,
    rv: ReservationRow,
    track: HTMLDivElement,
    transpose: boolean,
    dayYmd: string,
  ): void {
    if (e.button !== 0) return;
    const rect = track.getBoundingClientRect();
    const spanPx = transpose ? rect.height : rect.width;
    if (spanPx <= 0) return;
    const axisSpanMin = scheduleAxis.mx - scheduleAxis.mn;
    const a0 = minutesSinceTokyoDay(dayYmd, rv.startsAt);
    const b0 = minutesSinceTokyoDay(dayYmd, rv.endsAt);
    const client = transpose ? e.clientY : e.clientX;
    const edge = 10;
    const pos = transpose ? e.clientY - rect.top : e.clientX - rect.left;
    let kind: DragMode = "move";
    if (pos < edge) kind = "resize-l";
    else if (pos > spanPx - edge) kind = "resize-r";
    dragMovedRef.current = false;
    const originDriverId = reservationColumnKey(rv, availabilityMode);
    dragRef.current = {
      pointerId: e.pointerId,
      rv,
      kind,
      transpose,
      spanPx,
      axisSpanMin,
      originClient: client,
      startMin: a0,
      endMin: b0,
      last: { a: a0, b: b0 },
      originDriverId,
      targetDriverId: originDriverId,
      dayYmd,
    };

    function onMove(ev: PointerEvent): void {
      const d = dragRef.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      const cur = d.transpose ? ev.clientY : ev.clientX;
      const deltaPx = cur - d.originClient;
      if (Math.abs(deltaPx) > 2) dragMovedRef.current = true;
      const deltaMin = (deltaPx / d.spanPx) * d.axisSpanMin;
      let a = d.startMin;
      let b = d.endMin;
      if (d.kind === "move") {
        const sh = snap15(deltaMin);
        a = snap15(d.startMin + sh);
        b = snap15(d.endMin + sh);
        // cross-row detection: only for unassigned rows
        if (isUnassignedDriverId(d.originDriverId)) {
          const els = document.elementsFromPoint(ev.clientX, ev.clientY);
          let foundRow = false;
          for (const el of els) {
            const tid = (el as HTMLElement).dataset?.driverId;
            if (tid !== undefined) {
              foundRow = true;
              const newTarget = isUnassignedDriverId(tid) ? tid : d.originDriverId;
              if (newTarget !== d.targetDriverId) {
                d.targetDriverId = newTarget;
                setDragTargetDriverId(newTarget !== d.originDriverId ? newTarget : null);
              }
              break;
            }
          }
          if (!foundRow && d.targetDriverId !== d.originDriverId) {
            d.targetDriverId = d.originDriverId;
            setDragTargetDriverId(null);
          }
        }
      } else if (d.kind === "resize-l") {
        a = snap15(d.startMin + deltaMin);
        if (a >= b - 15) a = b - 15;
      } else {
        b = snap15(d.endMin + deltaMin);
        if (b <= a + 15) b = a + 15;
      }
      d.last = { a, b };
      setDragPreview((prev) => ({ ...prev, [d.rv.id]: { a, b } }));
    }

    function onUp(ev: PointerEvent): void {
      const d = dragRef.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      dragRef.current = null;
      const fin = d.last;
      const moved = dragMovedRef.current;
      setDragPreview((prev) => {
        const next = { ...prev };
        delete next[d.rv.id];
        return next;
      });
      setDragTargetDriverId(null);
      if (!moved) {
        openDetail(d.rv);
        return;
      }
      const origA = minutesSinceTokyoDay(d.dayYmd, d.rv.startsAt);
      const origB = minutesSinceTokyoDay(d.dayYmd, d.rv.endsAt);
      const timeChanged = fin.a !== origA || fin.b !== origB;
      const rowChanged = d.targetDriverId !== d.originDriverId;
      if (!timeChanged && !rowChanged) return;
      const base = tokyoMidnightUtcMs(d.dayYmd);
      const startIso = new Date(base + fin.a * 60000).toISOString();
      void (async () => {
        const startLocalStr = formatUtcAsTokyoDatetimeLocal(new Date(startIso));
        const dur = fin.b - fin.a;
        const patchBody: Record<string, unknown> = {
          startLocal: startLocalStr,
          durationMinutes: dur,
        };
        if (rowChanged) {
          patchBody.driverEmployeeId = d.targetDriverId;
        }
        const r = await apiFetch(`/dispatch/reservations/${encodeURIComponent(d.rv.id)}`, {
          method: "PATCH",
          json: patchBody,
        });
        if (!r.ok) {
          setErr(r.error);
          void load();
          return;
        }
        flashSaved();
        void load();
      })();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    e.preventDefault();
  }

  const activeDrivers = useMemo(() => {
    const rows =
      calendarViewMode === "day"
        ? (data?.drivers ?? [])
        : weekDates.flatMap((d) => weekByDate[d]?.drivers ?? []);
    const seen = new Set<string>();
    return rows.filter((d) => {
      if (seen.has(d.employeeId)) return false;
      seen.add(d.employeeId);
      return true;
    });
  }, [calendarViewMode, data?.drivers, weekByDate, weekDates]);

  return (
    <div className="schedule-gcal-page">
    <Card title="運行スケジュール">
      <Err msg={err} />

      {loading ? (
        <p className="settings-hint">読み込み中…</p>
      ) : data || calendarViewMode === "week" ? (
        <>
          {onlyUnassignedDriverColumn ? (
            <p className="settings-hint gcal-schedule-hint">
              この日は客車の確定シフトがありません。「未予定」を選ぶと、担当者を決める前に運行予定だけ登録できます。
            </p>
          ) : null}
          {scheduleConcurrentLimit > 1 ? (
            <p className="settings-hint gcal-schedule-hint">
              この日の同時上限は {scheduleConcurrentLimit} 件です。未予定は複数列で重ならない範囲に並びます。
              {shiftDriverCount > 0 ? "（確定シフトの客車担当者数）" : "（設定マスタの同時予約上限）"}
            </p>
          ) : null}
          <GcalScheduleView
            viewMode={calendarViewMode}
            onViewModeChange={setCalendarViewMode}
            viewDate={viewDate}
            axis={scheduleAxis}
            reservationsByDate={reservationsByDate}
            drivers={activeDrivers}
            driverColorMap={driverColorMap}
            dayChangeHour={me?.dayChangeHour ?? 28}
            getMinutes={(rv, dayYmd) => {
              const { a, b } = effectiveMinutes(rv, dayYmd);
              return { startMin: a, endMin: b };
            }}
            onEventPointerDown={(e, rv, track, dayYmd) => beginDrag(e, rv, track, true, dayYmd)}
            onFabClick={() => openDialog()}
            onPrev={() => setViewDate((d) => shiftYmd(d, calendarViewMode === "week" ? -7 : -1))}
            onNext={() => setViewDate((d) => shiftYmd(d, calendarViewMode === "week" ? 7 : 1))}
            onPickDate={setViewDate}
            onSelectDay={(ymd) => {
              setViewDate(ymd);
              setCalendarViewMode("day");
            }}
          />
        </>
      ) : null}

      
      {dialogOpen ? (
        <div
          className="pricing-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDialogOpen(false);
          }}
        >
          <div
            className="pricing-modal attend-shift-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sched-res-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="sched-res-title" className="pricing-modal-title">
              運行予定を登録
            </h2>
            <div className="attend-shift-dialog-scroll">
              <div className="settings-form">
                <label htmlFor="sr-customer">客名</label>
                <input id="sr-customer" type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
                <label htmlFor="sr-phone">電話番号</label>
                <input id="sr-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
                <label htmlFor="sr-start">日時（開始）</label>
                <input id="sr-start" type="datetime-local" step="900" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} />
                {startLocal ? (
                  <span className="settings-hint" style={{ marginTop: "-0.5rem" }}>
                    事業日換算: {formatFlexDatetime(new Date(startLocal).toISOString(), viewDate, me?.dayChangeHour ?? 28)}
                  </span>
                ) : null}
                <label htmlFor="sr-pickup">迎え先</label>
                <input id="sr-pickup" type="text" value={pickup} onChange={(e) => setPickup(e.target.value)} />
                <label>経由地（行を追加できます）</label>
                {viaStops.map((v, idx) => (
                  <div key={idx} className="settings-toolbar" style={{ gap: "0.35rem" }}>
                    <input
                      type="text"
                      style={{ flex: 1, minWidth: 0 }}
                      value={v}
                      onChange={(e) =>
                        setViaStops((prev) => prev.map((x, i) => (i === idx ? e.target.value : x)))
                      }
                      placeholder={`経由 ${idx + 1}`}
                    />
                    <button
                      type="button"
                      className="settings-secondary"
                      onClick={() => setViaStops((prev) => prev.filter((_, i) => i !== idx))}
                      disabled={viaStops.length <= 1}
                    >
                      削除
                    </button>
                  </div>
                ))}
                <button type="button" className="settings-secondary" onClick={() => setViaStops((prev) => [...prev, ""])}>
                  経由地を追加
                </button>
                <label htmlFor="sr-drop">送り先</label>
                <input id="sr-drop" type="text" value={dropoff} onChange={(e) => setDropoff(e.target.value)} />
                <label htmlFor="sr-vno">車のナンバー</label>
                <input id="sr-vno" type="text" value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} />
                <label htmlFor="sr-park">駐車場</label>
                <input id="sr-park" type="text" value={parking} onChange={(e) => setParking(e.target.value)} />
                <label htmlFor="sr-dur">送り先までの目安（15分刻み・最長8時間）</label>
                <select
                  id="sr-dur"
                  value={tripEstimateMinutes}
                  onChange={(e) => setTripEstimateMinutes(Number(e.target.value))}
                >
                  {scheduleDurationOptions.map((m) => (
                    <option key={m} value={m}>
                      {m} 分
                    </option>
                  ))}
                </select>
                <p className="settings-hint" style={{ marginTop: 4 }}>
                  スケジュール上の実車ブロックは「ネット予約」設定の式（掛け算／加算）で算出されます。客車担当者は未予定で登録されます。
                </p>
              </div>
            </div>
            <div className="pricing-modal-actions">
              <button type="button" className="settings-primary" disabled={submitBusy} onClick={() => void submitReservation()}>
                保存
              </button>
              <button type="button" onClick={() => setDialogOpen(false)}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {detailRv ? (
        <div
          className="pricing-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDetailRv(null);
          }}
        >
          <div
            className="pricing-modal attend-shift-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sched-det-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="sched-det-title" className="pricing-modal-title">
              運行予定
            </h2>
            <div className="attend-shift-dialog-scroll">
              <div className="settings-form">
                <label htmlFor="sd-start">日時（開始）</label>
                <input id="sd-start" type="datetime-local" step="900" value={mStartLocal} onChange={(e) => setMStartLocal(e.target.value)} />
                {mStartLocal ? (
                  <span className="settings-hint" style={{ marginTop: "-0.5rem" }}>
                    事業日換算: {formatFlexDatetime(new Date(mStartLocal).toISOString(), viewDate, me?.dayChangeHour ?? 28)}
                  </span>
                ) : null}
                <label htmlFor="sd-dur">ブロック時間（分・15分刻み）</label>
                <select id="sd-dur" value={mDuration} onChange={(e) => setMDuration(Number(e.target.value))}>
                  {durationSelectOptions.map((m) => (
                    <option key={m} value={m}>
                      {m} 分
                    </option>
                  ))}
                </select>
                <label htmlFor="sd-driver">客車担当</label>
                <select id="sd-driver" value={mDriver} onChange={(e) => setMDriver(e.target.value)}>
                  {(data?.drivers ?? []).map((d) => (
                    <option key={d.employeeId} value={d.employeeId}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <label htmlFor="sd-cust">客名</label>
                <input id="sd-cust" type="text" value={mCustomerName} onChange={(e) => setMCustomerName(e.target.value)} />
                <label htmlFor="sd-phone">電話</label>
                <input id="sd-phone" type="tel" value={mPhone} onChange={(e) => setMPhone(e.target.value)} />
                <label htmlFor="sd-pu">迎え先</label>
                <input id="sd-pu" type="text" value={mPickup} onChange={(e) => setMPickup(e.target.value)} />
                <label>経由</label>
                {mVia.map((v, idx) => (
                  <div key={idx} className="settings-toolbar" style={{ gap: "0.35rem" }}>
                    <input
                      type="text"
                      style={{ flex: 1, minWidth: 0 }}
                      value={v}
                      onChange={(e) => setMVia((prev) => prev.map((x, i) => (i === idx ? e.target.value : x)))}
                    />
                    <button
                      type="button"
                      className="settings-secondary"
                      onClick={() => setMVia((prev) => prev.filter((_, i) => i !== idx))}
                      disabled={mVia.length <= 1}
                    >
                      削除
                    </button>
                  </div>
                ))}
                <button type="button" className="settings-secondary" onClick={() => setMVia((prev) => [...prev, ""])}>
                  経由を追加
                </button>
                <label htmlFor="sd-do">送り先</label>
                <input id="sd-do" type="text" value={mDropoff} onChange={(e) => setMDropoff(e.target.value)} />
                <label htmlFor="sd-vno">車のナンバー</label>
                <input id="sd-vno" type="text" value={mVehicleNumber} onChange={(e) => setMVehicleNumber(e.target.value)} />
                <label htmlFor="sd-park">駐車場</label>
                <input id="sd-park" type="text" value={mParking} onChange={(e) => setMParking(e.target.value)} />
              </div>
            </div>
            <div className="pricing-modal-actions">
              <button type="button" className="settings-primary" disabled={detailBusy} onClick={() => void saveDetailModal()}>
                保存
              </button>
              <button type="button" disabled={detailBusy} onClick={() => setDetailRv(null)}>
                閉じる
              </button>
              <button
                type="button"
                className="settings-danger"
                disabled={detailBusy}
                style={{ marginLeft: "auto" }}
                onClick={() => void cancelReservation()}
              >
                予定をキャンセル
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
    </div>
  );
}

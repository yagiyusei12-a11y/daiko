import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../api";
import { useAuth, currentBusinessYmd } from "../auth";
import {
  SCHEDULE_UNASSIGNED_DRIVER_ID,
  scheduleDbUnassignedToDriverColumnKey,
  parseScheduleUnassignedLaneEmployeeId,
} from "../lib/schedule-constants";
import { useSavedToast } from "../saved-toast";
import { useDeviceKind } from "../hooks/useDeviceKind";
import { Card, Err } from "../ui";

const FLEX_HM = /^(\d{1,2}):(\d{2})$/;

function flexHmToMinutes(s: string): number {
  const m = FLEX_HM.exec(s.trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

function scheduleBarPercentages(
  startMin: number,
  endMin: number,
  axis: { mn: number; mx: number },
): { startPct: number; sizePct: number } {
  const span = axis.mx - axis.mn;
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || span <= 0) return { startPct: 0, sizePct: 0 };
  const lo = Math.min(startMin, endMin);
  const hi = Math.max(startMin, endMin);
  const clipLo = Math.max(axis.mn, lo);
  const clipHi = Math.min(axis.mx, hi);
  if (clipHi <= clipLo) return { startPct: 0, sizePct: 0 };
  const startPct = ((clipLo - axis.mn) / span) * 100;
  const sizePct = Math.max(0.35, ((clipHi - clipLo) / span) * 100);
  return { startPct, sizePct: Math.min(sizePct, 100 - startPct) };
}


function tokyoMidnightUtcMs(ymd: string): number {
  const [y, mo, d] = ymd.split("-").map(Number);
  return Date.UTC(y, mo - 1, d, -9, 0, 0, 0);
}

function minutesSinceTokyoDay(ymd: string, iso: string): number {
  return Math.floor((new Date(iso).getTime() - tokyoMidnightUtcMs(ymd)) / 60000);
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

function formatDayTitleJa(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat("ja-JP", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  }).format(dt);
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
};

function isUnassignedDriverId(id: string): boolean {
  return id === SCHEDULE_UNASSIGNED_DRIVER_ID || parseScheduleUnassignedLaneEmployeeId(id) !== null;
}

export default function TodaySchedulePage(): JSX.Element {
  const { flashSaved } = useSavedToast();
  const { me } = useAuth();
  const deviceKind = useDeviceKind();
  const [viewDate, setViewDate] = useState(() => currentBusinessYmd(me?.dayChangeHour ?? 28));
  const [data, setData] = useState<SchedulePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [vehicles, setVehicles] = useState<Array<{ id: string; label: string }>>([]);

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
  const [driverEmployeeId, setDriverEmployeeId] = useState("");
  const [vehicleId, setVehicleId] = useState("");

  const [detailRv, setDetailRv] = useState<ReservationRow | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [mStartLocal, setMStartLocal] = useState("");
  const [mDuration, setMDuration] = useState(60);
  const [mDriver, setMDriver] = useState("");
  const [mVehicleId, setMVehicleId] = useState("");
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

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const r = await apiFetch<SchedulePayload>(`/dispatch/schedule?date=${encodeURIComponent(viewDate)}`);
    setLoading(false);
    if (!r.ok) {
      setErr(r.error);
      setData(null);
      return;
    }
    setData(r.data);
  }, [viewDate]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      const r = await apiFetch<{ vehicles: Array<{ id: string; label: string }> }>("/settings/vehicles");
      if (r.ok) setVehicles(r.data.vehicles ?? []);
    })();
  }, []);

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
    let mn = Number.POSITIVE_INFINITY;
    let mx = Number.NEGATIVE_INFINITY;
    const slots = data?.businessHours ?? [];
    for (const s of slots) {
      const a = flexHmToMinutes(s.open);
      const b = flexHmToMinutes(s.close);
      if (!Number.isNaN(a)) mn = Math.min(mn, a);
      if (!Number.isNaN(b)) mx = Math.max(mx, b);
    }
    if (!Number.isFinite(mn) || !Number.isFinite(mx) || mx <= mn) {
      mn = 7 * 60;
      mx = 22 * 60;
    }
    const step = 15;
    const slotCount = Math.max(1, Math.ceil((mx - mn) / step));
    return { mn, mx, slotCount, step };
  }, [data?.businessHours]);

  const scheduleTranspose = deviceKind === "phone";
  const scheduleSlotPx = 11;
  const scheduleHeadPx = 36;
  const scheduleGridPx = scheduleAxis.slotCount * scheduleSlotPx;

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

  function openDialog(): void {
    setCustomerName("");
    setPhone("");
    setPickup("");
    setViaStops([""]);
    setDropoff("");
    setVehicleNumber("");
    setParking("");
    setTripEstimateMinutes(bookingDefaultEstimate);
    setVehicleId("");
    const nowRounded = new Date(Math.round(Date.now() / (15 * 60 * 1000)) * (15 * 60 * 1000));
    setStartLocal(formatUtcAsTokyoDatetimeLocal(nowRounded));
    const first = data?.drivers[0]?.employeeId ?? "";
    setDriverEmployeeId(first);
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
    setMVehicleId(rv.vehicleId ?? "");
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
        driverEmployeeId,
        vehicleId: vehicleId || null,
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
        vehicleId: mVehicleId || null,
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

  const reservationsByDriver = useMemo(() => {
    const m = new Map<string, ReservationRow[]>();
    for (const row of data?.reservations ?? []) {
      const id = reservationColumnKey(row, availabilityMode);
      const arr = m.get(id) ?? [];
      arr.push(row);
      m.set(id, arr);
    }
    return m;
  }, [data?.reservations, availabilityMode]);

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

  function effectiveMinutes(rv: ReservationRow): { a: number; b: number } {
    const pr = dragPreview[rv.id];
    if (pr) return pr;
    return {
      a: minutesSinceTokyoDay(viewDate, rv.startsAt),
      b: minutesSinceTokyoDay(viewDate, rv.endsAt),
    };
  }

  function beginDrag(
    e: React.PointerEvent,
    rv: ReservationRow,
    track: HTMLDivElement,
    transpose: boolean,
  ): void {
    if (e.button !== 0) return;
    const rect = track.getBoundingClientRect();
    const spanPx = transpose ? rect.height : rect.width;
    if (spanPx <= 0) return;
    const axisSpanMin = scheduleAxis.mx - scheduleAxis.mn;
    const a0 = minutesSinceTokyoDay(viewDate, rv.startsAt);
    const b0 = minutesSinceTokyoDay(viewDate, rv.endsAt);
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
      const origA = minutesSinceTokyoDay(viewDate, d.rv.startsAt);
      const origB = minutesSinceTokyoDay(viewDate, d.rv.endsAt);
      const timeChanged = fin.a !== origA || fin.b !== origB;
      const rowChanged = d.targetDriverId !== d.originDriverId;
      if (!timeChanged && !rowChanged) return;
      const base = tokyoMidnightUtcMs(viewDate);
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

  function barLabel(rv: ReservationRow): string {
    const hm = formatHmFromDayMinutes(viewDate, rv.startsAt);
    const p = (rv.detail.pickup || "").trim();
    const head = p.length > 18 ? `${p.slice(0, 17)}…` : p;
    return `${head} ${hm}`.trim();
  }

  return (
    <Card title="運行スケジュール">
      <p style={{ margin: "0 0 0.75rem", fontSize: "0.95rem", color: "var(--color-muted)" }}>{formatDayTitleJa(viewDate)}</p>

      <div className="settings-toolbar" style={{ flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
        <label htmlFor="sched-view-date" className="settings-hint" style={{ margin: 0 }}>
          表示日
        </label>
        <input
          id="sched-view-date"
          type="date"
          value={viewDate}
          onChange={(e) => setViewDate(e.target.value)}
        />
        <button type="button" className="settings-primary" disabled={loading || !data} onClick={() => openDialog()}>
          予定登録
        </button>
      </div>

      <Err msg={err} />

      {loading ? (
        <p className="settings-hint">読み込み中…</p>
      ) : data ? (
        <>
          {onlyUnassignedDriverColumn ? (
            <p className="settings-hint" style={{ marginBottom: "0.75rem" }}>
              この日は客車の確定シフトがありません。「未予定」を選ぶと、担当者を決める前に運行予定だけ登録できます。
            </p>
          ) : null}
          {availabilityMode === "virtual_concurrent" && data.drivers.length > 1 ? (
            <p className="settings-hint" style={{ marginBottom: "0.75rem" }}>
              この日の同時上限は {data.effectiveVirtualSlots} 件です。未予定は複数列で重ならない範囲に並びます。
            </p>
          ) : null}
          {scheduleTranspose ? (
            <div className="attend-schedule-wrap attend-schedule-wrap--transpose">
              <div className="attend-schedule-transpose-inner">
                <div className="attend-schedule-time-rail" style={{ width: "2.35rem", flexShrink: 0 }}>
                  <div className="attend-schedule-corner" style={{ minHeight: scheduleHeadPx, boxSizing: "border-box" }} />
                  <div style={{ height: scheduleGridPx, position: "relative", borderTop: "1px solid var(--color-border)" }}>
                    {Array.from({ length: scheduleAxis.slotCount }, (_, i) => {
                      const t = scheduleAxis.mn + i * scheduleAxis.step;
                      const h = Math.floor(t / 60);
                      const m = t % 60;
                      const show = m === 0;
                      return (
                        <div
                          key={i}
                          className={`attend-schedule-tick-slot${show ? " attend-schedule-tick-slot--hour" : ""}`}
                          style={{
                            position: "absolute",
                            left: 0,
                            width: "100%",
                            top: `${(i / scheduleAxis.slotCount) * 100}%`,
                            height: `${100 / scheduleAxis.slotCount}%`,
                            boxSizing: "border-box",
                            borderBottom: "1px solid color-mix(in srgb, var(--color-border) 55%, transparent)",
                            fontSize: "0.62rem",
                            color: "var(--color-muted)",
                            textAlign: "right",
                            paddingRight: 2,
                            lineHeight: 1,
                          }}
                        >
                          {show ? `${h}` : ""}
                        </div>
                      );
                    })}
                  </div>
                </div>
                {data.drivers.map((row) => {
                  const resList = reservationsByDriver.get(row.employeeId) ?? [];
                  return (
                    <div
                      key={row.employeeId}
                      className="attend-schedule-driver-col"
                      style={{ width: "4.75rem", flexShrink: 0, borderLeft: "1px solid var(--color-border)" }}
                    >
                      <div
                        className="attend-schedule-col-head"
                        style={{
                          minHeight: scheduleHeadPx,
                          maxHeight: scheduleHeadPx,
                          boxSizing: "border-box",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          textAlign: "center",
                          padding: "0.2rem",
                          fontSize: "0.78rem",
                          fontWeight: 600,
                          borderBottom: "1px solid var(--color-border)",
                        }}
                      >
                        {row.name}
                      </div>
                      <div
                        className="attend-schedule-track"
                        style={{ height: scheduleGridPx, position: "relative", background: "var(--color-surface)" }}
                      >
                        {resList.map((rv) => {
                          const { a, b } = effectiveMinutes(rv);
                          const bar = scheduleBarPercentages(a, b, scheduleAxis);
                          const label = barLabel(rv);
                          return (
                            <button
                              key={rv.id}
                              type="button"
                              className="attend-schedule-bar attend-schedule-bar--transpose attend-schedule-bar--reservation"
                              style={{
                                top: `${bar.startPct}%`,
                                height: `${bar.sizePct}%`,
                                border: "none",
                                padding: 0,
                                cursor: "grab",
                                overflow: "hidden",
                                fontSize: "0.55rem",
                                color: "#fff",
                                lineHeight: 1.1,
                                textAlign: "center",
                              }}
                              title={`${rv.detail.customerName} ${rv.detail.pickup}→${rv.detail.dropoff}`}
                              onPointerDown={(e) => {
                                const track = e.currentTarget.parentElement as HTMLDivElement;
                                beginDrag(e, rv, track, true);
                              }}
                            >
                              <span style={{ pointerEvents: "none", display: "block", padding: "0 1px" }}>{label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="attend-schedule-wrap">
              <div className="attend-schedule-axis">
                <div className="attend-schedule-corner" />
                <div
                  className="attend-schedule-ticks"
                  style={{ gridTemplateColumns: `repeat(${scheduleAxis.slotCount}, minmax(0, 1fr))` }}
                >
                  {Array.from({ length: scheduleAxis.slotCount }, (_, i) => {
                    const t = scheduleAxis.mn + i * scheduleAxis.step;
                    const h = Math.floor(t / 60);
                    const m = t % 60;
                    const show = m === 0;
                    return (
                      <span key={i} className={`attend-schedule-tick${show ? " attend-schedule-tick--hour" : ""}`}>
                        {show ? `${h}` : ""}
                      </span>
                    );
                  })}
                </div>
              </div>
              {data.drivers.map((row) => {
                const resList = reservationsByDriver.get(row.employeeId) ?? [];
                const isTargetRow = dragTargetDriverId === row.employeeId;
                const ghostRv = isTargetRow
                  ? (() => {
                      const d = dragRef.current;
                      if (!d) return null;
                      const pr = dragPreview[d.rv.id] ?? { a: minutesSinceTokyoDay(viewDate, d.rv.startsAt), b: minutesSinceTokyoDay(viewDate, d.rv.endsAt) };
                      return { rv: d.rv, a: pr.a, b: pr.b };
                    })()
                  : null;
                return (
                  <div
                    key={row.employeeId}
                    className={`attend-schedule-row${isTargetRow ? " attend-schedule-row--drag-target" : ""}`}
                    data-driver-id={row.employeeId}
                  >
                    <div className="attend-schedule-name">{row.name}</div>
                    <div className="attend-schedule-track" data-driver-id={row.employeeId}>
                      {resList.map((rv) => {
                        const { a, b } = effectiveMinutes(rv);
                        const bar = scheduleBarPercentages(a, b, scheduleAxis);
                        const label = barLabel(rv);
                        const isCrossRowDragging = dragTargetDriverId !== null && dragRef.current?.rv.id === rv.id;
                        return (
                          <button
                            key={rv.id}
                            type="button"
                            className="attend-schedule-bar attend-schedule-bar--reservation"
                            style={{
                              left: `${bar.startPct}%`,
                              width: `${bar.sizePct}%`,
                              border: "none",
                              padding: "0 2px",
                              cursor: "grab",
                              overflow: "hidden",
                              fontSize: "0.58rem",
                              color: "#fff",
                              whiteSpace: "nowrap",
                              textOverflow: "ellipsis",
                              opacity: isCrossRowDragging ? 0.35 : 1,
                            }}
                            title={`${rv.detail.customerName} ${rv.detail.pickup}→${rv.detail.dropoff}`}
                            onPointerDown={(e) => {
                              const track = e.currentTarget.parentElement as HTMLDivElement;
                              beginDrag(e, rv, track, false);
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                      {ghostRv ? (() => {
                        const bar = scheduleBarPercentages(ghostRv.a, ghostRv.b, scheduleAxis);
                        return (
                          <div
                            key="drag-ghost"
                            className="attend-schedule-bar attend-schedule-bar--reservation attend-schedule-bar--ghost"
                            style={{
                              left: `${bar.startPct}%`,
                              width: `${bar.sizePct}%`,
                              pointerEvents: "none",
                            }}
                          >
                            {barLabel(ghostRv.rv)}
                          </div>
                        );
                      })() : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : null}

      <p className="settings-hint" style={{ marginTop: "0.75rem" }}>
        横軸は設定の営業時間（曜日別・特定日を含む）に合わせた15分刻みです。表示は運行予定のみです（確定シフトの帯は表示しません）。
      </p>

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
                  スケジュール上の実車ブロックは「ネット予約」設定の式（掛け算／加算）で算出されます。
                </p>
                <label htmlFor="sr-driver">
                  客車担当者（この日のシフト）
                  {onlyUnassignedDriverColumn ? (
                    <span style={{ fontWeight: 400, color: "var(--color-muted)" }}> — 未確定時は「未予定」</span>
                  ) : null}
                </label>
                <select id="sr-driver" value={driverEmployeeId} onChange={(e) => setDriverEmployeeId(e.target.value)}>
                  <option value="">選択してください</option>
                  {(data?.drivers ?? []).map((d) => (
                    <option key={d.employeeId} value={d.employeeId}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <label htmlFor="sr-veh">随伴車（任意・マスタ連携）</label>
                <select id="sr-veh" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                  <option value="">なし</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
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
                <label htmlFor="sd-veh">随伴車</label>
                <select id="sd-veh" value={mVehicleId} onChange={(e) => setMVehicleId(e.target.value)}>
                  <option value="">なし</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
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
              <button type="button" onClick={() => setDetailRv(null)}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

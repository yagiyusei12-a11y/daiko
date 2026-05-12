import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
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

function tokyoTodayYmd(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date()).slice(0, 10);
}

function tokyoMidnightUtcMs(ymd: string): number {
  const [y, mo, d] = ymd.split("-").map(Number);
  return Date.UTC(y, mo - 1, d, -9, 0, 0, 0);
}

function minutesSinceTokyoDay(ymd: string, iso: string): number {
  return Math.floor((new Date(iso).getTime() - tokyoMidnightUtcMs(ymd)) / 60000);
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
  drivers: DriverRow[];
  reservations: ReservationRow[];
};

const DURATION_OPTIONS = Array.from({ length: 32 }, (_, i) => (i + 1) * 15);

export default function TodaySchedulePage(): JSX.Element {
  const { flashSaved } = useSavedToast();
  const deviceKind = useDeviceKind();
  const [viewDate, setViewDate] = useState(tokyoTodayYmd);
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
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [driverEmployeeId, setDriverEmployeeId] = useState("");
  const [vehicleId, setVehicleId] = useState("");

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

  function openDialog(): void {
    setCustomerName("");
    setPhone("");
    setPickup("");
    setViaStops([""]);
    setDropoff("");
    setVehicleNumber("");
    setParking("");
    setDurationMinutes(60);
    setVehicleId("");
    setStartLocal(`${viewDate}T10:00`);
    const first = data?.drivers[0]?.employeeId ?? "";
    setDriverEmployeeId(first);
    setDialogOpen(true);
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
        durationMinutes,
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

  const reservationsByDriver = useMemo(() => {
    const m = new Map<string, ReservationRow[]>();
    for (const row of data?.reservations ?? []) {
      const id = row.driverEmployeeId ?? "";
      if (!id) continue;
      const arr = m.get(id) ?? [];
      arr.push(row);
      m.set(id, arr);
    }
    return m;
  }, [data?.reservations]);

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
        <button type="button" className="settings-primary" disabled={!data?.drivers.length} onClick={() => openDialog()}>
          予定登録
        </button>
      </div>

      <Err msg={err} />

      {loading ? (
        <p className="settings-hint">読み込み中…</p>
      ) : !data?.drivers.length ? (
        <p className="settings-hint">
          この日に「客車」の確定シフトがある従業員がいません。勤怠の「シフト調整」で客車を付けた担当者がここに並び、予定を登録できます。
        </p>
      ) : scheduleTranspose ? (
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
                  <div style={{ height: scheduleGridPx, position: "relative", background: "var(--color-surface)" }}>
                    {resList.map((rv) => {
                      const a = minutesSinceTokyoDay(viewDate, rv.startsAt);
                      const b = minutesSinceTokyoDay(viewDate, rv.endsAt);
                      const bar = scheduleBarPercentages(a, b, scheduleAxis);
                      return (
                        <div
                          key={rv.id}
                          className="attend-schedule-bar attend-schedule-bar--transpose attend-schedule-bar--reservation"
                          style={{ top: `${bar.startPct}%`, height: `${bar.sizePct}%` }}
                          title={`${rv.detail.customerName} ${rv.detail.pickup}→${rv.detail.dropoff}`}
                        />
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
            <div className="attend-schedule-ticks" style={{ gridTemplateColumns: `repeat(${scheduleAxis.slotCount}, minmax(0, 1fr))` }}>
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
            return (
              <div key={row.employeeId} className="attend-schedule-row">
                <div className="attend-schedule-name">{row.name}</div>
                <div className="attend-schedule-track">
                  {resList.map((rv) => {
                    const a = minutesSinceTokyoDay(viewDate, rv.startsAt);
                    const b = minutesSinceTokyoDay(viewDate, rv.endsAt);
                    const bar = scheduleBarPercentages(a, b, scheduleAxis);
                    return (
                      <div
                        key={rv.id}
                        className="attend-schedule-bar attend-schedule-bar--reservation"
                        style={{ left: `${bar.startPct}%`, width: `${bar.sizePct}%` }}
                        title={`${rv.detail.customerName} ${rv.detail.pickup}→${rv.detail.dropoff}`}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

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
                <input id="sr-start" type="datetime-local" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} />
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
                <label htmlFor="sr-dur">予定実車時間（15分刻み・最長8時間）</label>
                <select id="sr-dur" value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))}>
                  {DURATION_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m} 分
                    </option>
                  ))}
                </select>
                <label htmlFor="sr-driver">客車担当者（この日のシフト）</label>
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
    </Card>
  );
}

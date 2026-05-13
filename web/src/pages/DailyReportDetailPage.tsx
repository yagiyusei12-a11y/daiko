import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch, apiFetchText } from "../api";
import { Card, Err } from "../ui";
import { useSavedToast } from "../saved-toast";
import { reverseGeocodeTownJa } from "../lib/nominatim";

type EmpMini = { id: string; familyName: string; givenName: string };
type VehMini = { id: string; label: string; plate: string | null };

type TripLegFull = {
  id: string;
  clientName: string;
  charterVehicleNo: string | null;
  origin: string;
  destination: string;
  viaNote: string | null;
  viaStopsJson: unknown;
  departedAt: string;
  arrivedAt: string;
  distanceM: number;
  fareYen: number;
  parkingAdvanceYen: number;
  tripMeterStartM: number | null;
  tripMeterEndM: number | null;
  tariffVersionId: string | null;
  applyLeftHandSurchargeFlat: boolean;
  applyNightSurcharge: boolean;
  applyNightSurchargeFlat: boolean;
  applyLeftHandSurcharge: boolean;
  applyEarlyMorningFlatYen: boolean;
  applyLateNightFlatYen: boolean;
  applyEarlyRushFlatYen: boolean;
  legSurchargesJson: unknown;
};

type ReportDetail = {
  id: string;
  businessDate: string;
  meterStart: number;
  meterEnd: number;
  vehicleId: string | null;
  mainEmployeeId: string;
  partnerEmployeeId: string | null;
  escortVehicleId: string | null;
  escortOdometerStartM: number | null;
  escortOdometerEndM: number | null;
  trips: TripLegFull[];
  vehicle: VehMini | null;
  escortVehicle: VehMini | null;
  mainEmployee: EmpMini;
  partnerEmployee: EmpMini | null;
};

type TariffOpt = {
  id: string;
  label: string;
  planId: string;
  version: number;
  nightSurchargeBps: number;
  nightSurchargeFlatYen: number;
  leftHandSurchargeBps: number;
  earlyMorningFlatYen: number;
  lateNightFlatYen: number;
  earlyRushFlatYen: number;
};
type Defaults = { pickupYen: number; leftHandYen: number; foreignCarYen: number; cancelYen: number };

/** 配車スケジュールから運行フォームへ渡すプリフィル（token で再適用を区別） */
type SchedulePrefillPayload = {
  token: number;
  customerName: string;
  pickup: string;
  dropoff: string;
  viaStops: string[];
  vehicleNumber: string;
  departedIso: string;
  arrivedIso: string;
};

type ScheduleReservationRow = {
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

type SchedulePayloadMini = { date: string; reservations: ScheduleReservationRow[] };

function formatScheduleRowLabel(row: ScheduleReservationRow): string {
  const t0 = new Date(row.startsAt);
  const t1 = new Date(row.endsAt);
  const hm = (d: Date) =>
    Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  const route = [row.detail.pickup, row.detail.dropoff].filter(Boolean).join("→");
  return `${hm(t0)}–${hm(t1)} ${row.title}${route ? `（${route}）` : ""}`;
}

function viaStopsFromTrip(trip: TripLegFull): string[] {
  const raw = trip.viaStopsJson;
  if (Array.isArray(raw)) {
    const xs = raw.filter((x): x is string => typeof x === "string").map((s) => s.trim());
    const filtered = xs.filter(Boolean);
    if (filtered.length > 0) return filtered;
  }
  if (trip.viaNote) {
    return trip.viaNote.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  return [""];
}

function toDatetimeLocalValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** DB の tripMeter*M / distanceM はメートル整数。UI は km。 */
function tripMeterKmFromM(m: number | null | undefined): number {
  if (m == null) return 0;
  return m / 1000;
}

function kmToTripMeters(km: number): number {
  return Math.max(0, Math.round(km * 1000));
}

function formatKm(k: number): string {
  if (!Number.isFinite(k)) return "—";
  const s = k.toFixed(2).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return s;
}

function formatTripStartDisplay(departedIso: string): string {
  const d = new Date(departedIso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function viaSummaryFromTrip(trip: TripLegFull): string {
  const v = viaStopsFromTrip(trip).filter(Boolean);
  if (v.length === 0) return "—";
  return v.join(" · ");
}

function travelMinutesBetween(depLocal: string, arrLocal: string): number | null {
  const a = new Date(depLocal);
  const b = new Date(arrLocal);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const diffMin = (b.getTime() - a.getTime()) / 60_000;
  if (!Number.isFinite(diffMin)) return null;
  return Math.max(0, Math.round(diffMin));
}

function readSlot(j: unknown, key: string): { apply: boolean; yen: number } {
  const root = j && typeof j === "object" ? (j as Record<string, unknown>) : {};
  const o = root[key];
  if (!o || typeof o !== "object") return { apply: false, yen: 0 };
  const s = o as Record<string, unknown>;
  return { apply: Boolean(s.apply), yen: Math.max(0, Math.floor(Number(s.yen) || 0)) };
}

function NumRow({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <>
      <label>{label}</label>
      <input type="number" min={0} disabled={disabled} value={value} onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
    </>
  );
}

function GpsTownButton({
  label,
  onTown,
  disabled,
}: {
  label: string;
  onTown: (town: string) => void;
  disabled?: boolean;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(): Promise<void> {
    setErr(null);
    setBusy(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 18000 });
      });
      const town = await reverseGeocodeTownJa(pos.coords.latitude, pos.coords.longitude);
      if (!town) setErr("住所文字列を取得できませんでした");
      else onTown(town);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "位置情報を取得できませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-toolbar" style={{ marginTop: "0.15rem", flexWrap: "wrap" }}>
      <button type="button" className="settings-secondary" disabled={disabled || busy} onClick={() => void run()}>
        {busy ? "取得中…" : label}
      </button>
      {err ? <span className="settings-hint" style={{ color: "var(--color-accent)" }}>{err}</span> : null}
    </div>
  );
}

function TripWizard({
  reportId,
  trip,
  tariffVersions,
  defaults,
  features,
  onSubmitted,
  sectionTitle = "運行",
  schedulePrefill,
}: {
  reportId: string;
  trip: TripLegFull;
  tariffVersions: TariffOpt[];
  defaults: Defaults;
  features: string[];
  onSubmitted: () => void | Promise<void>;
  sectionTitle?: string;
  schedulePrefill?: SchedulePrefillPayload | null;
}): JSX.Element {
  const { flashSaved } = useSavedToast();
  const j0 = trip.legSurchargesJson;
  const [clientName, setClientName] = useState(trip.clientName);
  const [charterVehicleNo, setCharterVehicleNo] = useState(trip.charterVehicleNo ?? "");
  const [origin, setOrigin] = useState(trip.origin);
  const [viaStops, setViaStops] = useState(() => viaStopsFromTrip(trip));
  const [destination, setDestination] = useState(trip.destination);
  const [fareYen, setFareYen] = useState(trip.fareYen);
  const [parkingAdvanceYen, setParkingAdvanceYen] = useState(trip.parkingAdvanceYen ?? 0);
  const [tripStartKm, setTripStartKm] = useState(() => tripMeterKmFromM(trip.tripMeterStartM));
  const [tripEndKm, setTripEndKm] = useState(() => tripMeterKmFromM(trip.tripMeterEndM));
  const [departedLocal, setDepartedLocal] = useState(() => toDatetimeLocalValue(new Date(trip.departedAt)));
  const [arrivedLocal, setArrivedLocal] = useState(() => toDatetimeLocalValue(new Date(trip.arrivedAt)));
  const [tariffVersionId, setTariffVersionId] = useState(trip.tariffVersionId ?? "");
  const [pickup, setPickup] = useState(() => readSlot(j0, "pickup"));
  const [leftHand, setLeftHand] = useState(() => readSlot(j0, "leftHand"));
  const [foreignCar, setForeignCar] = useState(() => readSlot(j0, "foreignCar"));
  const [cancel, setCancel] = useState(() => readSlot(j0, "cancel"));
  const [applyNightSurcharge, setApplyNightSurcharge] = useState(trip.applyNightSurcharge);
  const [applyNightSurchargeFlat, setApplyNightSurchargeFlat] = useState(trip.applyNightSurchargeFlat);
  const [applyLeftHandSurcharge, setApplyLeftHandSurcharge] = useState(trip.applyLeftHandSurcharge);
  const [applyEarlyMorningFlatYen, setApplyEarlyMorningFlatYen] = useState(trip.applyEarlyMorningFlatYen);
  const [applyLateNightFlatYen, setApplyLateNightFlatYen] = useState(trip.applyLateNightFlatYen);
  const [applyEarlyRushFlatYen, setApplyEarlyRushFlatYen] = useState(trip.applyEarlyRushFlatYen);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setClientName(trip.clientName);
    setCharterVehicleNo(trip.charterVehicleNo ?? "");
    setOrigin(trip.origin);
    setViaStops(viaStopsFromTrip(trip));
    setDestination(trip.destination);
    setFareYen(trip.fareYen);
    setParkingAdvanceYen(trip.parkingAdvanceYen ?? 0);
    setTripStartKm(tripMeterKmFromM(trip.tripMeterStartM));
    setTripEndKm(tripMeterKmFromM(trip.tripMeterEndM));
    setDepartedLocal(toDatetimeLocalValue(new Date(trip.departedAt)));
    setArrivedLocal(toDatetimeLocalValue(new Date(trip.arrivedAt)));
    setTariffVersionId(trip.tariffVersionId ?? "");
    setPickup(readSlot(trip.legSurchargesJson, "pickup"));
    setLeftHand(readSlot(trip.legSurchargesJson, "leftHand"));
    setForeignCar(readSlot(trip.legSurchargesJson, "foreignCar"));
    setCancel(readSlot(trip.legSurchargesJson, "cancel"));
    setApplyNightSurcharge(trip.applyNightSurcharge);
    setApplyNightSurchargeFlat(trip.applyNightSurchargeFlat);
    setApplyLeftHandSurcharge(trip.applyLeftHandSurcharge);
    setApplyEarlyMorningFlatYen(trip.applyEarlyMorningFlatYen);
    setApplyLateNightFlatYen(trip.applyLateNightFlatYen);
    setApplyEarlyRushFlatYen(trip.applyEarlyRushFlatYen);
  }, [trip]);

  useEffect(() => {
    if (!schedulePrefill) return;
    setClientName(schedulePrefill.customerName);
    setOrigin(schedulePrefill.pickup);
    setDestination(schedulePrefill.dropoff);
    const vs = schedulePrefill.viaStops.map((s) => s.trim()).filter(Boolean);
    setViaStops(vs.length > 0 ? vs : [""]);
    setCharterVehicleNo(schedulePrefill.vehicleNumber);
    setDepartedLocal(toDatetimeLocalValue(new Date(schedulePrefill.departedIso)));
    setArrivedLocal(toDatetimeLocalValue(new Date(schedulePrefill.arrivedIso)));
  }, [schedulePrefill]);

  const distanceKmAuto = useMemo(() => Math.max(0, tripEndKm - tripStartKm), [tripEndKm, tripStartKm]);
  const travelMinutesAuto = useMemo(() => travelMinutesBetween(departedLocal, arrivedLocal), [departedLocal, arrivedLocal]);

  const tariffCap = useMemo(() => tariffVersions.find((t) => t.id === tariffVersionId), [tariffVersions, tariffVersionId]);
  const showNightPct = (tariffCap?.nightSurchargeBps ?? 0) > 0;
  const showNightFlat = (tariffCap?.nightSurchargeFlatYen ?? 0) > 0;
  const showLeftHandPct = (tariffCap?.leftHandSurchargeBps ?? 0) > 0;
  const showEarlyMorningFlat = (tariffCap?.earlyMorningFlatYen ?? 0) > 0;
  const showLateNightFlat = (tariffCap?.lateNightFlatYen ?? 0) > 0;
  const showEarlyRushFlat = (tariffCap?.earlyRushFlatYen ?? 0) > 0;

  const hasPrefsLegRows =
    features.includes("pickup") ||
    features.includes("leftHand") ||
    features.includes("foreignCar") ||
    features.includes("cancel");
  const hasTariffFlagRows =
    showNightPct || showNightFlat || showLeftHandPct || showEarlyMorningFlat || showLateNightFlat || showEarlyRushFlat;
  const showSurchargeDetails = hasPrefsLegRows || hasTariffFlagRows;

  function toggle(
    cur: { apply: boolean; yen: number },
    set: (v: { apply: boolean; yen: number }) => void,
    defYen: number,
    nextApply: boolean,
  ): void {
    if (nextApply) set({ apply: true, yen: cur.yen > 0 ? cur.yen : defYen });
    else set({ apply: false, yen: cur.yen });
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setErr(null);
    const departedAt = new Date(departedLocal);
    const arrivedAt = new Date(arrivedLocal);
    if (Number.isNaN(departedAt.getTime()) || Number.isNaN(arrivedAt.getTime())) {
      setErr("開始・終了の日時が不正です");
      setBusy(false);
      return;
    }
    const legSurchargesJson = {
      pickup: { apply: features.includes("pickup") ? pickup.apply : false, yen: features.includes("pickup") ? pickup.yen : 0 },
      leftHand: { apply: features.includes("leftHand") ? leftHand.apply : false, yen: features.includes("leftHand") ? leftHand.yen : 0 },
      foreignCar: { apply: features.includes("foreignCar") ? foreignCar.apply : false, yen: features.includes("foreignCar") ? foreignCar.yen : 0 },
      cancel: { apply: features.includes("cancel") ? cancel.apply : false, yen: features.includes("cancel") ? cancel.yen : 0 },
    };
    const viaFiltered = viaStops.map((s) => s.trim()).filter(Boolean);
    const startM = kmToTripMeters(tripStartKm);
    const endM = kmToTripMeters(tripEndKm);
    const distM = Math.max(0, endM - startM);
    const r = await apiFetch(`/daily-reports/${reportId}/trips/${trip.id}`, {
      method: "PATCH",
      json: {
        clientName,
        charterVehicleNo: charterVehicleNo.trim() || null,
        origin,
        destination,
        viaStopsJson: viaFiltered,
        fareYen,
        parkingAdvanceYen,
        tripMeterStartM: startM > 0 ? startM : null,
        tripMeterEndM: endM > 0 ? endM : null,
        distanceM: distM,
        departedAt: departedAt.toISOString(),
        arrivedAt: arrivedAt.toISOString(),
        tariffVersionId: tariffVersionId.trim() || null,
        applyNightSurcharge: showNightPct ? applyNightSurcharge : false,
        applyNightSurchargeFlat: showNightFlat ? applyNightSurchargeFlat : false,
        applyLeftHandSurcharge: showLeftHandPct ? applyLeftHandSurcharge : false,
        applyEarlyMorningFlatYen: showEarlyMorningFlat ? applyEarlyMorningFlatYen : false,
        applyLateNightFlatYen: showLateNightFlat ? applyLateNightFlatYen : false,
        applyEarlyRushFlatYen: showEarlyRushFlat ? applyEarlyRushFlatYen : false,
        legSurchargesJson,
      },
    });
    setBusy(false);
    if (!r.ok) setErr(r.error);
    else {
      flashSaved();
      await Promise.resolve(onSubmitted());
    }
  }

  return (
    <section className="settings-section-panel trip-editor" style={{ marginBottom: "1rem" }}>
      <h3 className="settings-subtitle" style={{ marginTop: 0 }}>
        {sectionTitle}
      </h3>
      <Err msg={err} />
      <div className="settings-form">
        <label>依頼者名</label>
        <input value={clientName} onChange={(e) => setClientName(e.target.value)} />
        <label>客車の車両番号</label>
        <input value={charterVehicleNo} onChange={(e) => setCharterVehicleNo(e.target.value)} placeholder="例: 1234" />
        <label>開始メーター距離（km）</label>
        <input
          type="number"
          min={0}
          step="any"
          value={tripStartKm}
          onChange={(e) => {
            const v = Number(e.target.value);
            setTripStartKm(Number.isFinite(v) ? Math.max(0, v) : 0);
          }}
        />
        <label>開始時刻</label>
        <input type="datetime-local" value={departedLocal} onChange={(e) => setDepartedLocal(e.target.value)} />
        <button type="button" className="settings-secondary" onClick={() => setDepartedLocal(toDatetimeLocalValue(new Date()))}>
          現在時刻を開始にセット
        </button>
        <label>駐車場料金（立替金・円）</label>
        <input type="number" min={0} value={parkingAdvanceYen} onChange={(e) => setParkingAdvanceYen(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
        <p className="settings-hint">売上・運賃とは別に記録されます。</p>
        <label>依頼場所</label>
        <input value={origin} onChange={(e) => setOrigin(e.target.value)} />
        <GpsTownButton label="GPSで町名を入力" onTown={(t) => setOrigin((o) => (o ? `${o} ${t}`.trim() : t))} disabled={busy} />
        <label>経由地</label>
        {viaStops.map((v, idx) => (
          <div key={idx} style={{ display: "flex", flexDirection: "column", gap: "0.25rem", marginBottom: "0.5rem" }}>
            <div style={{ display: "flex", gap: "0.35rem", alignItems: "flex-start", flexWrap: "wrap" }}>
              <input
                style={{ flex: "1 1 12rem", minWidth: 0 }}
                value={v}
                onChange={(e) => setViaStops((rows) => rows.map((x, i) => (i === idx ? e.target.value : x)))}
                placeholder={`経由 ${idx + 1}`}
              />
              <button
                type="button"
                className="settings-secondary"
                disabled={viaStops.length <= 1}
                onClick={() => setViaStops((rows) => rows.filter((_, i) => i !== idx))}
              >
                削除
              </button>
            </div>
            <GpsTownButton
              label="GPSでこの行に追記"
              onTown={(t) => setViaStops((rows) => rows.map((x, i) => (i === idx ? (x ? `${x} ${t}`.trim() : t) : x)))}
              disabled={busy}
            />
          </div>
        ))}
        <button type="button" className="settings-secondary" onClick={() => setViaStops((rows) => [...rows, ""])}>
          経由地を追加
        </button>
        <label>到着メーター距離（km）</label>
        <input
          type="number"
          min={0}
          step="any"
          value={tripEndKm}
          onChange={(e) => {
            const v = Number(e.target.value);
            setTripEndKm(Number.isFinite(v) ? Math.max(0, v) : 0);
          }}
        />
        <label>到着地</label>
        <input value={destination} onChange={(e) => setDestination(e.target.value)} />
        <GpsTownButton label="GPSで町名を到着に入力" onTown={(t) => setDestination((d) => (d ? `${d} ${t}`.trim() : t))} disabled={busy} />
        <label>到着時刻</label>
        <input type="datetime-local" value={arrivedLocal} onChange={(e) => setArrivedLocal(e.target.value)} />
        <button type="button" className="settings-secondary" onClick={() => setArrivedLocal(toDatetimeLocalValue(new Date()))}>
          現在時刻を到着にセット
        </button>
        <label>走行距離（km）</label>
        <input type="text" readOnly value={formatKm(distanceKmAuto)} title="到着メーター − 開始メーター" />
        <p className="settings-hint" style={{ marginTop: 0 }}>
          到着メーター − 開始メーターから自動計算（保存時に記録されます）。
        </p>
        <label>走行時間（分）</label>
        <input type="text" readOnly value={travelMinutesAuto != null ? String(travelMinutesAuto) : "—"} title="到着時刻 − 開始時刻" />
        <p className="settings-hint" style={{ marginTop: 0 }}>
          到着時刻 − 開始時刻から自動表示（参考値・DBには保存しません）。
        </p>
        <label>料金プラン（版）</label>
        <select value={tariffVersionId} onChange={(e) => setTariffVersionId(e.target.value)}>
          <option value="">未選択</option>
          {tariffVersions.map((tv) => (
            <option key={tv.id} value={tv.id}>
              {tv.label}
            </option>
          ))}
        </select>
        <label>運賃（円）</label>
        <input type="number" min={0} value={fareYen} onChange={(e) => setFareYen(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />

        {showSurchargeDetails ? (
          <details className="settings-fieldset" style={{ marginTop: "0.5rem" }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>付帯料金・加算フラグ</summary>
            <div className="settings-form" style={{ marginTop: "0.5rem" }}>
              {features.includes("pickup") ? (
                <>
                  <label className="settings-check">
                    <input type="checkbox" checked={pickup.apply} onChange={(e) => toggle(pickup, setPickup, defaults.pickupYen, e.target.checked)} /> 迎車料金
                  </label>
                  <NumRow label="迎車（円）" value={pickup.yen} onChange={(yen) => setPickup({ ...pickup, yen })} disabled={!pickup.apply} />
                </>
              ) : null}
              {features.includes("leftHand") ? (
                <>
                  <label className="settings-check">
                    <input type="checkbox" checked={leftHand.apply} onChange={(e) => toggle(leftHand, setLeftHand, defaults.leftHandYen, e.target.checked)} />{" "}
                    左ハンドル（定額枠）
                  </label>
                  <NumRow label="左ハンドル（円）" value={leftHand.yen} onChange={(yen) => setLeftHand({ ...leftHand, yen })} disabled={!leftHand.apply} />
                </>
              ) : null}
              {features.includes("foreignCar") ? (
                <>
                  <label className="settings-check">
                    <input type="checkbox" checked={foreignCar.apply} onChange={(e) => toggle(foreignCar, setForeignCar, defaults.foreignCarYen, e.target.checked)} />{" "}
                    外車
                  </label>
                  <NumRow label="外車（円）" value={foreignCar.yen} onChange={(yen) => setForeignCar({ ...foreignCar, yen })} disabled={!foreignCar.apply} />
                </>
              ) : null}
              {features.includes("cancel") ? (
                <>
                  <label className="settings-check">
                    <input type="checkbox" checked={cancel.apply} onChange={(e) => toggle(cancel, setCancel, defaults.cancelYen, e.target.checked)} /> キャンセル
                  </label>
                  <NumRow label="キャンセル（円）" value={cancel.yen} onChange={(yen) => setCancel({ ...cancel, yen })} disabled={!cancel.apply} />
                </>
              ) : null}
              {showNightPct ? (
                <label className="settings-check">
                  <input type="checkbox" checked={applyNightSurcharge} onChange={(e) => setApplyNightSurcharge(e.target.checked)} /> 深夜割増（率）
                </label>
              ) : null}
              {showNightFlat ? (
                <label className="settings-check">
                  <input type="checkbox" checked={applyNightSurchargeFlat} onChange={(e) => setApplyNightSurchargeFlat(e.target.checked)} /> 深夜帯定額
                </label>
              ) : null}
              {showLeftHandPct ? (
                <label className="settings-check">
                  <input type="checkbox" checked={applyLeftHandSurcharge} onChange={(e) => setApplyLeftHandSurcharge(e.target.checked)} /> 左ハンドル（率）
                </label>
              ) : null}
              {showEarlyMorningFlat ? (
                <label className="settings-check">
                  <input type="checkbox" checked={applyEarlyMorningFlatYen} onChange={(e) => setApplyEarlyMorningFlatYen(e.target.checked)} /> 早朝定額1
                </label>
              ) : null}
              {showLateNightFlat ? (
                <label className="settings-check">
                  <input type="checkbox" checked={applyLateNightFlatYen} onChange={(e) => setApplyLateNightFlatYen(e.target.checked)} /> 深夜定額2
                </label>
              ) : null}
              {showEarlyRushFlat ? (
                <label className="settings-check">
                  <input type="checkbox" checked={applyEarlyRushFlatYen} onChange={(e) => setApplyEarlyRushFlatYen(e.target.checked)} /> 早朝定額2
                </label>
              ) : null}
            </div>
          </details>
        ) : null}

        <button type="button" className="settings-primary" style={{ marginTop: "0.75rem" }} disabled={busy} onClick={() => void submit()}>
          送信（この運行を保存）
        </button>
      </div>
    </section>
  );
}

export default function DailyReportDetailPage(): JSX.Element {
  const { reportId } = useParams<{ reportId: string }>();
  const [err, setErr] = useState<string | null>(null);
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [features, setFeatures] = useState<string[]>([]);
  const [tariffVersions, setTariffVersions] = useState<TariffOpt[]>([]);
  const [employees, setEmployees] = useState<EmpMini[]>([]);
  const [vehicles, setVehicles] = useState<VehMini[]>([]);

  const [partnerId, setPartnerId] = useState<string>("");
  const [escortVehicleId, setEscortVehicleId] = useState<string>("");
  const [escortOdoStart, setEscortOdoStart] = useState<number>(0);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionErr, setSessionErr] = useState<string | null>(null);

  const [continueOpen, setContinueOpen] = useState(false);
  const [continueStep, setContinueStep] = useState<"choose" | "odoEnd">("choose");
  const [odoEndInput, setOdoEndInput] = useState(0);
  const [continueBusy, setContinueBusy] = useState(false);

  const [addTripOpen, setAddTripOpen] = useState(false);
  const [dialogTripId, setDialogTripId] = useState<string | null>(null);
  const [addTripBusy, setAddTripBusy] = useState(false);
  const [tripActionBusy, setTripActionBusy] = useState(false);
  const [schedulePrefill, setSchedulePrefill] = useState<SchedulePrefillPayload | null>(null);
  const schedulePrefillSeq = useRef(0);
  const [schedulePickOpen, setSchedulePickOpen] = useState(false);
  const [schedulePickErr, setSchedulePickErr] = useState<string | null>(null);
  const [schedulePickLoading, setSchedulePickLoading] = useState(false);
  const [schedulePayload, setSchedulePayload] = useState<SchedulePayloadMini | null>(null);

  const [editTripOpen, setEditTripOpen] = useState(false);
  const [editTripId, setEditTripId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!reportId) return;
    const r = await apiFetch<{
      report: ReportDetail;
      pricingDefaults: Defaults;
      pricingFeatures: string[];
      tariffVersions: TariffOpt[];
      employees: EmpMini[];
      vehicles: VehMini[];
    }>(`/daily-reports/${reportId}`);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setReport(r.data.report);
    setDefaults(r.data.pricingDefaults);
    setFeatures(r.data.pricingFeatures ?? []);
    const tvs = r.data.tariffVersions ?? [];
    setTariffVersions(
      tvs.map((tv) => ({
        id: tv.id,
        label: tv.label,
        planId: tv.planId,
        version: tv.version,
        nightSurchargeBps: Number(tv.nightSurchargeBps) || 0,
        nightSurchargeFlatYen: Number(tv.nightSurchargeFlatYen) || 0,
        leftHandSurchargeBps: Number(tv.leftHandSurchargeBps) || 0,
        earlyMorningFlatYen: Number(tv.earlyMorningFlatYen) || 0,
        lateNightFlatYen: Number(tv.lateNightFlatYen) || 0,
        earlyRushFlatYen: Number(tv.earlyRushFlatYen) || 0,
      })),
    );
    setEmployees(r.data.employees ?? []);
    setVehicles(r.data.vehicles ?? []);
    const rep = r.data.report;
    setPartnerId(rep.partnerEmployeeId ?? "");
    setEscortVehicleId(rep.escortVehicleId ?? "");
    setEscortOdoStart(rep.escortOdometerStartM ?? 0);
    setErr(null);
  }, [reportId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (continueOpen && continueStep === "odoEnd" && report) {
      setOdoEndInput(report.escortOdometerEndM ?? report.escortOdometerStartM ?? 0);
    }
  }, [continueOpen, continueStep, report]);

  async function patchSession(body: Record<string, unknown>): Promise<void> {
    if (!reportId) return;
    setSessionBusy(true);
    setSessionErr(null);
    const r = await apiFetch(`/daily-reports/${reportId}`, { method: "PATCH", json: body });
    setSessionBusy(false);
    if (!r.ok) setSessionErr(r.error);
    else void load();
  }

  async function openNewTripDialog(): Promise<void> {
    if (!reportId) return;
    closeEditTripDialog();
    setAddTripBusy(true);
    setErr(null);
    const r = await apiFetch<{ id: string }>(`/daily-reports/${reportId}/trips`, { method: "POST", json: {} });
    if (!r.ok) {
      setErr(r.error);
      setAddTripBusy(false);
      return;
    }
    setDialogTripId(r.data.id);
    setSchedulePrefill(null);
    schedulePrefillSeq.current = 0;
    await load();
    setAddTripOpen(true);
    setAddTripBusy(false);
  }

  function clearAddTripUi(): void {
    setAddTripOpen(false);
    setDialogTripId(null);
    setSchedulePrefill(null);
    setSchedulePickOpen(false);
  }

  async function discardAddTripDraft(): Promise<void> {
    const tid = dialogTripId;
    const rid = reportId;
    clearAddTripUi();
    if (!tid || !rid) return;
    setTripActionBusy(true);
    setErr(null);
    const r = await apiFetch(`/daily-reports/${rid}/trips/${tid}`, { method: "DELETE" });
    setTripActionBusy(false);
    if (!r.ok) setErr(r.error);
    await load();
  }

  async function deleteTripLeg(tripId: string, summary: string): Promise<void> {
    if (!reportId) return;
    if (!window.confirm(`この運行を削除しますか？\n${summary}`)) return;
    setTripActionBusy(true);
    setErr(null);
    const r = await apiFetch(`/daily-reports/${reportId}/trips/${tripId}`, { method: "DELETE" });
    setTripActionBusy(false);
    if (!r.ok) setErr(r.error);
    else void load();
  }

  function closeEditTripDialog(): void {
    setEditTripOpen(false);
    setEditTripId(null);
  }

  function openEditTripDialog(id: string): void {
    if (addTripOpen) return;
    setEditTripId(id);
    setEditTripOpen(true);
  }

  async function openSchedulePicker(): Promise<void> {
    if (!report) return;
    setSchedulePickOpen(true);
    setSchedulePickErr(null);
    setSchedulePickLoading(true);
    const r = await apiFetch<SchedulePayloadMini>(`/dispatch/schedule?date=${encodeURIComponent(report.businessDate)}`);
    setSchedulePickLoading(false);
    if (!r.ok) {
      setSchedulePickErr(r.error);
      setSchedulePayload(null);
      return;
    }
    setSchedulePayload(r.data);
  }

  function applyReservationToPrefill(row: ScheduleReservationRow): void {
    schedulePrefillSeq.current += 1;
    const d = row.detail;
    setSchedulePrefill({
      token: schedulePrefillSeq.current,
      customerName: d.customerName,
      pickup: d.pickup,
      dropoff: d.dropoff,
      viaStops: Array.isArray(d.viaStops) ? d.viaStops.filter((s): s is string => typeof s === "string") : [],
      vehicleNumber: d.vehicleNumber,
      departedIso: row.startsAt,
      arrivedIso: row.endsAt,
    });
    setSchedulePickOpen(false);
  }

  async function savePartner(): Promise<void> {
    await patchSession({ partnerEmployeeId: partnerId || null });
  }

  async function saveEscort(): Promise<void> {
    await patchSession({
      escortVehicleId: escortVehicleId || null,
      escortOdometerStartM: escortVehicleId ? escortOdoStart : null,
    });
  }

  async function submitOdoEnd(): Promise<void> {
    if (!reportId) return;
    setContinueBusy(true);
    const r = await apiFetch(`/daily-reports/${reportId}`, {
      method: "PATCH",
      json: { escortOdometerEndM: odoEndInput },
    });
    setContinueBusy(false);
    if (!r.ok) setErr(r.error);
    else {
      setContinueOpen(false);
      setContinueStep("choose");
      void load();
    }
  }

  async function openJommuPrint(): Promise<void> {
    if (!reportId) return;
    setErr(null);
    const r = await apiFetchText(`/daily-reports/${reportId}/jommu-print.html`);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    const w = window.open("", "_blank", "noopener,noreferrer");
    if (!w) {
      setErr("ポップアップがブロックされました。ブラウザの設定から許可してください。");
      return;
    }
    w.document.open();
    w.document.write(r.text);
    w.document.close();
  }

  const dialogTrip = useMemo(() => {
    if (!report || !addTripOpen || !dialogTripId) return null;
    return report.trips.find((t) => t.id === dialogTripId) ?? null;
  }, [report, addTripOpen, dialogTripId]);

  const draftTripId = addTripOpen && dialogTripId ? dialogTripId : null;
  const tableTrips = useMemo(() => {
    if (!report) return [];
    if (!draftTripId) return report.trips;
    return report.trips.filter((t) => t.id !== draftTripId);
  }, [report, draftTripId]);

  const mainDriverReservations = useMemo(() => {
    if (!schedulePayload || !report) return [];
    return schedulePayload.reservations.filter((x) => x.driverEmployeeId === report.mainEmployeeId);
  }, [schedulePayload, report]);

  const editTrip = useMemo(() => {
    if (!report || !editTripOpen || !editTripId) return null;
    return report.trips.find((t) => t.id === editTripId) ?? null;
  }, [report, editTripOpen, editTripId]);

  if (!report || !defaults) {
    return (
      <Card title="日報">
        <Err msg={err} />
        <p className="settings-hint">読み込み中…</p>
      </Card>
    );
  }

  return (
    <Card title={`日報 ${report.businessDate}`}>
      <Err msg={err} />
      <p className="settings-hint" style={{ marginTop: 0, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" }}>
        <Link to="/daily-reports">一覧へ</Link>
        <button type="button" className="settings-secondary" onClick={() => void openJommuPrint()}>
          乗務記録簿を印刷
        </button>
        <span>
        {" · "}
        客車担当: {report.mainEmployee.familyName} {report.mainEmployee.givenName}
        {report.escortVehicle ? ` / 随伴: ${report.escortVehicle.label}` : " / 随伴: 未設定"} / メーター {report.meterStart}→{report.meterEnd}
        </span>
      </p>

      <div className="settings-section-panel" style={{ marginBottom: "1rem" }}>
        <h3 className="settings-subtitle" style={{ marginTop: 0 }}>
          勤務セッション（この日報で固定）
        </h3>
        <p className="settings-hint">
          ペアはこの日報内で変更できます。随伴車を変える場合は、客車担当と随伴車の組み合わせごとに日報が分かれるため、新しい日報を作成してください（一覧で同じ事業日・担当・随伴の組が重ならないようにします）。
        </p>
        <Err msg={sessionErr} />
        <div className="settings-form">
          <label>ペア（乗務員）</label>
          <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
            <option value="">未設定</option>
            {employees
              .filter((e) => e.id !== report.mainEmployeeId)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.familyName} {e.givenName}
                </option>
              ))}
          </select>
          <button type="button" className="settings-secondary" disabled={sessionBusy} onClick={() => void savePartner()}>
            ペアを保存
          </button>

          <label style={{ marginTop: "0.75rem" }}>随伴車</label>
          <select value={escortVehicleId} onChange={(e) => setEscortVehicleId(e.target.value)}>
            <option value="">未設定</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
                {v.plate ? `（${v.plate}）` : ""}
              </option>
            ))}
          </select>
          <label>随伴車 ODO（メーカー距離・開始）</label>
          <input
            type="number"
            min={0}
            disabled={!escortVehicleId}
            value={escortOdoStart}
            onChange={(e) => setEscortOdoStart(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          />
          <p className="settings-hint">当日初めてその随伴車を使うときなどに入力し、「随伴車・ODOを保存」で記録します。</p>
          <button type="button" className="settings-secondary" disabled={sessionBusy} onClick={() => void saveEscort()}>
            随伴車・ODOを保存
          </button>
          {report.escortOdometerEndM != null ? (
            <p className="settings-hint" style={{ marginTop: "0.5rem" }}>
              終了ODO（記録済）: {report.escortOdometerEndM}
            </p>
          ) : null}
        </div>
      </div>

      <div style={{ marginBottom: "0.75rem" }}>
        <button type="button" className="settings-primary" disabled={addTripBusy || tripActionBusy} onClick={() => void openNewTripDialog()}>
          {addTripBusy ? "準備中…" : "運行を追加"}
        </button>
      </div>

      {report.trips.length === 0 && !addTripOpen ? <p className="settings-hint">運行がまだありません。「運行を追加」から入力してください。</p> : null}

      {report.trips.length > 0 ? (
        <div className="settings-section-panel trip-history-wrap" style={{ marginBottom: "1rem" }}>
          <h3 className="settings-subtitle" style={{ marginTop: 0 }}>
            運行一覧
          </h3>
          <p className="settings-hint" style={{ marginTop: 0 }}>
            行をタップすると修正ダイアログが開きます{addTripOpen ? "（運行追加中は一覧から開けません）" : ""}。
          </p>
          {tableTrips.length === 0 && addTripOpen ? (
            <p className="settings-hint">追加中の運行は「送信」するまで一覧に表示されません。閉じると入力は破棄されます。</p>
          ) : null}
          {tableTrips.length > 0 ? (
          <table className="trip-history-table">
            <thead>
              <tr>
                <th>開始時刻</th>
                <th>依頼者名</th>
                <th>開始場所</th>
                <th>経由地</th>
                <th>到着場所</th>
                <th className="trip-history-th-narrow">金額</th>
                <th className="trip-history-th-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {tableTrips.map((t) => {
                const rowDisabled = addTripOpen;
                const startLabel = formatTripStartDisplay(t.departedAt);
                const viaLabel = viaSummaryFromTrip(t);
                const clientLabel = t.clientName?.trim() ? t.clientName : "（未入力）";
                const delSummary = `${startLabel} ${clientLabel}`;
                return (
                  <tr
                    key={t.id}
                    className={rowDisabled ? "trip-history-tr trip-history-tr--disabled" : "trip-history-tr"}
                    tabIndex={rowDisabled ? -1 : 0}
                    role="button"
                    aria-disabled={rowDisabled}
                    onClick={() => {
                      if (rowDisabled) return;
                      openEditTripDialog(t.id);
                    }}
                    onKeyDown={(e) => {
                      if (rowDisabled) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openEditTripDialog(t.id);
                      }
                    }}
                  >
                    <td className="trip-history-cell-clip" title={startLabel}>
                      {startLabel}
                    </td>
                    <td className="trip-history-cell-clip" title={clientLabel}>
                      {clientLabel}
                    </td>
                    <td className="trip-history-cell-clip" title={t.origin}>
                      {t.origin?.trim() ? t.origin : "—"}
                    </td>
                    <td className="trip-history-cell-clip" title={viaLabel}>
                      {viaLabel}
                    </td>
                    <td className="trip-history-cell-clip" title={t.destination}>
                      {t.destination?.trim() ? t.destination : "—"}
                    </td>
                    <td className="trip-history-td-yen">{t.fareYen.toLocaleString("ja-JP")}円</td>
                    <td className="trip-history-td-actions">
                      <button
                        type="button"
                        className="settings-secondary"
                        disabled={rowDisabled || tripActionBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteTripLeg(t.id, delSummary);
                        }}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          ) : null}
        </div>
      ) : null}

      {addTripOpen && dialogTripId && defaults && dialogTrip ? (
        <div
          className="pricing-modal-backdrop"
          style={{ zIndex: 105 }}
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) void discardAddTripDraft();
          }}
        >
          <div
            className="pricing-modal attend-shift-dialog trip-add-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dr-add-trip-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="dr-add-trip-title" className="pricing-modal-title">
              運行を追加
            </h2>
            <p className="settings-hint">入力後「送信」で保存すると運行一覧に表示されます。閉じると未送信の運行は破棄されます。</p>
            <div className="attend-shift-dialog-scroll" style={{ display: "flex", flexDirection: "column", gap: "0.5rem", paddingTop: "0.35rem" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                <button type="button" className="settings-secondary" disabled={schedulePickLoading} onClick={() => void openSchedulePicker()}>
                  スケジュールから入力
                </button>
              </div>
              <TripWizard
                reportId={reportId!}
                trip={dialogTrip}
                tariffVersions={tariffVersions}
                defaults={defaults}
                features={features}
                sectionTitle="運行入力"
                schedulePrefill={schedulePrefill}
                onSubmitted={async () => {
                  clearAddTripUi();
                  await load();
                  setContinueOpen(true);
                  setContinueStep("choose");
                }}
              />
            </div>
            <div className="pricing-modal-actions">
              <button type="button" className="settings-secondary" disabled={tripActionBusy} onClick={() => void discardAddTripDraft()}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editTripOpen && editTripId && defaults && editTrip ? (
        <div
          className="pricing-modal-backdrop"
          style={{ zIndex: 106 }}
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeEditTripDialog();
          }}
        >
          <div
            className="pricing-modal attend-shift-dialog trip-add-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dr-edit-trip-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="dr-edit-trip-title" className="pricing-modal-title">
              運行を修正
            </h2>
            <p className="settings-hint">内容を変更して「送信」で保存します。</p>
            <div className="attend-shift-dialog-scroll" style={{ paddingTop: "0.35rem" }}>
              <TripWizard
                reportId={reportId!}
                trip={editTrip}
                tariffVersions={tariffVersions}
                defaults={defaults}
                features={features}
                sectionTitle="運行入力"
                onSubmitted={async () => {
                  closeEditTripDialog();
                  await load();
                  setContinueOpen(true);
                  setContinueStep("choose");
                }}
              />
            </div>
            <div className="pricing-modal-actions">
              <button type="button" className="settings-secondary" onClick={() => closeEditTripDialog()}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {schedulePickOpen ? (
        <div
          className="pricing-modal-backdrop"
          style={{ zIndex: 110 }}
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSchedulePickOpen(false);
          }}
        >
          <div
            className="pricing-modal attend-shift-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dr-sched-pick-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="dr-sched-pick-title" className="pricing-modal-title">
              スケジュールから入力
            </h2>
            <p className="settings-hint">乗務（客車担当）の予定から1件選ぶと、依頼者名・経路・車番・開始・終了時刻などが入力されます。</p>
            <Err msg={schedulePickErr} />
            <div className="attend-shift-dialog-scroll">
              {schedulePickLoading ? <p className="settings-hint">読み込み中…</p> : null}
              {!schedulePickLoading && mainDriverReservations.length === 0 ? (
                <p className="settings-hint">この日付で乗務スタッフに紐づく配車予定がありません（スケジュールで予定を登録してください）。</p>
              ) : null}
              {!schedulePickLoading
                ? mainDriverReservations.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      className="settings-list-btn"
                      style={{ textAlign: "left", width: "100%", marginBottom: "0.35rem" }}
                      onClick={() => applyReservationToPrefill(row)}
                    >
                      {formatScheduleRowLabel(row)}
                    </button>
                  ))
                : null}
            </div>
            <div className="pricing-modal-actions">
              <button type="button" onClick={() => setSchedulePickOpen(false)}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {continueOpen ? (
        <div
          className="pricing-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setContinueOpen(false);
          }}
        >
          <div className="pricing-modal attend-shift-dialog" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            {continueStep === "choose" ? (
              <>
                <h2 className="pricing-modal-title">本日の業務は続きますか？</h2>
                <p className="settings-hint">「はい」でダイアログから次の運行を入力できます。「いいえ」で随伴車の終了ODOを記録して締めます。</p>
                <div className="pricing-modal-actions">
                  <button
                    type="button"
                    className="settings-primary"
                    disabled={continueBusy}
                    onClick={() => {
                      void (async () => {
                        setContinueBusy(true);
                        await openNewTripDialog();
                        setContinueBusy(false);
                        setContinueOpen(false);
                        setContinueStep("choose");
                      })();
                    }}
                  >
                    はい（次の運行へ）
                  </button>
                  <button type="button" className="settings-secondary" onClick={() => setContinueStep("odoEnd")}>
                    いいえ（終了ODO）
                  </button>
                  <button type="button" onClick={() => setContinueOpen(false)}>
                    閉じる
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="pricing-modal-title">随伴車 ODO（終了）</h2>
                <div className="settings-form">
                  <label>メーカー距離（終了時）</label>
                  <input type="number" min={0} value={odoEndInput} onChange={(e) => setOdoEndInput(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
                </div>
                <div className="pricing-modal-actions">
                  <button type="button" className="settings-primary" disabled={continueBusy} onClick={() => void submitOdoEnd()}>
                    保存して閉じる
                  </button>
                  <button type="button" onClick={() => setContinueStep("choose")}>
                    戻る
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

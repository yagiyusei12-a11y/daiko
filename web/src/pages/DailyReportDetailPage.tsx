import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../api";
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

type TariffOpt = { id: string; label: string; planId: string; version: number };
type Defaults = { pickupYen: number; leftHandYen: number; foreignCarYen: number; cancelYen: number };

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
}: {
  reportId: string;
  trip: TripLegFull;
  tariffVersions: TariffOpt[];
  defaults: Defaults;
  features: string[];
  onSubmitted: () => void | Promise<void>;
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

  const distanceKmAuto = useMemo(() => Math.max(0, tripEndKm - tripStartKm), [tripEndKm, tripStartKm]);
  const travelMinutesAuto = useMemo(() => travelMinutesBetween(departedLocal, arrivedLocal), [departedLocal, arrivedLocal]);

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
      pickup: { apply: pickup.apply, yen: pickup.yen },
      leftHand: { apply: leftHand.apply, yen: leftHand.yen },
      foreignCar: { apply: foreignCar.apply, yen: foreignCar.yen },
      cancel: { apply: cancel.apply, yen: cancel.yen },
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
        applyNightSurcharge,
        applyNightSurchargeFlat,
        applyLeftHandSurcharge,
        applyEarlyMorningFlatYen,
        applyLateNightFlatYen,
        applyEarlyRushFlatYen,
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
        運行（1件）
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
            <label className="settings-check">
              <input type="checkbox" checked={applyNightSurcharge} onChange={(e) => setApplyNightSurcharge(e.target.checked)} /> 深夜割増（率）
            </label>
            <label className="settings-check">
              <input type="checkbox" checked={applyNightSurchargeFlat} onChange={(e) => setApplyNightSurchargeFlat(e.target.checked)} /> 深夜帯定額
            </label>
            <label className="settings-check">
              <input type="checkbox" checked={applyLeftHandSurcharge} onChange={(e) => setApplyLeftHandSurcharge(e.target.checked)} /> 左ハンドル（率）
            </label>
            <label className="settings-check">
              <input type="checkbox" checked={applyEarlyMorningFlatYen} onChange={(e) => setApplyEarlyMorningFlatYen(e.target.checked)} /> 早朝定額1
            </label>
            <label className="settings-check">
              <input type="checkbox" checked={applyLateNightFlatYen} onChange={(e) => setApplyLateNightFlatYen(e.target.checked)} /> 深夜定額2
            </label>
            <label className="settings-check">
              <input type="checkbox" checked={applyEarlyRushFlatYen} onChange={(e) => setApplyEarlyRushFlatYen(e.target.checked)} /> 早朝定額2
            </label>
          </div>
        </details>

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
    setTariffVersions(r.data.tariffVersions ?? []);
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

  async function addTrip(): Promise<void> {
    if (!reportId) return;
    const r = await apiFetch<{ id: string }>(`/daily-reports/${reportId}/trips`, { method: "POST", json: {} });
    if (!r.ok) setErr(r.error);
    else await load();
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

  if (!reportId) return <p className="settings-hint">日報が見つかりません。</p>;
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
      <p className="settings-hint" style={{ marginTop: 0 }}>
        <Link to="/daily-reports">一覧へ</Link>
        {" · "}
        乗務: {report.mainEmployee.familyName} {report.mainEmployee.givenName} / メーター {report.meterStart}→{report.meterEnd}
      </p>

      <div className="settings-section-panel" style={{ marginBottom: "1rem" }}>
        <h3 className="settings-subtitle" style={{ marginTop: 0 }}>
          勤務セッション（この日報で固定）
        </h3>
        <p className="settings-hint">ペア・随伴車は途中で変えたいときだけ保存してください。次の運行入力ではそのまま引き継がれます。</p>
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
        <button type="button" className="settings-primary" onClick={() => void addTrip()}>
          運行を追加
        </button>
      </div>

      {report.trips.length === 0 ? <p className="settings-hint">運行がまだありません。「運行を追加」から入力してください。</p> : null}

      {report.trips.map((t) => (
        <TripWizard
          key={t.id}
          reportId={reportId!}
          trip={t}
          tariffVersions={tariffVersions}
          defaults={defaults}
          features={features}
          onSubmitted={async () => {
            await load();
            setContinueOpen(true);
            setContinueStep("choose");
          }}
        />
      ))}

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
                <p className="settings-hint">「はい」で空の運行を追加し、続けて入力できます。「いいえ」で随伴車の終了ODOを記録して締めます。</p>
                <div className="pricing-modal-actions">
                  <button
                    type="button"
                    className="settings-primary"
                    disabled={continueBusy}
                    onClick={() => {
                      void (async () => {
                        setContinueBusy(true);
                        await addTrip();
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

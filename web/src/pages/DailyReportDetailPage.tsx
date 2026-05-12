import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../api";
import { Card, Err } from "../ui";

type TripLeg = {
  id: string;
  clientName: string;
  origin: string;
  destination: string;
  fareYen: number;
  applyLeftHandSurchargeFlat: boolean;
  legSurchargesJson: unknown;
};

type ReportDetail = {
  id: string;
  businessDate: string;
  meterStart: number;
  meterEnd: number;
  vehicleId: string;
  mainEmployeeId: string;
  trips: TripLeg[];
  vehicle: { id: string; label: string };
  mainEmployee: { id: string; familyName: string; givenName: string };
};

type Defaults = { pickupYen: number; leftHandYen: number; foreignCarYen: number; cancelYen: number };

function readSlot(j: unknown, key: string): { apply: boolean; yen: number } {
  const root = j && typeof j === "object" ? (j as Record<string, unknown>) : {};
  const o = root[key];
  if (!o || typeof o !== "object") return { apply: false, yen: 0 };
  const s = o as Record<string, unknown>;
  return { apply: Boolean(s.apply), yen: Math.max(0, Math.floor(Number(s.yen) || 0)) };
}

function TripEditor({
  reportId,
  trip,
  defaults,
  features,
  onSaved,
}: {
  reportId: string;
  trip: TripLeg;
  defaults: Defaults;
  features: string[];
  onSaved: () => void;
}): JSX.Element {
  const j0 = trip.legSurchargesJson;
  const [clientName, setClientName] = useState(trip.clientName);
  const [origin, setOrigin] = useState(trip.origin);
  const [destination, setDestination] = useState(trip.destination);
  const [fareYen, setFareYen] = useState(trip.fareYen);
  const [pickup, setPickup] = useState(() => readSlot(j0, "pickup"));
  const [leftHand, setLeftHand] = useState(() => readSlot(j0, "leftHand"));
  const [foreignCar, setForeignCar] = useState(() => readSlot(j0, "foreignCar"));
  const [cancel, setCancel] = useState(() => readSlot(j0, "cancel"));
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(
    cur: { apply: boolean; yen: number },
    set: (v: { apply: boolean; yen: number }) => void,
    defYen: number,
    nextApply: boolean,
  ): void {
    if (nextApply) {
      set({ apply: true, yen: cur.yen > 0 ? cur.yen : defYen });
    } else {
      set({ apply: false, yen: cur.yen });
    }
  }

  async function save(): Promise<void> {
    setBusy(true);
    setErr(null);
    setMsg(null);
    const legSurchargesJson = {
      pickup: { apply: pickup.apply, yen: pickup.yen },
      leftHand: { apply: leftHand.apply, yen: leftHand.yen },
      foreignCar: { apply: foreignCar.apply, yen: foreignCar.yen },
      cancel: { apply: cancel.apply, yen: cancel.yen },
    };
    const r = await apiFetch(`/daily-reports/${reportId}/trips/${trip.id}`, {
      method: "PATCH",
      json: {
        clientName,
        origin,
        destination,
        fareYen,
        legSurchargesJson,
      },
    });
    setBusy(false);
    if (!r.ok) setErr(r.error);
    else {
      setMsg("保存しました");
      onSaved();
    }
  }

  return (
    <section className="card trip-editor">
      <h3 className="card-title" style={{ fontSize: "0.95rem" }}>
        運行: {trip.id.slice(0, 8)}…
      </h3>
      <Err msg={err} />
      {msg ? (
        <p className="settings-msg" role="status">
          {msg}
        </p>
      ) : null}
      <div className="settings-form">
        <label>お客様名</label>
        <input value={clientName} onChange={(e) => setClientName(e.target.value)} />
        <label>出発地</label>
        <input value={origin} onChange={(e) => setOrigin(e.target.value)} />
        <label>目的地</label>
        <input value={destination} onChange={(e) => setDestination(e.target.value)} />
        <label>運賃（円）</label>
        <input type="number" min={0} value={fareYen} onChange={(e) => setFareYen(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />

        {features.includes("pickup") ? (
          <>
            <label className="settings-check">
              <input type="checkbox" checked={pickup.apply} onChange={(e) => toggle(pickup, setPickup, defaults.pickupYen, e.target.checked)} />{" "}
              迎車料金
            </label>
            <NumRow label="迎車料金（円）" value={pickup.yen} onChange={(yen) => setPickup({ ...pickup, yen })} disabled={!pickup.apply} />
          </>
        ) : null}

        {features.includes("leftHand") ? (
          <>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={leftHand.apply}
                onChange={(e) => toggle(leftHand, setLeftHand, defaults.leftHandYen, e.target.checked)}
              />{" "}
              左ハンドル
            </label>
            <NumRow label="左ハンドル料金（円）" value={leftHand.yen} onChange={(yen) => setLeftHand({ ...leftHand, yen })} disabled={!leftHand.apply} />
          </>
        ) : null}

        {features.includes("foreignCar") ? (
          <>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={foreignCar.apply}
                onChange={(e) => toggle(foreignCar, setForeignCar, defaults.foreignCarYen, e.target.checked)}
              />{" "}
              外車
            </label>
            <NumRow label="外車料金（円）" value={foreignCar.yen} onChange={(yen) => setForeignCar({ ...foreignCar, yen })} disabled={!foreignCar.apply} />
          </>
        ) : null}

        {features.includes("cancel") ? (
          <>
            <label className="settings-check">
              <input type="checkbox" checked={cancel.apply} onChange={(e) => toggle(cancel, setCancel, defaults.cancelYen, e.target.checked)} />{" "}
              キャンセル
            </label>
            <NumRow label="キャンセル料金（円）" value={cancel.yen} onChange={(yen) => setCancel({ ...cancel, yen })} disabled={!cancel.apply} />
          </>
        ) : null}

        <button type="button" className="settings-primary" disabled={busy} onClick={() => void save()}>
          この運行を保存
        </button>
      </div>
    </section>
  );
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

export default function DailyReportDetailPage(): JSX.Element {
  const { reportId } = useParams<{ reportId: string }>();
  const [err, setErr] = useState<string | null>(null);
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [features, setFeatures] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!reportId) return;
    const r = await apiFetch<{ report: ReportDetail; pricingDefaults: Defaults; pricingFeatures: string[] }>(
      `/daily-reports/${reportId}`,
    );
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setReport(r.data.report);
    setDefaults(r.data.pricingDefaults);
    setFeatures(r.data.pricingFeatures ?? []);
    setErr(null);
  }, [reportId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addTrip(): Promise<void> {
    if (!reportId) return;
    const r = await apiFetch<{ id: string }>(`/daily-reports/${reportId}/trips`, { method: "POST", json: {} });
    if (!r.ok) setErr(r.error);
    else void load();
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
        車両: {report.vehicle.label} / 乗務: {report.mainEmployee.familyName} {report.mainEmployee.givenName} / メーター {report.meterStart}→
        {report.meterEnd}
      </p>
      <div style={{ marginBottom: "0.75rem" }}>
        <button type="button" onClick={() => void addTrip()}>
          運行を追加
        </button>
      </div>
      {report.trips.map((t) => (
        <TripEditor key={t.id} reportId={reportId} trip={t} defaults={defaults} features={features} onSaved={() => void load()} />
      ))}
    </Card>
  );
}

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api";
import { Card, Err, StepWizard, type StepWizardStep } from "../ui";

type Trip = {
  id: string;
  clientName: string;
  origin: string;
  destination: string;
  fareYen: number;
  distanceM: number;
  waitingMinutes: number;
  tariffVersionId: string | null;
  passengerKind: string;
  viaStopCount: number;
  applyNightSurcharge: boolean;
  applyLeftHandSurcharge: boolean;
};
type DR = {
  id: string;
  businessDate: string;
  trips: Trip[];
};
type DRRes = { dailyReports: DR[] };
type Ver = { id: string; version: number; planId: string };
type PlansRes = { plans: { id: string; versions: Ver[] }[] };

export default function DailyReportDetail(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [rep, setRep] = useState<DR | null>(null);
  const [versions, setVersions] = useState<Ver[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [tripWizardOpen, setTripWizardOpen] = useState(false);
  const [tripSubmitting, setTripSubmitting] = useState(false);
  const [clientName, setClientName] = useState("顧客");
  const [origin, setOrigin] = useState("A");
  const [destination, setDestination] = useState("B");
  const [distanceM, setDistanceM] = useState("3000");
  const [waitingMinutes, setWaitingMinutes] = useState("0");
  const [tariffVersionId, setTariffVersionId] = useState("");
  const [passengerKind, setPassengerKind] = useState<"GENERAL" | "MEMBER">("GENERAL");
  const [viaStopCount, setViaStopCount] = useState("0");
  const [applyNightSurcharge, setApplyNightSurcharge] = useState(false);
  const [applyLeftHandSurcharge, setApplyLeftHandSurcharge] = useState(false);

  async function load(): Promise<void> {
    if (!id) return;
    const r = await apiFetch<DRRes>("/daily-reports");
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    const found = r.data.dailyReports.find((d) => d.id === id) ?? null;
    setRep(found);
    const rp = await apiFetch<PlansRes>("/tariff-plans?versionsLimit=50");
    if (rp.ok) {
      const vers = rp.data.plans.flatMap((p) => p.versions);
      setVersions(vers);
      setTariffVersionId((tid) => tid || (vers[0]?.id ?? ""));
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  function closeTripWizard(): void {
    setTripWizardOpen(false);
    setClientName("顧客");
    setOrigin("A");
    setDestination("B");
    setDistanceM("3000");
    setWaitingMinutes("0");
    setPassengerKind("GENERAL");
    setViaStopCount("0");
    setApplyNightSurcharge(false);
    setApplyLeftHandSurcharge(false);
  }

  async function submitTrip(): Promise<void> {
    if (!id) return;
    setErr(null);
    setTripSubmitting(true);
    try {
      const r = await apiFetch<Trip>(`/daily-reports/${id}/trips`, {
        method: "POST",
        json: {
          clientName,
          origin,
          destination,
          departedAt: new Date().toISOString(),
          arrivedAt: new Date().toISOString(),
          distanceM: Number(distanceM),
          waitingMinutes: Number(waitingMinutes || 0),
          tariffVersionId: tariffVersionId || null,
          passengerKind,
          viaStopCount: Number(viaStopCount || 0),
          applyNightSurcharge,
          applyLeftHandSurcharge,
        },
      });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      closeTripWizard();
      await load();
    } finally {
      setTripSubmitting(false);
    }
  }

  const routeOk = clientName.trim().length > 0 && origin.trim().length > 0 && destination.trim().length > 0;
  const distOk = distanceM.trim() !== "" && !Number.isNaN(Number(distanceM));
  const waitOk = waitingMinutes.trim() === "" || !Number.isNaN(Number(waitingMinutes));
  const viaOk = viaStopCount.trim() === "" || (!Number.isNaN(Number(viaStopCount)) && Number(viaStopCount) >= 0);

  const steps: StepWizardStep[] = [
    {
      id: "route",
      title: "顧客と区間を入力してください",
      description: "運行の基本情報です。",
      canProceed: routeOk,
      children: (
        <>
          <label>顧客名</label>
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} autoFocus />
          <label>出発地</label>
          <input value={origin} onChange={(e) => setOrigin(e.target.value)} />
          <label>到着地</label>
          <input value={destination} onChange={(e) => setDestination(e.target.value)} />
        </>
      ),
    },
    {
      id: "metrics",
      title: "距離・待機・料金版",
      description: "距離はメートル単位です。料金版は任意です。",
      canProceed: distOk && waitOk && viaOk,
      children: (
        <>
          <label>距離 (m)</label>
          <input value={distanceM} onChange={(e) => setDistanceM(e.target.value)} inputMode="numeric" />
          <label>待機 (分)</label>
          <input value={waitingMinutes} onChange={(e) => setWaitingMinutes(e.target.value)} inputMode="numeric" />
          <label>料金版（任意）</label>
          <select value={tariffVersionId} onChange={(e) => setTariffVersionId(e.target.value)}>
            <option value="">なし</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version}
              </option>
            ))}
          </select>
          <label>会員区分</label>
          <select value={passengerKind} onChange={(e) => setPassengerKind(e.target.value as "GENERAL" | "MEMBER")}>
            <option value="GENERAL">一般</option>
            <option value="MEMBER">会員</option>
          </select>
          <label>経由ストップ回数</label>
          <input value={viaStopCount} onChange={(e) => setViaStopCount(e.target.value)} inputMode="numeric" />
          <label>
            <input type="checkbox" checked={applyNightSurcharge} onChange={(e) => setApplyNightSurcharge(e.target.checked)} /> 夜間割増
          </label>
          <label>
            <input type="checkbox" checked={applyLeftHandSurcharge} onChange={(e) => setApplyLeftHandSurcharge(e.target.checked)} /> 左ハンドル割増
          </label>
        </>
      ),
    },
    {
      id: "confirm",
      title: "運行追加の確認",
      canProceed: routeOk && distOk && waitOk && viaOk,
      children: (
        <dl className="step-wizard-summary">
          <dt>顧客</dt>
          <dd>{clientName}</dd>
          <dt>区間</dt>
          <dd>
            {origin} → {destination}
          </dd>
          <dt>距離 / 待機</dt>
          <dd>
            {distanceM} m / {waitingMinutes || "0"} 分
          </dd>
          <dt>料金版</dt>
          <dd>{tariffVersionId ? `v${versions.find((x) => x.id === tariffVersionId)?.version ?? ""}` : "なし"}</dd>
          <dt>会員／経由／割増</dt>
          <dd>
            {passengerKind === "MEMBER" ? "会員" : "一般"} / 経由{viaStopCount || "0"}回
            {applyNightSurcharge ? "・夜間" : ""}
            {applyLeftHandSurcharge ? "・左H" : ""}
          </dd>
        </dl>
      ),
    },
  ];

  async function delRep(): Promise<void> {
    if (!id || !confirm("この日報を削除しますか？")) return;
    setErr(null);
    const r = await apiFetch(`/daily-reports/${id}`, { method: "DELETE" });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else navigate("/daily-reports", { replace: true });
  }

  if (!id) return <Err msg="id がありません" />;
  if (!rep) return <p>読み込み中…</p>;

  return (
    <>
      <Card title={`日報 ${rep.businessDate}`}>
        <Err msg={err} />
        <button type="button" onClick={() => void delRep()}>
          日報削除
        </button>
      </Card>
      <Card title="運行追加">
        <p style={{ marginTop: 0 }}>
          <button type="button" onClick={() => setTripWizardOpen(true)}>
            運行を追加
          </button>
        </p>
        <StepWizard
          open={tripWizardOpen}
          onClose={closeTripWizard}
          title="運行を追加"
          steps={steps}
          finishLabel="運行追加"
          onFinish={submitTrip}
          isSubmitting={tripSubmitting}
        />
      </Card>
      <Card title="運行一覧">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>顧客</th>
                <th>区間</th>
                <th>運賃</th>
                <th>距離</th>
                <th>待機</th>
                <th>会員</th>
                <th>経由</th>
                <th>割増</th>
              </tr>
            </thead>
            <tbody>
              {rep.trips.map((t) => (
                <tr key={t.id}>
                  <td>{t.clientName}</td>
                  <td>
                    {t.origin}→{t.destination}
                  </td>
                  <td>{t.fareYen}</td>
                  <td>{t.distanceM}</td>
                  <td>{t.waitingMinutes}</td>
                  <td>{t.passengerKind === "MEMBER" ? "会員" : "一般"}</td>
                  <td>{t.viaStopCount}</td>
                  <td>
                    {[t.applyNightSurcharge && "夜", t.applyLeftHandSurcharge && "左"].filter(Boolean).join("・") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

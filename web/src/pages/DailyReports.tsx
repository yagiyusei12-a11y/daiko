import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, apiFetchBlob, getAccessToken } from "../api";
import { Card, Err, StepWizard, type StepWizardStep } from "../ui";

type Emp = { id: string; familyName: string; givenName: string };
type Veh = { id: string; label: string };
type Trip = {
  id: string;
  clientName: string;
  fareYen: number;
  distanceM: number;
  waitingMinutes: number;
};
type DR = {
  id: string;
  businessDate: string;
  meterStart: number;
  meterEnd: number;
  vehicleId: string;
  mainEmployeeId: string;
  trips: Trip[];
};

export default function DailyReports(): JSX.Element {
  const [rows, setRows] = useState<DR[]>([]);
  const [emps, setEmps] = useState<Emp[]>([]);
  const [vehs, setVehs] = useState<Veh[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [mainEmployeeId, setMainEmployeeId] = useState("");
  const [meterStart, setMeterStart] = useState("");
  const [meterEnd, setMeterEnd] = useState("");

  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  const [exportOfficialOnly, setExportOfficialOnly] = useState(false);

  async function load(): Promise<void> {
    const [r1, r2, r3] = await Promise.all([
      apiFetch<{ dailyReports: DR[] }>("/daily-reports"),
      apiFetch<{ employees: Emp[] }>("/employees"),
      apiFetch<{ vehicles: Veh[] }>("/vehicles"),
    ]);
    if (r1.ok) {
      setRows(r1.data.dailyReports);
      const dates = r1.data.dailyReports.map((x) => x.businessDate).sort();
      if (dates.length) {
        setExportFrom((f) => (f.trim() ? f : dates[0] ?? ""));
        setExportTo((t) => (t.trim() ? t : dates[dates.length - 1] ?? ""));
      }
    } else setErr(r1.error);
    if (r2.ok) setEmps(r2.data.employees);
    if (r3.ok) setVehs(r3.data.vehicles);
  }

  useEffect(() => {
    void load();
  }, []);

  function closeWizard(): void {
    setWizardOpen(false);
    setVehicleId("");
    setMainEmployeeId("");
    setMeterStart("");
    setMeterEnd("");
  }

  async function submitReport(): Promise<void> {
    setErr(null);
    setSubmitting(true);
    try {
      const r = await apiFetch<DR>("/daily-reports", {
        method: "POST",
        json: {
          vehicleId,
          mainEmployeeId,
          meterStart: Number(meterStart),
          meterEnd: Number(meterEnd),
        },
      });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      closeWizard();
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  const vehOk = Boolean(vehicleId);
  const empOk = Boolean(mainEmployeeId);
  const msOk = meterStart.trim() !== "" && !Number.isNaN(Number(meterStart));
  const meOk = meterEnd.trim() !== "" && !Number.isNaN(Number(meterEnd));
  const metersOk = msOk && meOk && Number(meterEnd) >= Number(meterStart);

  const vehLabel = vehs.find((v) => v.id === vehicleId)?.label;
  const drvLabel = emps.find((e) => e.id === mainEmployeeId);

  const steps: StepWizardStep[] = [
    {
      id: "veh",
      title: "車両を選んでください",
      description: "この日報に紐づく車両です。",
      canProceed: vehOk,
      children: (
        <>
          <label>車両</label>
          <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} autoFocus>
            <option value="">選択</option>
            {vehs.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </>
      ),
    },
    {
      id: "drv",
      title: "主ドライバーを選んでください",
      canProceed: empOk,
      children: (
        <>
          <label>主ドライバー</label>
          <select value={mainEmployeeId} onChange={(e) => setMainEmployeeId(e.target.value)}>
            <option value="">選択</option>
            {emps.map((x) => (
              <option key={x.id} value={x.id}>
                {x.familyName} {x.givenName}
              </option>
            ))}
          </select>
        </>
      ),
    },
    {
      id: "meter",
      title: "メーター値を入力してください",
      description: "開始と終了を入力します。終了は開始以上である必要があります。",
      canProceed: metersOk,
      children: (
        <>
          <label>メーター開始</label>
          <input value={meterStart} onChange={(e) => setMeterStart(e.target.value)} inputMode="numeric" />
          <label>メーター終了</label>
          <input value={meterEnd} onChange={(e) => setMeterEnd(e.target.value)} inputMode="numeric" />
        </>
      ),
    },
    {
      id: "confirm",
      title: "内容を確認してください",
      canProceed: vehOk && empOk && metersOk,
      children: (
        <dl className="step-wizard-summary">
          <dt>車両</dt>
          <dd>{vehLabel ?? "—"}</dd>
          <dt>主ドライバー</dt>
          <dd>{drvLabel ? `${drvLabel.familyName} ${drvLabel.givenName}` : "—"}</dd>
          <dt>メーター</dt>
          <dd>
            {meterStart} → {meterEnd}
          </dd>
        </dl>
      ),
    },
  ];

  async function downloadBulkCsv(): Promise<void> {
    if (!exportFrom.trim() || !exportTo.trim()) {
      setErr("一括CSV: 開始日・終了日を入力してください");
      return;
    }
    setErr(null);
    const q = `?from=${encodeURIComponent(exportFrom.trim())}&to=${encodeURIComponent(exportTo.trim())}&officialOnly=${
      exportOfficialOnly ? "1" : "0"
    }`;
    const r = await apiFetchBlob(`/daily-reports/export-range.csv${q}`);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(r.blob);
    a.download = r.filename || `daily-reports-${exportFrom}_${exportTo}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function openBulkPrint(): Promise<void> {
    if (!exportFrom.trim() || !exportTo.trim()) {
      setErr("一括印刷: 開始日・終了日を入力してください");
      return;
    }
    setErr(null);
    const token = getAccessToken();
    const q = `?from=${encodeURIComponent(exportFrom.trim())}&to=${encodeURIComponent(exportTo.trim())}&officialOnly=${
      exportOfficialOnly ? "1" : "0"
    }`;
    const res = await fetch(`/api/v1/daily-reports/export-range.html${q}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const html = await res.text();
    const w = window.open("");
    if (w) {
      w.document.write(html);
      w.document.close();
      w.focus();
    }
  }

  return (
    <Card title="日報">
      <Err msg={err} />
      <p style={{ marginTop: 0 }}>
        <button type="button" onClick={() => setWizardOpen(true)}>
          日報を作成
        </button>
      </p>
      <StepWizard
        open={wizardOpen}
        onClose={closeWizard}
        title="日報を作成"
        steps={steps}
        finishLabel="日報作成"
        onFinish={submitReport}
        isSubmitting={submitting}
      />
      <div className="table-wrap" style={{ marginTop: "0.75rem" }}>
        <table>
          <thead>
            <tr>
              <th>日付</th>
              <th>運行</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.businessDate}</td>
                <td>{r.trips.length} 件</td>
                <td>
                  <Link to={`/daily-reports/${r.id}`}>開く</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 style={{ marginTop: "1.25rem", fontSize: "1.1rem" }}>期間一括（CSV / 印刷HTML）</h2>
      <p style={{ fontSize: "0.9rem", opacity: 0.9 }}>事業日 YYYY-MM-DD で期間を指定し、公式のみまたは全件で書き出します。</p>
      <label>
        開始日
        <input value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} placeholder="2026-05-01" />
      </label>
      <label>
        終了日
        <input value={exportTo} onChange={(e) => setExportTo(e.target.value)} placeholder="2026-05-31" />
      </label>
      <label>
        <input type="checkbox" checked={exportOfficialOnly} onChange={(e) => setExportOfficialOnly(e.target.checked)} />{" "}
        公式対象のみ
      </label>
      <p>
        <button type="button" onClick={() => void downloadBulkCsv()}>
          一括CSV
        </button>{" "}
        <button type="button" onClick={() => void openBulkPrint()}>
          一括印刷HTML
        </button>
      </p>
    </Card>
  );
}

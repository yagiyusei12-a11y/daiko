import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "../api";
import { Card, Err } from "../ui";

type ReportRow = {
  id: string;
  businessDate: string;
  meterStart: number;
  meterEnd: number;
};

export default function DailyReportsMenuPage(): JSX.Element {
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [vehicles, setVehicles] = useState<{ id: string; label: string }[]>([]);
  const [employees, setEmployees] = useState<{ id: string; familyName: string; givenName: string }[]>([]);
  const [businessDate, setBusinessDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [vehicleId, setVehicleId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [meterStart, setMeterStart] = useState(0);
  const [meterEnd, setMeterEnd] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [r1, r2, r3] = await Promise.all([
      apiFetch<{ reports: ReportRow[] }>("/daily-reports"),
      apiFetch<{ vehicles: { id: string; label: string }[] }>("/settings/vehicles"),
      apiFetch<{ employees: { id: string; familyName: string; givenName: string }[] }>("/settings/employees"),
    ]);
    if (r1.ok) setReports(r1.data.reports);
    else setErr(r1.error);
    if (r2.ok) {
      setVehicles(r2.data.vehicles);
      setVehicleId((v) => v || r2.data.vehicles[0]?.id || "");
    }
    if (r3.ok) {
      setEmployees(r3.data.employees);
      setEmployeeId((e) => e || r3.data.employees[0]?.id || "");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(): Promise<void> {
    if (!vehicleId || !employeeId) {
      setErr("車両と乗務員を選んでください");
      return;
    }
    setBusy(true);
    setErr(null);
    const r = await apiFetch<{ id: string }>("/daily-reports", {
      method: "POST",
      json: { businessDate, vehicleId, mainEmployeeId: employeeId, meterStart, meterEnd },
    });
    setBusy(false);
    if (!r.ok) setErr(r.error);
    else nav(`/daily-reports/${r.data.id}`);
  }

  return (
    <Card title="日報">
      <Err msg={err} />
      <p className="settings-hint">新規作成後、運行ごとに迎車・左ハンドル等の付帯料金を入力できます（設定の基本額が初期値）。</p>
      <div className="settings-form" style={{ maxWidth: "28rem" }}>
        <label>事業日</label>
        <input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
        <label>車両</label>
        <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
          <option value="">選択</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
        <label>乗務（主）</label>
        <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">選択</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.familyName} {e.givenName}
            </option>
          ))}
        </select>
        <label>メーター始</label>
        <input type="number" min={0} value={meterStart} onChange={(e) => setMeterStart(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
        <label>メーター終</label>
        <input type="number" min={0} value={meterEnd} onChange={(e) => setMeterEnd(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
        <button type="button" className="settings-primary" disabled={busy} onClick={() => void create()}>
          日報を作成
        </button>
      </div>
      <h3 className="card-title" style={{ marginTop: "1.25rem", fontSize: "1rem" }}>
        最近の日報
      </h3>
      <ul className="settings-list">
        {reports.map((r) => (
          <li key={r.id}>
            <Link className="settings-list-btn" to={`/daily-reports/${r.id}`} style={{ textDecoration: "none", color: "inherit" }}>
              {r.businessDate}
              <span className="settings-list-meta">
                メーター {r.meterStart}→{r.meterEnd}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

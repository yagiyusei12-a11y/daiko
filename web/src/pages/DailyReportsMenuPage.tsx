import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "../api";
import { Card, Err } from "../ui";

function tokyoTodayYmd(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date()).slice(0, 10);
}

type ReportRow = {
  id: string;
  businessDate: string;
  meterStart: number;
  meterEnd: number;
  vehicleLabel: string;
  mainEmployeeName: string;
};

export default function DailyReportsMenuPage(): JSX.Element {
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [vehicles, setVehicles] = useState<{ id: string; label: string }[]>([]);
  const [employees, setEmployees] = useState<{ id: string; familyName: string; givenName: string }[]>([]);
  const [businessDate, setBusinessDate] = useState(tokyoTodayYmd);
  const [vehicleId, setVehicleId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [meterStart, setMeterStart] = useState(0);
  const [meterEnd, setMeterEnd] = useState(0);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    const [r1, r2, r3] = await Promise.all([
      apiFetch<{ reports: ReportRow[] }>(`/daily-reports?businessDate=${encodeURIComponent(businessDate)}`),
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
  }, [businessDate]);

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
    else {
      setCreateOpen(false);
      nav(`/daily-reports/${r.data.id}`);
    }
  }

  return (
    <Card title="日報">
      <Err msg={err} />
      <div className="settings-section-panel" style={{ marginBottom: "1rem" }}>
        <div className="settings-form" style={{ maxWidth: "28rem", marginBottom: 0 }}>
          <label htmlFor="dr-list-date">表示する事業日</label>
          <input id="dr-list-date" type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
          <p className="settings-hint" style={{ marginTop: "0.35rem" }}>
            選択した日の日報だけを一覧します。新規作成時の事業日もこの日付が使われます。
          </p>
        </div>
      </div>

      <div className="settings-toolbar" style={{ marginBottom: "0.75rem" }}>
        <button type="button" className="settings-primary" onClick={() => setCreateOpen(true)}>
          日報を作成
        </button>
      </div>

      <div className="settings-section-panel">
        <h3 className="settings-subtitle" style={{ marginTop: 0 }}>
          {businessDate} の日報
        </h3>
        {reports.length === 0 ? (
          <p className="settings-hint">この日の日報はまだありません。</p>
        ) : (
          <ul className="settings-list">
            {reports.map((r) => (
              <li key={r.id}>
                <Link className="settings-list-btn" to={`/daily-reports/${r.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                  <span>
                    {r.vehicleLabel} / {r.mainEmployeeName}
                  </span>
                  <span className="settings-list-meta">
                    メーター {r.meterStart}→{r.meterEnd}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {createOpen ? (
        <div
          className="pricing-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setCreateOpen(false);
          }}
        >
          <div
            className="pricing-modal attend-shift-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dr-create-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="dr-create-title" className="pricing-modal-title">
              日報を作成
            </h2>
            <div className="attend-shift-dialog-scroll">
              <p className="settings-hint">
                作成後、運行ごとに迎車・左ハンドル等の付帯料金を入力できます（設定の基本額が初期値）。ペア・随伴車・GPS などの詳細ウィザードは順次拡張予定です。
              </p>
              <div className="settings-form">
                <label htmlFor="dr-create-date">事業日</label>
                <input id="dr-create-date" type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
                <label htmlFor="dr-create-veh">車両</label>
                <select id="dr-create-veh" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                  <option value="">選択</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
                <label htmlFor="dr-create-emp">乗務（主）</label>
                <select id="dr-create-emp" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                  <option value="">選択</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.familyName} {e.givenName}
                    </option>
                  ))}
                </select>
                <label htmlFor="dr-create-ms">メーター始</label>
                <input
                  id="dr-create-ms"
                  type="number"
                  min={0}
                  value={meterStart}
                  onChange={(e) => setMeterStart(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                />
                <label htmlFor="dr-create-me">メーター終</label>
                <input
                  id="dr-create-me"
                  type="number"
                  min={0}
                  value={meterEnd}
                  onChange={(e) => setMeterEnd(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                />
              </div>
            </div>
            <div className="pricing-modal-actions">
              <button type="button" className="settings-primary" disabled={busy} onClick={() => void create()}>
                作成して開く
              </button>
              <button type="button" onClick={() => setCreateOpen(false)}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

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
  mainEmployeeName: string;
};

export default function DailyReportsMenuPage(): JSX.Element {
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [vehicles, setVehicles] = useState<{ id: string; label: string }[]>([]);
  const [employees, setEmployees] = useState<{ id: string; familyName: string; givenName: string }[]>([]);
  const [businessDate, setBusinessDate] = useState(tokyoTodayYmd);
  const [employeeId, setEmployeeId] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [escortVehicleId, setEscortVehicleId] = useState("");
  const [escortOdoStart, setEscortOdoStart] = useState(0);
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
    if (r2.ok) setVehicles(r2.data.vehicles);
    if (r3.ok) {
      setEmployees(r3.data.employees);
      setEmployeeId((e) => e || r3.data.employees[0]?.id || "");
    }
  }, [businessDate]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(): Promise<void> {
    if (!employeeId) {
      setErr("乗務（主）を選んでください");
      return;
    }
    setBusy(true);
    setErr(null);
    const r = await apiFetch<{ id: string }>("/daily-reports", {
      method: "POST",
      json: {
        businessDate,
        mainEmployeeId: employeeId,
        partnerEmployeeId: partnerId || undefined,
        escortVehicleId: escortVehicleId || undefined,
        escortOdometerStartM: escortVehicleId ? escortOdoStart : undefined,
      },
    });
    setBusy(false);
    if (!r.ok) setErr(r.error);
    else {
      setCreateOpen(false);
      nav(`/daily-reports/${r.data.id}`);
    }
  }

  async function deleteReport(reportId: string, mainName: string): Promise<void> {
    if (!window.confirm(`「${mainName}」の日報を削除しますか？\n運行データもすべて失われます。`)) return;
    setBusy(true);
    setErr(null);
    const r = await apiFetch(`/daily-reports/${reportId}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) setErr(r.error);
    else void load();
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
              <li key={r.id} className="settings-list-item-split">
                <Link className="settings-list-btn" to={`/daily-reports/${r.id}`} style={{ textDecoration: "none", color: "inherit", flex: 1 }}>
                  <span>{r.mainEmployeeName}</span>
                  <span className="settings-list-meta">
                    メーター {r.meterStart}→{r.meterEnd}
                  </span>
                </Link>
                <button
                  type="button"
                  className="settings-secondary settings-list-delete-btn"
                  disabled={busy}
                  aria-label={`${r.mainEmployeeName}の日報を削除`}
                  onClick={() => void deleteReport(r.id, r.mainEmployeeName)}
                >
                  削除
                </button>
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
                作成後に日報詳細で勤務セッション（ペア・随伴車・ODO）と運行を入力します。ここで先にペア等を入れても構いません。
              </p>
              <div className="settings-form">
                <label htmlFor="dr-create-date">事業日</label>
                <input id="dr-create-date" type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
                <label htmlFor="dr-create-emp">乗務（主）</label>
                <select id="dr-create-emp" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                  <option value="">選択</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.familyName} {e.givenName}
                    </option>
                  ))}
                </select>
                <label htmlFor="dr-create-partner">ペア（任意）</label>
                <select
                  id="dr-create-partner"
                  value={partnerId}
                  onChange={(e) => setPartnerId(e.target.value)}
                >
                  <option value="">未設定</option>
                  {employees
                    .filter((e) => e.id !== employeeId)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.familyName} {e.givenName}
                      </option>
                    ))}
                </select>
                <label htmlFor="dr-create-escort">随伴車（任意）</label>
                <select id="dr-create-escort" value={escortVehicleId} onChange={(e) => setEscortVehicleId(e.target.value)}>
                  <option value="">未設定</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
                <label htmlFor="dr-create-escort-odo">随伴車ODO開始（任意）</label>
                <input
                  id="dr-create-escort-odo"
                  type="number"
                  min={0}
                  disabled={!escortVehicleId}
                  value={escortOdoStart}
                  onChange={(e) => setEscortOdoStart(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
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

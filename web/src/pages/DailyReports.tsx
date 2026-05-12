import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, apiFetchBlob, getAccessToken } from "../api";
import { Card, Err, FieldWithHint, StepWizard, Tabs, type StepWizardStep } from "../ui";

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
  const [mainTab, setMainTab] = useState<"list" | "bulk">("list");

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
      title: "使う車を選ぶ",
      description: "この日の記録に紐づく車両を選びます。ナンバーが分かりやすい名前を選んでください。",
      canProceed: vehOk,
      children: (
        <>
          <FieldWithHint label="車両" hint="「車両」画面で登録した名前が並びます。どれで業務をしたか選びます。">
            <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} autoFocus>
              <option value="">選んでください</option>
              {vehs.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </FieldWithHint>
        </>
      ),
    },
    {
      id: "drv",
      title: "運転する人（メイン）",
      description: "その日の運転の中心になるスタッフを選びます。同乗の人はあとから記録画面で足せます。",
      canProceed: empOk,
      children: (
        <>
          <FieldWithHint label="メインのドライバー" hint="ハンドルを握る方を選びます。">
            <select value={mainEmployeeId} onChange={(e) => setMainEmployeeId(e.target.value)}>
              <option value="">選んでください</option>
              {emps.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.familyName} {x.givenName}
                </option>
              ))}
            </select>
          </FieldWithHint>
        </>
      ),
    },
    {
      id: "meter",
      title: "タクシーメーターの数字",
      description: "業務の始まりと終わりでメーターに出ていた数字を、そのまま入力します。終わりの数字は、始まり以上である必要があります。",
      canProceed: metersOk,
      children: (
        <>
          <FieldWithHint label="始業時のメーター" hint="出庫してメーターを合わせたあとの数字です。">
            <input value={meterStart} onChange={(e) => setMeterStart(e.target.value)} inputMode="numeric" />
          </FieldWithHint>
          <FieldWithHint label="終業時のメーター" hint="帰庫する直前の数字です。始めの数字より小さくならないようにしてください。">
            <input value={meterEnd} onChange={(e) => setMeterEnd(e.target.value)} inputMode="numeric" />
          </FieldWithHint>
        </>
      ),
    },
    {
      id: "confirm",
      title: "入力内容の確認",
      canProceed: vehOk && empOk && metersOk,
      children: (
        <dl className="step-wizard-summary">
          <dt>車両</dt>
          <dd>{vehLabel ?? "—"}</dd>
          <dt>メインのドライバー</dt>
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
      setErr("期間の始まりと終わりの日付を両方入れてください。");
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
      setErr("期間の始まりと終わりの日付を両方入れてください。");
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
    <Card title="業務の記録（1日ごと）">
      <Err msg={err} />
      <p style={{ marginTop: 0, fontSize: "0.88rem", color: "var(--color-muted)" }}>
        送迎の内容やお支払いのメモを、日ごとにまとめます。まずは「この日の記録を始める」から登録してください。
      </p>
      <p style={{ marginTop: "0.5rem" }}>
        <button type="button" onClick={() => setWizardOpen(true)}>
          この日の記録を始める（ウィザード）
        </button>
      </p>
      <StepWizard
        open={wizardOpen}
        onClose={closeWizard}
        title="この日の記録を始める"
        steps={steps}
        finishLabel="記録を作成する"
        onFinish={submitReport}
        isSubmitting={submitting}
      />

      <Tabs
        aria-label="業務の記録"
        activeId={mainTab}
        onActiveChange={(id) => setMainTab(id as "list" | "bulk")}
        items={[
          {
            id: "list",
            label: "一覧",
            children: (
              <div className="table-wrap" style={{ marginTop: "0.75rem" }}>
                <table>
                  <thead>
                    <tr>
                      <th>日付</th>
                      <th>送迎の件数</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td>{r.businessDate}</td>
                        <td>{r.trips.length} 件</td>
                        <td>
                          <Link to={`/daily-reports/${r.id}`}>詳細を開く</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ),
          },
          {
            id: "bulk",
            label: "まとめて書き出し",
            children: (
              <div style={{ marginTop: "0.75rem" }}>
                <p style={{ fontSize: "0.88rem", color: "var(--color-muted)", marginTop: 0 }}>
                  カレンダー上の「事業日」を yyyy-mm-dd の形で入れます。チェックを入れると、社内向けに隠していた送迎はファイルに含めません。
                </p>
                <FieldWithHint label="始めの日" hint="まとめたい期間の、最初の日（例: 2026-05-01）">
                  <input value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} placeholder="2026-05-01" />
                </FieldWithHint>
                <FieldWithHint label="終わりの日" hint="期間の最後の日（例: 2026-05-31）">
                  <input value={exportTo} onChange={(e) => setExportTo(e.target.value)} placeholder="2026-05-31" />
                </FieldWithHint>
                <label>
                  <input type="checkbox" checked={exportOfficialOnly} onChange={(e) => setExportOfficialOnly(e.target.checked)} />{" "}
                  外部に出す資料向けだけにする
                </label>
                <p>
                  <button type="button" onClick={() => void downloadBulkCsv()}>
                    表計算用（CSV）をまとめて保存
                  </button>{" "}
                  <button type="button" onClick={() => void openBulkPrint()}>
                    印刷用ページをまとめて開く
                  </button>
                </p>
              </div>
            ),
          },
        ]}
      />
    </Card>
  );
}

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch, apiFetchBlob, getAccessToken } from "../api";
import { useAuth, isStaffShiftOnlyMe } from "../auth";
import {
  clearShiftDailyReportSession,
  loadShiftDailyReportSession,
  saveShiftDailyReportSession,
} from "../lib/shiftDailyReportSession";
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
  const { me } = useAuth();
  const navigate = useNavigate();
  const staffOnly = Boolean(me && isStaffShiftOnlyMe(me.permissions));
  const [rows, setRows] = useState<DR[]>([]);
  const [emps, setEmps] = useState<Emp[]>([]);
  const [vehs, setVehs] = useState<Veh[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [mainEmployeeId, setMainEmployeeId] = useState("");
  const [partnerEmployeeId, setPartnerEmployeeId] = useState("");
  /** スタッフ向け: ペアの従業員（自分以外） */
  const [staffPartnerPickId, setStaffPartnerPickId] = useState("");
  /** スタッフ向け: true のときペアが主運転（自分は同乗） */
  const [pairDrivesEscort, setPairDrivesEscort] = useState(false);
  const [meterStart, setMeterStart] = useState("");
  const [meterEnd, setMeterEnd] = useState("");
  /** 作成直後: 業務続行の確認 */
  const [postCreateReportId, setPostCreateReportId] = useState<string | null>(null);
  /** いいえ選択後: 終了メーター入力 */
  const [endShiftReportId, setEndShiftReportId] = useState<string | null>(null);
  const [finalMeterEnd, setFinalMeterEnd] = useState("");
  const [endShiftSubmitting, setEndShiftSubmitting] = useState(false);

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

  useEffect(() => {
    if (!wizardOpen || !me) return;
    if (staffOnly && me.employeeId) setMainEmployeeId(me.employeeId);
    const s = loadShiftDailyReportSession(me.tenant.id, me.id);
    if (!s) return;
    setVehicleId(s.vehicleId);
    if (staffOnly && me.employeeId) {
      if (s.mainEmployeeId === me.employeeId) {
        setPairDrivesEscort(false);
        setStaffPartnerPickId(s.partnerEmployeeId && s.partnerEmployeeId !== me.employeeId ? s.partnerEmployeeId : "");
      } else {
        setPairDrivesEscort(true);
        setStaffPartnerPickId(s.mainEmployeeId);
      }
    } else {
      setMainEmployeeId(s.mainEmployeeId);
      setPartnerEmployeeId(s.partnerEmployeeId);
    }
  }, [wizardOpen, me, staffOnly]);

  function closeWizard(): void {
    setWizardOpen(false);
    setVehicleId("");
    setMainEmployeeId("");
    setPartnerEmployeeId("");
    setStaffPartnerPickId("");
    setPairDrivesEscort(false);
    setMeterStart("");
    setMeterEnd("");
  }

  function effectiveCreateMainPartner(): { mainId: string; partnerId: string | null } {
    if (staffOnly && me?.employeeId) {
      if (pairDrivesEscort) {
        if (!staffPartnerPickId) return { mainId: "", partnerId: null };
        return { mainId: staffPartnerPickId, partnerId: me.employeeId };
      }
      const pid = staffPartnerPickId && staffPartnerPickId !== me.employeeId ? staffPartnerPickId : null;
      return { mainId: me.employeeId, partnerId: pid };
    }
    const pid = partnerEmployeeId && partnerEmployeeId !== mainEmployeeId ? partnerEmployeeId : null;
    return { mainId: mainEmployeeId, partnerId: pid };
  }

  async function submitReport(): Promise<void> {
    setErr(null);
    setSubmitting(true);
    try {
      const { mainId, partnerId } = effectiveCreateMainPartner();
      if (!mainId) {
        setErr("主ドライバーを指定してください");
        return;
      }
      if (staffOnly && pairDrivesEscort && !staffPartnerPickId) {
        setErr("ペアが運転する場合は、運転する従業員を選んでください");
        return;
      }
      const json: Record<string, unknown> = {
        vehicleId,
        mainEmployeeId: mainId,
        meterStart: Number(meterStart),
        meterEnd: Number(meterEnd),
      };
      if (partnerId) json.partnerEmployeeId = partnerId;
      const r = await apiFetch<DR>("/daily-reports", {
        method: "POST",
        json,
      });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      if (me) {
        saveShiftDailyReportSession(me.tenant.id, me.id, {
          vehicleId,
          mainEmployeeId: mainId,
          partnerEmployeeId: partnerId ?? "",
        });
      }
      setPostCreateReportId(r.data.id);
      closeWizard();
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  async function applyFinalMeterAndGoToWorkflow(): Promise<void> {
    if (!me || !endShiftReportId) return;
    const meNum = Math.floor(Number(finalMeterEnd));
    if (!Number.isFinite(meNum)) {
      setErr("メーター終了を数値で入力してください");
      return;
    }
    setErr(null);
    setEndShiftSubmitting(true);
    try {
      const r = await apiFetch(`/daily-reports/${endShiftReportId}`, {
        method: "PATCH",
        json: { meterEnd: meNum },
      });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      clearShiftDailyReportSession(me.tenant.id, me.id);
      setEndShiftReportId(null);
      setFinalMeterEnd("");
      await load();
      navigate("/workflow");
    } finally {
      setEndShiftSubmitting(false);
    }
  }

  const vehOk = Boolean(vehicleId);
  const { mainId: effMain, partnerId: effPartner } = effectiveCreateMainPartner();
  const empOk = staffOnly ? Boolean(me?.employeeId && (!pairDrivesEscort || Boolean(staffPartnerPickId))) : Boolean(effMain);
  const msOk = meterStart.trim() !== "" && !Number.isNaN(Number(meterStart));
  const meOk = meterEnd.trim() !== "" && !Number.isNaN(Number(meterEnd));
  const metersOk = msOk && meOk && Number(meterEnd) >= Number(meterStart);

  const vehLabel = vehs.find((v) => v.id === vehicleId)?.label;
  const mainLabel = emps.find((e) => e.id === effMain);
  const partnerLabel = effPartner ? emps.find((e) => e.id === effPartner) : null;

  const steps: StepWizardStep[] = [
    {
      id: "veh",
      title: "随伴車を選んでください",
      description: "この日報に紐づく車両です。前回と同じ勤務ならそのまま進めます。",
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
          <p style={{ marginTop: "0.5rem" }}>
            <button type="button" onClick={() => setVehicleId("")}>
              随伴車を変更（選択をクリア）
            </button>
          </p>
        </>
      ),
    },
    {
      id: "drv",
      title: staffOnly ? "ペアと運転の役割" : "主ドライバーを選んでください",
      canProceed: empOk,
      children: staffOnly && me?.employeeId ? (
        <>
          <p style={{ marginTop: 0, fontSize: "0.95rem" }}>
            あなた: <strong>{emps.find((e) => e.id === me.employeeId)?.familyName ?? ""}</strong>{" "}
            {emps.find((e) => e.id === me.employeeId)?.givenName ?? ""}
          </p>
          <fieldset style={{ marginTop: "0.75rem", border: "1px solid #ccc", padding: "0.5rem 0.75rem" }}>
            <legend style={{ fontSize: "0.9rem" }}>誰が随伴車を運転しますか？</legend>
            <label style={{ display: "block", marginTop: "0.25rem" }}>
              <input type="radio" name="pairDrive" checked={!pairDrivesEscort} onChange={() => setPairDrivesEscort(false)} />{" "}
              自分（主ドライバー）
            </label>
            <label style={{ display: "block", marginTop: "0.35rem" }}>
              <input type="radio" name="pairDrive" checked={pairDrivesEscort} onChange={() => setPairDrivesEscort(true)} />{" "}
              ペア（自分は乗務員・同乗）
            </label>
          </fieldset>
          <label style={{ display: "block", marginTop: "0.75rem" }}>
            {pairDrivesEscort ? "運転するペア（必須）" : "同乗するペア（任意）"}
          </label>
          <select value={staffPartnerPickId} onChange={(e) => setStaffPartnerPickId(e.target.value)}>
            <option value="">{pairDrivesEscort ? "選択してください" : "なし"}</option>
            {emps
              .filter((x) => x.id !== me.employeeId)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.familyName} {x.givenName}
                </option>
              ))}
          </select>
          <p style={{ marginTop: "0.5rem" }}>
            <button type="button" onClick={() => setStaffPartnerPickId("")}>
              ペアを変更（選択をクリア）
            </button>
          </p>
        </>
      ) : (
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
          <label style={{ display: "block", marginTop: "0.75rem" }}>同乗者（任意・乗務記録の同伴欄）</label>
          <select value={partnerEmployeeId} onChange={(e) => setPartnerEmployeeId(e.target.value)}>
            <option value="">なし</option>
            {emps
              .filter((x) => x.id !== mainEmployeeId)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.familyName} {x.givenName}
                </option>
              ))}
          </select>
          <p style={{ marginTop: "0.5rem" }}>
            <button type="button" onClick={() => setPartnerEmployeeId("")}>
              ペアを変更（同乗者をクリア）
            </button>
          </p>
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
          <dd>{mainLabel ? `${mainLabel.familyName} ${mainLabel.givenName}` : "—"}</dd>
          <dt>同乗者</dt>
          <dd>
            {partnerLabel ? `${partnerLabel.familyName} ${partnerLabel.givenName}` : "—"}
          </dd>
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
      {postCreateReportId ? (
        <div
          role="dialog"
          aria-labelledby="shift-continue-title"
          style={{
            marginTop: "0.75rem",
            padding: "0.75rem 1rem",
            border: "1px solid #ccc",
            borderRadius: 6,
            background: "#fafafa",
          }}
        >
          <p id="shift-continue-title" style={{ marginTop: 0, fontWeight: 600 }}>
            本日の業務は続きますか？
          </p>
          <p style={{ fontSize: "0.9rem", marginTop: "0.25rem" }}>
            「はい」でこの日報に便を追加します。「いいえ」で随伴車の終了メーターを入力し、タイムカード・酒気確認の画面へ進みます。
          </p>
          <p style={{ marginTop: "0.5rem" }}>
            <button
              type="button"
              onClick={() => {
                const rid = postCreateReportId;
                setPostCreateReportId(null);
                navigate(`/daily-reports/${rid}?addTrip=1`);
              }}
            >
              はい（便を追加）
            </button>{" "}
            <button
              type="button"
              onClick={() => {
                setEndShiftReportId(postCreateReportId);
                setPostCreateReportId(null);
                setFinalMeterEnd("");
              }}
            >
              いいえ（勤務終了へ）
            </button>
          </p>
        </div>
      ) : null}
      {endShiftReportId ? (
        <div
          style={{
            marginTop: "0.75rem",
            padding: "0.75rem 1rem",
            border: "1px solid #ccc",
            borderRadius: 6,
            background: "#fff8f0",
          }}
        >
          <p style={{ marginTop: 0, fontWeight: 600 }}>随伴車のメーター終了（ODO）</p>
          <label>
            メーター終了
            <input value={finalMeterEnd} onChange={(e) => setFinalMeterEnd(e.target.value)} inputMode="numeric" />
          </label>
          <p style={{ marginTop: "0.5rem" }}>
            <button type="button" disabled={endShiftSubmitting} onClick={() => void applyFinalMeterAndGoToWorkflow()}>
              タイムカード・酒気確認へ
            </button>{" "}
            <button
              type="button"
              disabled={endShiftSubmitting}
              onClick={() => {
                setEndShiftReportId(null);
                setFinalMeterEnd("");
              }}
            >
              キャンセル
            </button>
          </p>
        </div>
      ) : null}
      <p style={{ marginTop: postCreateReportId || endShiftReportId ? "0.75rem" : 0 }}>
        <button type="button" onClick={() => setWizardOpen(true)}>
          日報を作成
        </button>{" "}
        <Link to="/daily-reports/run">一画面で日報＋運行を作成</Link>
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

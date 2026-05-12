import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "../api";
import { useAuth, isStaffShiftOnlyMe } from "../auth";
import { geolocationFillInto } from "../lib/reverseGeocode";
import {
  clearShiftDailyReportSession,
  loadShiftDailyReportSession,
  saveShiftDailyReportSession,
} from "../lib/shiftDailyReportSession";
import { Card, Err, StepWizard, type StepWizardStep } from "../ui";

type Emp = { id: string; familyName: string; givenName: string };
type Veh = { id: string; label: string };
type DR = { id: string; businessDate: string };
type Ver = { id: string; version: number; planId: string };
type PlansRes = { plans: { id: string; versions: Ver[] }[] };

type VehCtx = {
  businessDate: string;
  reportsTodayWithVehicle: number;
  isFirstVehicleUseToday: boolean;
  lastClosingMeterEnd: number | null;
  lastReportBusinessDate: string | null;
};

function nowDatetimeLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeLocalToIso(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  const d = new Date(t);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export default function DailyReportRunWizard(): JSX.Element {
  const { me } = useAuth();
  const navigate = useNavigate();
  const staffOnly = Boolean(me && isStaffShiftOnlyMe(me.permissions));
  const [emps, setEmps] = useState<Emp[]>([]);
  const [vehs, setVehs] = useState<Veh[]>([]);
  const [versions, setVersions] = useState<Ver[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [vehCtx, setVehCtx] = useState<VehCtx | null>(null);
  const [mainEmployeeId, setMainEmployeeId] = useState("");
  const [partnerEmployeeId, setPartnerEmployeeId] = useState("");
  const [staffPartnerPickId, setStaffPartnerPickId] = useState("");
  const [pairDrivesEscort, setPairDrivesEscort] = useState(false);
  const [meterStart, setMeterStart] = useState("");
  const [meterEnd, setMeterEnd] = useState("");
  const [clientName, setClientName] = useState("");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [viaNote, setViaNote] = useState("");
  const [charterVehicleNo, setCharterVehicleNo] = useState("");
  const [departedAtLocal, setDepartedAtLocal] = useState("");
  const [arrivedAtLocal, setArrivedAtLocal] = useState("");
  const [distanceM, setDistanceM] = useState("3000");
  const [waitingMinutes, setWaitingMinutes] = useState("0");
  const [tariffVersionId, setTariffVersionId] = useState("");
  const [parkingAdvanceYen, setParkingAdvanceYen] = useState("0");
  const [tripMeterStartM, setTripMeterStartM] = useState("");
  const [tripMeterEndM, setTripMeterEndM] = useState("");
  const [postCreateReportId, setPostCreateReportId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [r2, r3, rp] = await Promise.all([
        apiFetch<{ employees: Emp[] }>("/employees"),
        apiFetch<{ vehicles: Veh[] }>("/vehicles"),
        apiFetch<PlansRes>("/tariff-plans?versionsLimit=50"),
      ]);
      if (r2.ok) setEmps(r2.data.employees);
      if (r3.ok) setVehs(r3.data.vehicles);
      if (rp.ok) {
        const vers = rp.data.plans.flatMap((p) => p.versions);
        setVersions(vers);
        setTariffVersionId((tid) => tid || (vers[0]?.id ?? ""));
      }
    })();
  }, []);

  useEffect(() => {
    if (staffOnly && me?.employeeId) setMainEmployeeId(me.employeeId);
  }, [staffOnly, me?.employeeId]);

  useEffect(() => {
    if (!me || !wizardOpen) return;
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
  }, [me, wizardOpen, staffOnly]);

  useEffect(() => {
    if (!vehicleId || !me) {
      setVehCtx(null);
      return;
    }
    void (async () => {
      const r = await apiFetch<VehCtx>(
        `/daily-reports/vehicle-day-context?vehicleId=${encodeURIComponent(vehicleId)}`,
      );
      if (r.ok) setVehCtx(r.data);
      else setVehCtx(null);
    })();
  }, [vehicleId, me]);

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

  const { mainId: effMain, partnerId: effPartner } = effectiveCreateMainPartner();
  const vehOk = Boolean(vehicleId);
  const empOk = staffOnly ? Boolean(me?.employeeId && (!pairDrivesEscort || Boolean(staffPartnerPickId))) : Boolean(effMain);
  const msOk = meterStart.trim() !== "" && !Number.isNaN(Number(meterStart));
  const meOk = meterEnd.trim() !== "" && !Number.isNaN(Number(meterEnd));
  const metersOk = msOk && meOk && Number(meterEnd) >= Number(meterStart);
  const routeOk = clientName.trim().length > 0 && origin.trim().length > 0 && destination.trim().length > 0;
  const depIso = datetimeLocalToIso(departedAtLocal);
  const arrIso = datetimeLocalToIso(arrivedAtLocal);
  const timesOk = Boolean(depIso && arrIso && new Date(depIso) < new Date(arrIso));
  const distOk = distanceM.trim() !== "" && !Number.isNaN(Number(distanceM));

  async function submitAll(): Promise<void> {
    if (!me) return;
    setErr(null);
    setSubmitting(true);
    try {
      const { mainId, partnerId } = effectiveCreateMainPartner();
      if (!mainId) {
        setErr("主ドライバーを指定してください");
        return;
      }
      if (staffOnly && pairDrivesEscort && !staffPartnerPickId) {
        setErr("ペアが運転する場合は運転者を選んでください");
        return;
      }
      const drJson: Record<string, unknown> = {
        vehicleId,
        mainEmployeeId: mainId,
        meterStart: Number(meterStart),
        meterEnd: Number(meterEnd),
      };
      if (partnerId) drJson.partnerEmployeeId = partnerId;
      const dr = await apiFetch<DR>("/daily-reports", { method: "POST", json: drJson });
      if (!dr.ok) {
        setErr(dr.error);
        return;
      }
      const dep = datetimeLocalToIso(departedAtLocal);
      const arr = datetimeLocalToIso(arrivedAtLocal);
      if (!dep || !arr) {
        setErr("出発・到着の日時を入力してください");
        return;
      }
      const park = Math.max(0, Math.floor(Number(parkingAdvanceYen || 0)));
      const tripJson: Record<string, unknown> = {
        clientName: clientName.trim(),
        origin: origin.trim(),
        destination: destination.trim(),
        departedAt: dep,
        arrivedAt: arr,
        distanceM: Number(distanceM),
        waitingMinutes: Number(waitingMinutes || 0),
        tariffVersionId: tariffVersionId || null,
        parkingAdvanceYen: park,
      };
      if (charterVehicleNo.trim()) tripJson.charterVehicleNo = charterVehicleNo.trim();
      if (viaNote.trim()) tripJson.viaNote = viaNote.trim();
      if (tripMeterStartM.trim() !== "") {
        const t = Math.floor(Number(tripMeterStartM));
        if (Number.isFinite(t)) tripJson.tripMeterStartM = t;
      }
      if (tripMeterEndM.trim() !== "") {
        const t = Math.floor(Number(tripMeterEndM));
        if (Number.isFinite(t)) tripJson.tripMeterEndM = t;
      }
      const tr = await apiFetch(`/daily-reports/${dr.data.id}/trips`, { method: "POST", json: tripJson });
      if (!tr.ok) {
        setErr(tr.error);
        return;
      }
      saveShiftDailyReportSession(me.tenant.id, me.id, {
        vehicleId,
        mainEmployeeId: mainId,
        partnerEmployeeId: partnerId ?? "",
      });
      setWizardOpen(false);
      setPostCreateReportId(dr.data.id);
    } finally {
      setSubmitting(false);
    }
  }

  const mainLabel = emps.find((e) => e.id === effMain);
  const partnerLabel = effPartner ? emps.find((e) => e.id === effPartner) : null;
  const vehLabel = vehs.find((v) => v.id === vehicleId)?.label;

  const steps: StepWizardStep[] = [
    {
      id: "veh",
      title: "随伴車・当日の利用状況",
      description: "車両を選ぶと、本日初めての利用かどうかを表示します。",
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
          {vehCtx ? (
            <p style={{ marginTop: "0.5rem", fontSize: "0.9rem", padding: "0.5rem", background: "#f5f5f5", borderRadius: 4 }}>
              事業日: <strong>{vehCtx.businessDate}</strong>
              <br />
              {vehCtx.isFirstVehicleUseToday ? (
                <>
                  <strong>本日、この随伴車を初めて使用します。</strong>メーター開始は、前回日報の終了メーター以上にしてください。
                  {vehCtx.lastClosingMeterEnd != null ? (
                    <>
                      <br />
                      前回終了メーター目安: <strong>{vehCtx.lastClosingMeterEnd}</strong>（{vehCtx.lastReportBusinessDate ?? "—"}）
                    </>
                  ) : null}
                </>
              ) : (
                <>本日すでにこの車の日報があります（2本目以降）。メーターは前日報の終了以上にしてください。</>
              )}
            </p>
          ) : null}
        </>
      ),
    },
    {
      id: "pair",
      title: "ペアとメーター（日報ヘッダ）",
      canProceed: empOk && metersOk,
      children: staffOnly && me?.employeeId ? (
        <>
          <p style={{ marginTop: 0 }}>
            あなた: <strong>{emps.find((e) => e.id === me.employeeId)?.familyName}</strong>{" "}
            {emps.find((e) => e.id === me.employeeId)?.givenName}
          </p>
          <fieldset style={{ marginTop: "0.5rem", border: "1px solid #ccc", padding: "0.5rem" }}>
            <legend>誰が随伴車を運転しますか？</legend>
            <label>
              <input type="radio" checked={!pairDrivesEscort} onChange={() => setPairDrivesEscort(false)} /> 自分（主）
            </label>
            <label style={{ marginLeft: "1rem" }}>
              <input type="radio" checked={pairDrivesEscort} onChange={() => setPairDrivesEscort(true)} /> ペア（自分は同乗）
            </label>
          </fieldset>
          <label style={{ display: "block", marginTop: "0.5rem" }}>{pairDrivesEscort ? "運転するペア" : "同乗ペア（任意）"}</label>
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
          <label style={{ display: "block", marginTop: "0.75rem" }}>メーター開始</label>
          <input value={meterStart} onChange={(e) => setMeterStart(e.target.value)} inputMode="numeric" />
          <label style={{ display: "block", marginTop: "0.35rem" }}>メーター終了（仮でも可。後から修正可）</label>
          <input value={meterEnd} onChange={(e) => setMeterEnd(e.target.value)} inputMode="numeric" />
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
          <label style={{ display: "block", marginTop: "0.5rem" }}>同乗者（任意）</label>
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
          <label style={{ display: "block", marginTop: "0.75rem" }}>メーター開始</label>
          <input value={meterStart} onChange={(e) => setMeterStart(e.target.value)} inputMode="numeric" />
          <label style={{ display: "block", marginTop: "0.35rem" }}>メーター終了</label>
          <input value={meterEnd} onChange={(e) => setMeterEnd(e.target.value)} inputMode="numeric" />
        </>
      ),
    },
    {
      id: "trip",
      title: "依頼内容と運行",
      canProceed: routeOk && timesOk && distOk,
      children: (
        <>
          <label>依頼者名</label>
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} />
          <label>依頼場所（出発）</label>
          <input value={origin} onChange={(e) => setOrigin(e.target.value)} />
          <button type="button" onClick={() => geolocationFillInto(setOrigin, setErr)}>
            GPSで町名を入力
          </button>
          <label style={{ display: "block", marginTop: "0.5rem" }}>経由地・メモ（任意）</label>
          <input value={viaNote} onChange={(e) => setViaNote(e.target.value)} />
          <button type="button" onClick={() => geolocationFillInto(setViaNote, setErr)}>
            GPSで経由を入力
          </button>
          <label style={{ display: "block", marginTop: "0.5rem" }}>到着地</label>
          <input value={destination} onChange={(e) => setDestination(e.target.value)} />
          <button type="button" onClick={() => geolocationFillInto(setDestination, setErr)}>
            GPSで到着地を入力
          </button>
          <label style={{ display: "block", marginTop: "0.5rem" }}>客車番号（任意）</label>
          <input value={charterVehicleNo} onChange={(e) => setCharterVehicleNo(e.target.value)} placeholder="例: 品川300あ1234" />
          <label style={{ display: "block", marginTop: "0.5rem" }}>出発日時</label>
          <input type="datetime-local" value={departedAtLocal} onChange={(e) => setDepartedAtLocal(e.target.value)} />
          <button type="button" onClick={() => setDepartedAtLocal(nowDatetimeLocal())}>
            出発に現在時刻
          </button>
          <label style={{ display: "block", marginTop: "0.5rem" }}>到着日時</label>
          <input type="datetime-local" value={arrivedAtLocal} onChange={(e) => setArrivedAtLocal(e.target.value)} />
          <button type="button" onClick={() => setArrivedAtLocal(nowDatetimeLocal())}>
            到着に現在時刻
          </button>
          <label style={{ display: "block", marginTop: "0.5rem" }}>運行メーター開始（任意・記録用）</label>
          <input value={tripMeterStartM} onChange={(e) => setTripMeterStartM(e.target.value)} inputMode="numeric" />
          <label style={{ display: "block", marginTop: "0.35rem" }}>運行メーター終了（任意）</label>
          <input value={tripMeterEndM} onChange={(e) => setTripMeterEndM(e.target.value)} inputMode="numeric" />
          <label style={{ display: "block", marginTop: "0.5rem" }}>距離 (m)</label>
          <input value={distanceM} onChange={(e) => setDistanceM(e.target.value)} inputMode="numeric" />
          <label style={{ display: "block", marginTop: "0.35rem" }}>待機 (分)</label>
          <input value={waitingMinutes} onChange={(e) => setWaitingMinutes(e.target.value)} inputMode="numeric" />
          <label style={{ display: "block", marginTop: "0.35rem" }}>料金版（任意）</label>
          <select value={tariffVersionId} onChange={(e) => setTariffVersionId(e.target.value)}>
            <option value="">なし</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version}
              </option>
            ))}
          </select>
          <label style={{ display: "block", marginTop: "0.35rem" }}>駐車場等の立替（円・運賃・売上とは別）</label>
          <input value={parkingAdvanceYen} onChange={(e) => setParkingAdvanceYen(e.target.value)} inputMode="numeric" />
        </>
      ),
    },
    {
      id: "confirm",
      title: "確認",
      canProceed: vehOk && empOk && metersOk && routeOk && timesOk && distOk,
      children: (
        <dl className="step-wizard-summary">
          <dt>車両</dt>
          <dd>{vehLabel ?? "—"}</dd>
          <dt>主／同乗</dt>
          <dd>
            {mainLabel ? `${mainLabel.familyName} ${mainLabel.givenName}` : "—"}
            {partnerLabel ? ` ／ 同乗: ${partnerLabel.familyName} ${partnerLabel.givenName}` : ""}
          </dd>
          <dt>日報メーター</dt>
          <dd>
            {meterStart} → {meterEnd}
          </dd>
          <dt>依頼・区間</dt>
          <dd>
            {clientName} / {origin} → {destination}
          </dd>
          <dt>日時</dt>
          <dd>
            {departedAtLocal} → {arrivedAtLocal}
          </dd>
          <dt>距離・立替</dt>
          <dd>
            {distanceM} m / 立替 {parkingAdvanceYen || "0"} 円
          </dd>
        </dl>
      ),
    },
  ];

  return (
    <Card title="日報＋運行（一画面ウィザード）">
      <Err msg={err} />
      <p style={{ marginTop: 0, fontSize: "0.9rem" }}>
        日報のヘッダ作成と最初の1便を続けて登録します。詳細な割増や名簿連携は{" "}
        <Link to="/daily-reports">日報一覧</Link> から該当日報を開いてください。
      </p>
      <StepWizard
        open={wizardOpen}
        onClose={() => navigate("/daily-reports")}
        title="日報＋運行"
        steps={steps}
        finishLabel="登録する"
        onFinish={submitAll}
        isSubmitting={submitting}
      />
      {postCreateReportId ? (
        <div style={{ marginTop: "1rem", padding: "0.75rem", border: "1px solid #ccc", borderRadius: 6 }}>
          <p style={{ marginTop: 0, fontWeight: 600 }}>登録しました。業務を続けますか？</p>
          <p>
            <Link to={`/daily-reports/${postCreateReportId}?addTrip=1`}>はい（この日報にもう1便）</Link>
            {" · "}
            <Link to="/daily-reports">一覧へ</Link>
            {" · "}
            <Link to="/workflow">勤務（打刻・酒気）</Link>
          </p>
          {me ? (
            <button
              type="button"
              onClick={() => {
                clearShiftDailyReportSession(me.tenant.id, me.id);
                setPostCreateReportId(null);
              }}
            >
              勤務の車両・ペアの記憶をクリア
            </button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

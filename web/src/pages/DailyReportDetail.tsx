import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch, apiFetchBlob, getAccessToken } from "../api";
import { Card, Err, StepWizard, type StepWizardStep } from "../ui";

function isoToDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeLocalToIso(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  const d = new Date(t);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

type Trip = {
  id: string;
  clientName: string;
  charterVehicleNo: string | null;
  origin: string;
  destination: string;
  viaNote: string | null;
  departedAt: string;
  arrivedAt: string;
  role: string;
  fareYen: number;
  distanceM: number;
  waitingMinutes: number;
  tariffVersionId: string | null;
  passengerKind: string;
  viaStopCount: number;
  applyNightSurcharge: boolean;
  applyLeftHandSurcharge: boolean;
  pickupFromBaseM: number | null;
  applyNightSurchargeFlat: boolean;
  applyLateNightFlatYen: boolean;
  applyEarlyMorningFlatYen: boolean;
  applyEarlyRushFlatYen: boolean;
  applyLeftHandSurchargeFlat: boolean;
  customerId: string | null;
  referralSourceId: string | null;
  customer: { id: string; displayName: string } | null;
  referralSource: { id: string; name: string } | null;
  fareOverrideYen: number | null;
  excludeFromOfficialPrint: boolean;
};
type Emp = { id: string; familyName: string; givenName: string };
type VehicleRef = { id: string; label: string; plate: string | null };
type DR = {
  id: string;
  businessDate: string;
  meterStart: number;
  meterEnd: number;
  vehicleId: string;
  vehicle: VehicleRef;
  mainEmployeeId: string;
  mainEmployee: Emp;
  partnerEmployeeId: string | null;
  partnerEmployee: Emp | null;
  dutyStartAt: string | null;
  dutyEndAt: string | null;
  breakTaken: boolean;
  breakStartAt: string | null;
  breakEndAt: string | null;
  breakLocation: string | null;
  trips: Trip[];
  paymentCashYen: number;
  paymentCashNoReceiptYen: number;
  paymentCardYen: number;
  paymentPayPayYen: number;
  paymentReceivableYen: number;
};
type Ver = { id: string; version: number; planId: string };
type PlansRes = { plans: { id: string; versions: Ver[] }[] };
type CustomerRow = {
  id: string;
  displayName: string;
  defaultOrigin: string;
  defaultDestination: string;
  defaultTariffVersionId: string | null;
  specialFareYen: number | null;
};
type ReferralRow = { id: string; name: string };

export default function DailyReportDetail(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [rep, setRep] = useState<DR | null>(null);
  const [versions, setVersions] = useState<Ver[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [tripWizardOpen, setTripWizardOpen] = useState(false);
  const [tripSubmitting, setTripSubmitting] = useState(false);
  const [officialExportOnly, setOfficialExportOnly] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [referralSourceId, setReferralSourceId] = useState("");
  const [fareOverrideYen, setFareOverrideYen] = useState("");
  const [excludeFromOfficialPrint, setExcludeFromOfficialPrint] = useState(false);
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
  const [pickupFromBaseM, setPickupFromBaseM] = useState("");
  const [applyNightSurchargeFlat, setApplyNightSurchargeFlat] = useState(false);
  const [applyLateNightFlatYen, setApplyLateNightFlatYen] = useState(false);
  const [applyEarlyMorningFlatYen, setApplyEarlyMorningFlatYen] = useState(false);
  const [applyEarlyRushFlatYen, setApplyEarlyRushFlatYen] = useState(false);
  const [applyLeftHandSurchargeFlat, setApplyLeftHandSurchargeFlat] = useState(false);
  const [payCash, setPayCash] = useState("0");
  const [payCashNoRcpt, setPayCashNoRcpt] = useState("0");
  const [payCard, setPayCard] = useState("0");
  const [payPayPay, setPayPayPay] = useState("0");
  const [payRecv, setPayRecv] = useState("0");
  const [paySaving, setPaySaving] = useState(false);

  const [employees, setEmployees] = useState<Emp[]>([]);
  const [metaMeterStart, setMetaMeterStart] = useState("");
  const [metaMeterEnd, setMetaMeterEnd] = useState("");
  const [metaPartnerEmployeeId, setMetaPartnerEmployeeId] = useState("");
  const [dutyStartLocal, setDutyStartLocal] = useState("");
  const [dutyEndLocal, setDutyEndLocal] = useState("");
  const [breakTaken, setBreakTaken] = useState(false);
  const [breakStartLocal, setBreakStartLocal] = useState("");
  const [breakEndLocal, setBreakEndLocal] = useState("");
  const [breakLocationStr, setBreakLocationStr] = useState("");
  const [metaSaving, setMetaSaving] = useState(false);

  const [departedAtLocal, setDepartedAtLocal] = useState("");
  const [arrivedAtLocal, setArrivedAtLocal] = useState("");
  const [charterVehicleNo, setCharterVehicleNo] = useState("");
  const [viaNote, setViaNote] = useState("");
  const [tripRole, setTripRole] = useState<"MAIN_DRIVER" | "PARTNER_DRIVER">("MAIN_DRIVER");

  const [editTrip, setEditTrip] = useState<Trip | null>(null);
  const [editDeparted, setEditDeparted] = useState("");
  const [editArrived, setEditArrived] = useState("");
  const [editCharter, setEditCharter] = useState("");
  const [editVia, setEditVia] = useState("");
  const [editRole, setEditRole] = useState<"MAIN_DRIVER" | "PARTNER_DRIVER">("MAIN_DRIVER");
  const [editSaving, setEditSaving] = useState(false);

  async function load(): Promise<void> {
    if (!id) return;
    const r = await apiFetch<DR>(`/daily-reports/${id}`);
    if (!r.ok) {
      setErr(r.error);
      setRep(null);
      return;
    }
    setRep(r.data);
    setPayCash(String(r.data.paymentCashYen));
    setPayCashNoRcpt(String(r.data.paymentCashNoReceiptYen));
    setPayCard(String(r.data.paymentCardYen));
    setPayPayPay(String(r.data.paymentPayPayYen));
    setPayRecv(String(r.data.paymentReceivableYen));
    setMetaMeterStart(String(r.data.meterStart));
    setMetaMeterEnd(String(r.data.meterEnd));
    setMetaPartnerEmployeeId(r.data.partnerEmployeeId ?? "");
    setDutyStartLocal(isoToDatetimeLocal(r.data.dutyStartAt));
    setDutyEndLocal(isoToDatetimeLocal(r.data.dutyEndAt));
    setBreakTaken(Boolean(r.data.breakTaken));
    setBreakStartLocal(isoToDatetimeLocal(r.data.breakStartAt));
    setBreakEndLocal(isoToDatetimeLocal(r.data.breakEndAt));
    setBreakLocationStr(r.data.breakLocation ?? "");
    const er = await apiFetch<{ employees: Emp[] }>("/employees");
    if (er.ok) setEmployees(er.data.employees);
    const rp = await apiFetch<PlansRes>("/tariff-plans?versionsLimit=50");
    if (rp.ok) {
      const vers = rp.data.plans.flatMap((p) => p.versions);
      setVersions(vers);
      setTariffVersionId((tid) => tid || (vers[0]?.id ?? ""));
    }
    const cr = await apiFetch<{ customers: CustomerRow[] }>("/customers");
    if (cr.ok) setCustomers(cr.data.customers);
    const rr = await apiFetch<{ referralSources: ReferralRow[] }>("/referral-sources");
    if (rr.ok) setReferrals(rr.data.referralSources);
  }

  useEffect(() => {
    void load();
  }, [id]);

  function onPickCustomer(cid: string): void {
    setCustomerId(cid);
    if (!cid) return;
    const c = customers.find((x) => x.id === cid);
    if (!c) return;
    setClientName(c.displayName);
    setOrigin((o) => (c.defaultOrigin.trim() ? c.defaultOrigin : o));
    setDestination((d) => (c.defaultDestination.trim() ? c.defaultDestination : d));
    if (c.defaultTariffVersionId) setTariffVersionId(c.defaultTariffVersionId);
    if (c.specialFareYen != null) setFareOverrideYen(String(c.specialFareYen));
  }

  function closeTripWizard(): void {
    setTripWizardOpen(false);
    setCustomerId("");
    setReferralSourceId("");
    setFareOverrideYen("");
    setExcludeFromOfficialPrint(false);
    setClientName("顧客");
    setOrigin("A");
    setDestination("B");
    setDistanceM("3000");
    setWaitingMinutes("0");
    setPassengerKind("GENERAL");
    setViaStopCount("0");
    setApplyNightSurcharge(false);
    setApplyLeftHandSurcharge(false);
    setPickupFromBaseM("");
    setApplyNightSurchargeFlat(false);
    setApplyLateNightFlatYen(false);
    setApplyEarlyMorningFlatYen(false);
    setApplyEarlyRushFlatYen(false);
    setApplyLeftHandSurchargeFlat(false);
    setDepartedAtLocal("");
    setArrivedAtLocal("");
    setCharterVehicleNo("");
    setViaNote("");
    setTripRole("MAIN_DRIVER");
  }

  function openAddTripWizard(): void {
    if (rep) {
      setDepartedAtLocal(`${rep.businessDate}T09:00`);
      setArrivedAtLocal(`${rep.businessDate}T09:30`);
    }
    setTripWizardOpen(true);
  }

  async function submitTrip(): Promise<void> {
    if (!id) return;
    setErr(null);
    setTripSubmitting(true);
    try {
      const depIso = datetimeLocalToIso(departedAtLocal);
      const arrIso = datetimeLocalToIso(arrivedAtLocal);
      if (!depIso || !arrIso) {
        setErr("出発・到着の日時を入力してください");
        return;
      }
      if (new Date(depIso) >= new Date(arrIso)) {
        setErr("出発は到着より前である必要があります");
        return;
      }
      const json: Record<string, unknown> = {
        clientName,
        origin,
        destination,
        departedAt: depIso,
        arrivedAt: arrIso,
        distanceM: Number(distanceM),
        waitingMinutes: Number(waitingMinutes || 0),
        tariffVersionId: tariffVersionId || null,
        passengerKind,
        viaStopCount: Number(viaStopCount || 0),
        applyNightSurcharge,
        applyLeftHandSurcharge,
        applyNightSurchargeFlat,
        applyLateNightFlatYen,
        applyEarlyMorningFlatYen,
        applyEarlyRushFlatYen,
        applyLeftHandSurchargeFlat,
        excludeFromOfficialPrint,
        role: tripRole,
      };
      if (charterVehicleNo.trim()) json.charterVehicleNo = charterVehicleNo.trim();
      if (viaNote.trim()) json.viaNote = viaNote.trim();
      if (pickupFromBaseM.trim() !== "") {
        json.pickupFromBaseM = Math.max(0, Math.floor(Number(pickupFromBaseM)));
      }
      if (customerId) json.customerId = customerId;
      if (referralSourceId) json.referralSourceId = referralSourceId;
      if (fareOverrideYen.trim() !== "") {
        const fo = Math.floor(Number(fareOverrideYen));
        if (Number.isFinite(fo) && fo >= 0) json.fareOverrideYen = fo;
      }
      const r = await apiFetch<Trip>(`/daily-reports/${id}/trips`, {
        method: "POST",
        json,
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

  async function savePayments(): Promise<void> {
    if (!id) return;
    setErr(null);
    setPaySaving(true);
    try {
      const r = await apiFetch<DR>(`/daily-reports/${id}`, {
        method: "PATCH",
        json: {
          paymentCashYen: Number(payCash),
          paymentCashNoReceiptYen: Number(payCashNoRcpt),
          paymentCardYen: Number(payCard),
          paymentPayPayYen: Number(payPayPay),
          paymentReceivableYen: Number(payRecv),
        },
      });
      if (!r.ok) setErr(r.error);
      else setRep(r.data);
    } finally {
      setPaySaving(false);
    }
  }

  async function saveReportMeta(): Promise<void> {
    if (!id || !rep) return;
    setErr(null);
    const ms = Math.floor(Number(metaMeterStart));
    const me = Math.floor(Number(metaMeterEnd));
    if (!Number.isFinite(ms) || !Number.isFinite(me) || me < ms) {
      setErr("メーターは数値で、終了は開始以上にしてください");
      return;
    }
    const partner = metaPartnerEmployeeId.trim();
    if (partner && partner === rep.mainEmployeeId) {
      setErr("同乗者は主運転と同じにはできません");
      return;
    }
    setMetaSaving(true);
    try {
      const json: Record<string, unknown> = {
        meterStart: ms,
        meterEnd: me,
        partnerEmployeeId: partner || null,
        dutyStartAt: dutyStartLocal.trim() ? datetimeLocalToIso(dutyStartLocal) : null,
        dutyEndAt: dutyEndLocal.trim() ? datetimeLocalToIso(dutyEndLocal) : null,
        breakTaken,
        breakStartAt: breakStartLocal.trim() ? datetimeLocalToIso(breakStartLocal) : null,
        breakEndAt: breakEndLocal.trim() ? datetimeLocalToIso(breakEndLocal) : null,
        breakLocation: breakLocationStr.trim() || null,
      };
      const r = await apiFetch<DR>(`/daily-reports/${id}`, { method: "PATCH", json });
      if (!r.ok) setErr(r.error);
      else {
        setRep(r.data);
        setMetaMeterStart(String(r.data.meterStart));
        setMetaMeterEnd(String(r.data.meterEnd));
        setMetaPartnerEmployeeId(r.data.partnerEmployeeId ?? "");
        setDutyStartLocal(isoToDatetimeLocal(r.data.dutyStartAt));
        setDutyEndLocal(isoToDatetimeLocal(r.data.dutyEndAt));
        setBreakTaken(Boolean(r.data.breakTaken));
        setBreakStartLocal(isoToDatetimeLocal(r.data.breakStartAt));
        setBreakEndLocal(isoToDatetimeLocal(r.data.breakEndAt));
        setBreakLocationStr(r.data.breakLocation ?? "");
      }
    } finally {
      setMetaSaving(false);
    }
  }

  function openTripEdit(t: Trip): void {
    setEditTrip(t);
    setEditDeparted(isoToDatetimeLocal(t.departedAt));
    setEditArrived(isoToDatetimeLocal(t.arrivedAt));
    setEditCharter(t.charterVehicleNo ?? "");
    setEditVia(t.viaNote ?? "");
    setEditRole(t.role === "PARTNER_DRIVER" ? "PARTNER_DRIVER" : "MAIN_DRIVER");
  }

  function closeTripEdit(): void {
    setEditTrip(null);
    setEditDeparted("");
    setEditArrived("");
    setEditCharter("");
    setEditVia("");
    setEditRole("MAIN_DRIVER");
  }

  async function saveTripEdit(): Promise<void> {
    if (!id || !editTrip) return;
    setErr(null);
    const depIso = datetimeLocalToIso(editDeparted);
    const arrIso = datetimeLocalToIso(editArrived);
    if (!depIso || !arrIso) {
      setErr("出発・到着の日時を入力してください");
      return;
    }
    if (new Date(depIso) >= new Date(arrIso)) {
      setErr("出発は到着より前である必要があります");
      return;
    }
    setEditSaving(true);
    try {
      const r = await apiFetch<Trip>(`/daily-reports/${id}/trips/${editTrip.id}`, {
        method: "PATCH",
        json: {
          departedAt: depIso,
          arrivedAt: arrIso,
          charterVehicleNo: editCharter.trim() || null,
          viaNote: editVia.trim() || null,
          role: editRole,
        },
      });
      if (!r.ok) setErr(r.error);
      else {
        closeTripEdit();
        await load();
      }
    } finally {
      setEditSaving(false);
    }
  }

  async function openPrint(): Promise<void> {
    if (!id) return;
    const token = getAccessToken();
    const q = officialExportOnly ? "?officialOnly=1" : "?officialOnly=0";
    const res = await fetch(`/api/v1/daily-reports/${id}/print${q}`, {
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

  async function downloadCsv(): Promise<void> {
    if (!id) return;
    const q = officialExportOnly ? "?officialOnly=1" : "?officialOnly=0";
    const r = await apiFetchBlob(`/daily-reports/${id}/export.csv${q}`);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(r.blob);
    a.download = r.filename || `daily-report-${id}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function toggleTripOfficial(trip: Trip, checked: boolean): Promise<void> {
    if (!id) return;
    setErr(null);
    const r = await apiFetch<Trip>(`/daily-reports/${id}/trips/${trip.id}`, {
      method: "PATCH",
      json: { excludeFromOfficialPrint: !checked },
    });
    if (!r.ok) setErr(r.error);
    else await load();
  }

  const routeOk = clientName.trim().length > 0 && origin.trim().length > 0 && destination.trim().length > 0;
  const depIsoW = datetimeLocalToIso(departedAtLocal);
  const arrIsoW = datetimeLocalToIso(arrivedAtLocal);
  const timesOk =
    Boolean(depIsoW && arrIsoW && new Date(depIsoW) < new Date(arrIsoW));
  const distOk = distanceM.trim() !== "" && !Number.isNaN(Number(distanceM));
  const waitOk = waitingMinutes.trim() === "" || !Number.isNaN(Number(waitingMinutes));
  const viaOk = viaStopCount.trim() === "" || (!Number.isNaN(Number(viaStopCount)) && Number(viaStopCount) >= 0);
  const pickupOk = pickupFromBaseM.trim() === "" || (!Number.isNaN(Number(pickupFromBaseM)) && Number(pickupFromBaseM) >= 0);
  const fareOvOk = fareOverrideYen.trim() === "" || (!Number.isNaN(Number(fareOverrideYen)) && Number(fareOverrideYen) >= 0);

  const steps: StepWizardStep[] = [
    {
      id: "route",
      title: "顧客と区間",
      description: "名簿から選択すると出発地・到着地・料金版を埋められます。",
      canProceed: routeOk,
      children: (
        <>
          <label>名簿から（任意）</label>
          <select
            value={customerId}
            onChange={(e) => {
              const v = e.target.value;
              setCustomerId(v);
              onPickCustomer(v);
            }}
          >
            <option value="">なし</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
          </select>
          <label>紹介元（任意）</label>
          <select value={referralSourceId} onChange={(e) => setReferralSourceId(e.target.value)}>
            <option value="">なし</option>
            {referrals.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <label>顧客名</label>
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} autoFocus />
          <label>出発地</label>
          <input value={origin} onChange={(e) => setOrigin(e.target.value)} />
          <label>到着地</label>
          <input value={destination} onChange={(e) => setDestination(e.target.value)} />
          <label>
            <input type="checkbox" checked={excludeFromOfficialPrint} onChange={(e) => setExcludeFromOfficialPrint(e.target.checked)} />{" "}
            公式帳票・提出用CSVから除外（裏帳簿扱い・データは保持）
          </label>
        </>
      ),
    },
    {
      id: "times",
      title: "時刻・客車・役割",
      description: "乗務記録様式に合わせた出発・到着時刻と客車番号などです。",
      canProceed: timesOk,
      children: (
        <>
          <label>出発日時</label>
          <input type="datetime-local" value={departedAtLocal} onChange={(e) => setDepartedAtLocal(e.target.value)} />
          <label>到着日時</label>
          <input type="datetime-local" value={arrivedAtLocal} onChange={(e) => setArrivedAtLocal(e.target.value)} />
          <label>客車の車両番号（任意）</label>
          <input value={charterVehicleNo} onChange={(e) => setCharterVehicleNo(e.target.value)} placeholder="例: 品川300あ1234" />
          <label>経由地・メモ（任意）</label>
          <input value={viaNote} onChange={(e) => setViaNote(e.target.value)} />
          <label>運転の区分</label>
          <select value={tripRole} onChange={(e) => setTripRole(e.target.value as "MAIN_DRIVER" | "PARTNER_DRIVER")}>
            <option value="MAIN_DRIVER">主として運転（代行）</option>
            <option value="PARTNER_DRIVER">同乗・随伴として運転</option>
          </select>
        </>
      ),
    },
    {
      id: "metrics",
      title: "距離・待機・料金",
      description: "手動運賃を入れると料金版より優先されます（空で料金版計算）。",
      canProceed: distOk && waitOk && viaOk && pickupOk && fareOvOk && timesOk,
      children: (
        <>
          <label>手動運賃（円・空で料金版）</label>
          <input value={fareOverrideYen} onChange={(e) => setFareOverrideYen(e.target.value)} inputMode="numeric" />
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
          <label>
            <input type="checkbox" checked={applyLeftHandSurchargeFlat} onChange={(e) => setApplyLeftHandSurchargeFlat(e.target.checked)} /> 左ハンドル定額
          </label>
          <label>迎車距離（基準地点から m・空でなし）</label>
          <input value={pickupFromBaseM} onChange={(e) => setPickupFromBaseM(e.target.value)} inputMode="numeric" />
          <label>
            <input type="checkbox" checked={applyNightSurchargeFlat} onChange={(e) => setApplyNightSurchargeFlat(e.target.checked)} /> 深夜定額
          </label>
          <label>
            <input type="checkbox" checked={applyLateNightFlatYen} onChange={(e) => setApplyLateNightFlatYen(e.target.checked)} /> 遅番定額
          </label>
          <label>
            <input type="checkbox" checked={applyEarlyMorningFlatYen} onChange={(e) => setApplyEarlyMorningFlatYen(e.target.checked)} /> 早朝1定額
          </label>
          <label>
            <input type="checkbox" checked={applyEarlyRushFlatYen} onChange={(e) => setApplyEarlyRushFlatYen(e.target.checked)} /> 早朝2定額
          </label>
        </>
      ),
    },
    {
      id: "confirm",
      title: "運行追加の確認",
      canProceed: routeOk && distOk && waitOk && viaOk && pickupOk && fareOvOk && timesOk,
      children: (
        <dl className="step-wizard-summary">
          <dt>顧客</dt>
          <dd>{clientName}</dd>
          <dt>区間</dt>
          <dd>
            {origin} → {destination}
          </dd>
          <dt>出発／到着</dt>
          <dd>
            {departedAtLocal} → {arrivedAtLocal}
          </dd>
          <dt>客車番号／経由</dt>
          <dd>
            {[charterVehicleNo || "—", viaNote || "—"].join(" / ")}
          </dd>
          <dt>役割</dt>
          <dd>{tripRole === "PARTNER_DRIVER" ? "同乗・随伴" : "主運転"}</dd>
          <dt>手動運賃</dt>
          <dd>{fareOverrideYen.trim() ? `${fareOverrideYen} 円` : "（料金版）"}</dd>
          <dt>公式帳票</dt>
          <dd>{excludeFromOfficialPrint ? "除外" : "含める"}</dd>
          <dt>距離 / 待機</dt>
          <dd>
            {distanceM} m / {waitingMinutes || "0"} 分
          </dd>
          <dt>料金版</dt>
          <dd>{tariffVersionId ? `v${versions.find((x) => x.id === tariffVersionId)?.version ?? ""}` : "なし"}</dd>
          <dt>会員／経由／割増</dt>
          <dd>
            {passengerKind === "MEMBER" ? "会員" : "一般"} / 経由{viaStopCount || "0"}回
            {applyNightSurcharge ? "・夜間%" : ""}
            {applyLeftHandSurcharge ? "・左H%" : ""}
            {applyLeftHandSurchargeFlat ? "・左H定" : ""}
            {pickupFromBaseM.trim() !== "" ? `・迎車${pickupFromBaseM}m` : ""}
            {applyNightSurchargeFlat ? "・深夜定" : ""}
            {applyLateNightFlatYen ? "・遅番定" : ""}
            {applyEarlyMorningFlatYen ? "・早1" : ""}
            {applyEarlyRushFlatYen ? "・早2" : ""}
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
        <p style={{ marginTop: 0 }}>
          <button type="button" onClick={() => void delRep()}>
            日報削除
          </button>
        </p>
        <label>
          <input type="checkbox" checked={officialExportOnly} onChange={(e) => setOfficialExportOnly(e.target.checked)} />{" "}
          印刷・CSVは公式対象のみ（チェック時は内部運行を除く）
        </label>
        <p>
          <button type="button" onClick={() => void openPrint()}>
            日報を印刷（HTML）
          </button>{" "}
          <button type="button" onClick={() => void downloadCsv()}>
            CSVダウンロード
          </button>
        </p>
      </Card>
      <Card title="乗務記録ヘッダ（始業・休憩・同乗・メーター）">
        <p style={{ marginTop: 0, fontSize: "0.9rem", opacity: 0.9 }}>
          車両: {rep.vehicle.label}
          {rep.vehicle.plate ? `（登録番号 ${rep.vehicle.plate}）` : ""}／主運転: {rep.mainEmployee.familyName} {rep.mainEmployee.givenName}
        </p>
        <div className="stack-form">
          <label>
            メーター開始
            <input value={metaMeterStart} onChange={(e) => setMetaMeterStart(e.target.value)} inputMode="numeric" />
          </label>
          <label>
            メーター終了
            <input value={metaMeterEnd} onChange={(e) => setMetaMeterEnd(e.target.value)} inputMode="numeric" />
          </label>
          <label>
            同乗者（任意）
            <select value={metaPartnerEmployeeId} onChange={(e) => setMetaPartnerEmployeeId(e.target.value)}>
              <option value="">なし</option>
              {employees
                .filter((e) => e.id !== rep.mainEmployeeId)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.familyName} {e.givenName}
                  </option>
                ))}
            </select>
          </label>
          <label>
            始業日時（空でクリア）
            <input type="datetime-local" value={dutyStartLocal} onChange={(e) => setDutyStartLocal(e.target.value)} />
          </label>
          <label>
            終業日時（空でクリア）
            <input type="datetime-local" value={dutyEndLocal} onChange={(e) => setDutyEndLocal(e.target.value)} />
          </label>
          <label>
            <input type="checkbox" checked={breakTaken} onChange={(e) => setBreakTaken(e.target.checked)} /> 休憩・仮眠あり
          </label>
          <label>
            休憩開始（空でクリア）
            <input type="datetime-local" value={breakStartLocal} onChange={(e) => setBreakStartLocal(e.target.value)} />
          </label>
          <label>
            休憩終了（空でクリア）
            <input type="datetime-local" value={breakEndLocal} onChange={(e) => setBreakEndLocal(e.target.value)} />
          </label>
          <label>
            休憩・仮眠場所
            <input value={breakLocationStr} onChange={(e) => setBreakLocationStr(e.target.value)} />
          </label>
          <button type="button" disabled={metaSaving} onClick={() => void saveReportMeta()}>
            ヘッダ情報を保存
          </button>
        </div>
      </Card>
      <Card title="決済内訳・領収書なし現金">
        <div className="stack-form">
          <label>
            現金（円）
            <input value={payCash} onChange={(e) => setPayCash(e.target.value)} inputMode="numeric" />
          </label>
          <label>
            うち領収書なし現金（円）
            <input value={payCashNoRcpt} onChange={(e) => setPayCashNoRcpt(e.target.value)} inputMode="numeric" />
          </label>
          <label>
            カード（円）
            <input value={payCard} onChange={(e) => setPayCard(e.target.value)} inputMode="numeric" />
          </label>
          <label>
            PayPay（円）
            <input value={payPayPay} onChange={(e) => setPayPayPay(e.target.value)} inputMode="numeric" />
          </label>
          <label>
            売掛（円）
            <input value={payRecv} onChange={(e) => setPayRecv(e.target.value)} inputMode="numeric" />
          </label>
          <button type="button" disabled={paySaving} onClick={() => void savePayments()}>
            決済を保存
          </button>
        </div>
      </Card>
      <Card title="運行追加">
        <p style={{ marginTop: 0 }}>
          <button type="button" onClick={() => openAddTripWizard()}>
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
                <th>出発</th>
                <th>到着</th>
                <th>客車番号</th>
                <th>経由</th>
                <th>役割</th>
                <th>運賃</th>
                <th>名簿/紹介</th>
                <th>公式</th>
                <th>距離</th>
                <th>待機</th>
                <th>会員</th>
                <th>経由回</th>
                <th>割増</th>
                <th>迎車m</th>
                <th>定額</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rep.trips.map((t) => (
                <tr key={t.id}>
                  <td>{t.clientName}</td>
                  <td>
                    {t.origin}→{t.destination}
                  </td>
                  <td style={{ fontSize: "0.85rem", whiteSpace: "nowrap" }}>{new Date(t.departedAt).toLocaleString()}</td>
                  <td style={{ fontSize: "0.85rem", whiteSpace: "nowrap" }}>{new Date(t.arrivedAt).toLocaleString()}</td>
                  <td>{t.charterVehicleNo ?? "—"}</td>
                  <td>{t.viaNote ?? "—"}</td>
                  <td>{t.role === "PARTNER_DRIVER" ? "同乗" : "主"}</td>
                  <td>{t.fareYen}</td>
                  <td>
                    {[t.customer?.displayName, t.referralSource?.name].filter(Boolean).join(" / ") || "—"}
                  </td>
                  <td>
                    <label>
                      <input
                        type="checkbox"
                        checked={!t.excludeFromOfficialPrint}
                        onChange={(e) => void toggleTripOfficial(t, e.target.checked)}
                      />{" "}
                      公式に含める
                    </label>
                  </td>
                  <td>{t.distanceM}</td>
                  <td>{t.waitingMinutes}</td>
                  <td>{t.passengerKind === "MEMBER" ? "会員" : "一般"}</td>
                  <td>{t.viaStopCount}</td>
                  <td>
                    {[t.applyNightSurcharge && "夜%", t.applyLeftHandSurcharge && "左%"].filter(Boolean).join("・") || "—"}
                  </td>
                  <td>{t.pickupFromBaseM ?? "—"}</td>
                  <td>
                    {[
                      t.applyNightSurchargeFlat && "深",
                      t.applyLateNightFlatYen && "遅",
                      t.applyEarlyMorningFlatYen && "早1",
                      t.applyEarlyRushFlatYen && "早2",
                      t.applyLeftHandSurchargeFlat && "左H定",
                    ]
                      .filter(Boolean)
                      .join("・") || "—"}
                  </td>
                  <td>
                    <button type="button" onClick={() => openTripEdit(t)}>
                      時刻・客車
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {editTrip ? (
        <Card title={`運行の修正（${editTrip.clientName}）`}>
          <div className="stack-form">
            <label>
              出発日時
              <input type="datetime-local" value={editDeparted} onChange={(e) => setEditDeparted(e.target.value)} />
            </label>
            <label>
              到着日時
              <input type="datetime-local" value={editArrived} onChange={(e) => setEditArrived(e.target.value)} />
            </label>
            <label>
              客車の車両番号
              <input value={editCharter} onChange={(e) => setEditCharter(e.target.value)} />
            </label>
            <label>
              経由地・メモ
              <input value={editVia} onChange={(e) => setEditVia(e.target.value)} />
            </label>
            <label>
              役割
              <select value={editRole} onChange={(e) => setEditRole(e.target.value as "MAIN_DRIVER" | "PARTNER_DRIVER")}>
                <option value="MAIN_DRIVER">主として運転</option>
                <option value="PARTNER_DRIVER">同乗・随伴</option>
              </select>
            </label>
            <p>
              <button type="button" disabled={editSaving} onClick={() => void saveTripEdit()}>
                保存
              </button>{" "}
              <button type="button" disabled={editSaving} onClick={() => closeTripEdit()}>
                キャンセル
              </button>
            </p>
          </div>
        </Card>
      ) : null}
    </>
  );
}

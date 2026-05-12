import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch, apiFetchBlob, getAccessToken } from "../api";
import { Card, Err, FieldWithHint, StepWizard, Tabs, type StepWizardStep } from "../ui";

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
type DR = {
  id: string;
  businessDate: string;
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
  const [detailTab, setDetailTab] = useState<"pay" | "export" | "trips">("pay");

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
  }

  async function submitTrip(): Promise<void> {
    if (!id) return;
    setErr(null);
    setTripSubmitting(true);
    try {
      const json: Record<string, unknown> = {
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
        applyNightSurchargeFlat,
        applyLateNightFlatYen,
        applyEarlyMorningFlatYen,
        applyEarlyRushFlatYen,
        applyLeftHandSurchargeFlat,
        excludeFromOfficialPrint,
      };
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
  const distOk = distanceM.trim() !== "" && !Number.isNaN(Number(distanceM));
  const waitOk = waitingMinutes.trim() === "" || !Number.isNaN(Number(waitingMinutes));
  const viaOk = viaStopCount.trim() === "" || (!Number.isNaN(Number(viaStopCount)) && Number(viaStopCount) >= 0);
  const pickupOk = pickupFromBaseM.trim() === "" || (!Number.isNaN(Number(pickupFromBaseM)) && Number(pickupFromBaseM) >= 0);
  const fareOvOk = fareOverrideYen.trim() === "" || (!Number.isNaN(Number(fareOverrideYen)) && Number(fareOverrideYen) >= 0);

  const steps: StepWizardStep[] = [
    {
      id: "route",
      title: "お客様と行き先",
      description: "お客様リストから選ぶと、よく使う出発地・到着地点・料金ルールを自動で入れられます。",
      canProceed: routeOk,
      children: (
        <>
          <FieldWithHint
            label="お客様リストから選ぶ"
            hint="あらかじめ登録したお客様を選ぶと、名前や住所が入ります。選ばなくても手入力で大丈夫です。"
            optional
          >
            <select
              value={customerId}
              onChange={(e) => {
                const v = e.target.value;
                setCustomerId(v);
                onPickCustomer(v);
              }}
            >
              <option value="">選ばない</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                </option>
              ))}
            </select>
          </FieldWithHint>
          <FieldWithHint
            label="紹介してくれたお店"
            hint="飲食店などからの依頼のとき、どのお店からの紹介か分かるようにしておけます。"
            optional
          >
            <select value={referralSourceId} onChange={(e) => setReferralSourceId(e.target.value)}>
              <option value="">なし</option>
              {referrals.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FieldWithHint>
          <FieldWithHint label="お客様の呼び名" hint="伝票や一覧に出る名前です。ニックネームでも構いません。">
            <input value={clientName} onChange={(e) => setClientName(e.target.value)} autoFocus />
          </FieldWithHint>
          <FieldWithHint label="出発する場所" hint="建物名や交差点など、運転手が迷わない書き方にしてください。">
            <input value={origin} onChange={(e) => setOrigin(e.target.value)} />
          </FieldWithHint>
          <FieldWithHint label="お届けする場所" hint="到着地点の住所や施設名を書きます。">
            <input value={destination} onChange={(e) => setDestination(e.target.value)} />
          </FieldWithHint>
          <label>
            <input type="checkbox" checked={excludeFromOfficialPrint} onChange={(e) => setExcludeFromOfficialPrint(e.target.checked)} />{" "}
            税理士さん向けの資料や印刷では出さない（社内メモのような送迎として扱う。金額データは残ります）
          </label>
        </>
      ),
    },
    {
      id: "metrics",
      title: "距離・待ち時間・料金",
      description: "金額を自分で決める場合は「決まった運賃」に数字を入れます。空にすると、下で選んだ料金ルールから自動計算します。",
      canProceed: distOk && waitOk && viaOk && pickupOk && fareOvOk,
      children: (
        <>
          <FieldWithHint
            label="決まった運賃（円）"
            hint="特別料金など、ルールとは別の金額にしたいときだけ入力します。空欄なら料金ルールの計算結果を使います。"
            optional
          >
            <input value={fareOverrideYen} onChange={(e) => setFareOverrideYen(e.target.value)} inputMode="numeric" />
          </FieldWithHint>
          <FieldWithHint label="走った距離（メートル）" hint="メーターや地図アプリの「m」表示に合わせて数字だけ入れます。例: 3000（＝3km）">
            <input value={distanceM} onChange={(e) => setDistanceM(e.target.value)} inputMode="numeric" />
          </FieldWithHint>
          <FieldWithHint label="待ち時間（分）" hint="お客様を待った時間があれば分単位で入力します。なければ 0 のままで大丈夫です。">
            <input value={waitingMinutes} onChange={(e) => setWaitingMinutes(e.target.value)} inputMode="numeric" />
          </FieldWithHint>
          <FieldWithHint label="使う料金ルール" hint="「料金ルール」画面で作ったセットから選びます。選ばない場合は金額を手で入れるか、後から修正してください。" optional>
            <select value={tariffVersionId} onChange={(e) => setTariffVersionId(e.target.value)}>
              <option value="">使わない</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  ルール v{v.version}
                </option>
              ))}
            </select>
          </FieldWithHint>
          <FieldWithHint label="会員さんですか？" hint="会員向けに安くなるルールがある場合だけ、会員を選びます。">
            <select value={passengerKind} onChange={(e) => setPassengerKind(e.target.value as "GENERAL" | "MEMBER")}>
              <option value="GENERAL">一般のお客様</option>
              <option value="MEMBER">会員のお客様</option>
            </select>
          </FieldWithHint>
          <FieldWithHint label="途中で止まった回数" hint="コンビニなどに寄った回数。なければ 0 です。" optional>
            <input value={viaStopCount} onChange={(e) => setViaStopCount(e.target.value)} inputMode="numeric" />
          </FieldWithHint>
          <label>
            <input type="checkbox" checked={applyNightSurcharge} onChange={(e) => setApplyNightSurcharge(e.target.checked)} /> 夜間の割増し（％）
          </label>
          <label>
            <input type="checkbox" checked={applyLeftHandSurcharge} onChange={(e) => setApplyLeftHandSurcharge(e.target.checked)} /> 左ハンドル車の割増し（％）
          </label>
          <label>
            <input type="checkbox" checked={applyLeftHandSurchargeFlat} onChange={(e) => setApplyLeftHandSurchargeFlat(e.target.checked)} /> 左ハンドル車の追加料金（定額）
          </label>
          <FieldWithHint
            label="迎えに行った距離（メートル）"
            hint="営業所からお客様のもとへ向かう距離を課金するルールのときに使います。分からなければ空欄で構いません。"
            optional
          >
            <input value={pickupFromBaseM} onChange={(e) => setPickupFromBaseM(e.target.value)} inputMode="numeric" />
          </FieldWithHint>
          <label>
            <input type="checkbox" checked={applyNightSurchargeFlat} onChange={(e) => setApplyNightSurchargeFlat(e.target.checked)} /> 深夜の追加料金（定額）
          </label>
          <label>
            <input type="checkbox" checked={applyLateNightFlatYen} onChange={(e) => setApplyLateNightFlatYen(e.target.checked)} /> さらに遅い時間帯の追加（定額）
          </label>
          <label>
            <input type="checkbox" checked={applyEarlyMorningFlatYen} onChange={(e) => setApplyEarlyMorningFlatYen(e.target.checked)} /> 早朝の追加（定額・パターン1）
          </label>
          <label>
            <input type="checkbox" checked={applyEarlyRushFlatYen} onChange={(e) => setApplyEarlyRushFlatYen(e.target.checked)} /> 早朝の追加（定額・パターン2）
          </label>
        </>
      ),
    },
    {
      id: "confirm",
      title: "内容の確認",
      canProceed: routeOk && distOk && waitOk && viaOk && pickupOk && fareOvOk,
      children: (
        <dl className="step-wizard-summary">
          <dt>顧客</dt>
          <dd>{clientName}</dd>
          <dt>区間</dt>
          <dd>
            {origin} → {destination}
          </dd>
          <dt>決まった運賃</dt>
          <dd>{fareOverrideYen.trim() ? `${fareOverrideYen} 円` : "（料金ルールで計算）"}</dd>
          <dt>外部の資料に載せる</dt>
          <dd>{excludeFromOfficialPrint ? "載せない" : "載せる"}</dd>
          <dt>距離 / 待機</dt>
          <dd>
            {distanceM} m / {waitingMinutes || "0"} 分
          </dd>
          <dt>料金ルール</dt>
          <dd>{tariffVersionId ? `v${versions.find((x) => x.id === tariffVersionId)?.version ?? ""}` : "なし"}</dd>
          <dt>会員・途中停車・割増</dt>
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
    if (!id || !confirm("この日の記録をまとめて削除しますか？元に戻せません。")) return;
    setErr(null);
    const r = await apiFetch(`/daily-reports/${id}`, { method: "DELETE" });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else navigate("/daily-reports", { replace: true });
  }

  if (!id) return <Err msg="記録の番号がありません" />;
  if (!rep && err) return <Err msg={err} />;
  if (!rep) return <p>読み込み中…</p>;

  return (
    <>
      <Card title={`この日の記録（${rep.businessDate}）`}>
        <Err msg={err} />
        <p style={{ marginTop: 0, fontSize: "0.88rem", color: "var(--color-muted)" }}>
          1日分の送迎と、お支払いのメモをまとめた画面です。下のタブで切り替えてください。
        </p>
        <Tabs
          aria-label="この日の記録の詳細"
          activeId={detailTab}
          onActiveChange={(id) => setDetailTab(id as "pay" | "export" | "trips")}
          items={[
            {
              id: "pay",
              label: "お支払いのメモ",
              children: (
                <div className="stack-form" style={{ marginTop: "0.5rem" }}>
                  <FieldWithHint
                    label="現金で受け取った合計（円）"
                    hint="その日に現金で預かった金額の合計です。細かい内訳は紙の控えなどで管理している場合は、メモ程度で大丈夫です。"
                  >
                    <input value={payCash} onChange={(e) => setPayCash(e.target.value)} inputMode="numeric" />
                  </FieldWithHint>
                  <FieldWithHint
                    label="うち領収書を出していない現金（円）"
                    hint="領収書を切っていない現金だけ分かるようにしておく欄です。税理士さんへの資料で使い分けたいときに入力します。"
                    optional
                  >
                    <input value={payCashNoRcpt} onChange={(e) => setPayCashNoRcpt(e.target.value)} inputMode="numeric" />
                  </FieldWithHint>
                  <FieldWithHint label="カード払いの合計（円）" hint="クレジットカードやデビットの売上をまとめた金額です。" optional>
                    <input value={payCard} onChange={(e) => setPayCard(e.target.value)} inputMode="numeric" />
                  </FieldWithHint>
                  <FieldWithHint label="PayPay の合計（円）" hint="PayPay で受け取った分があれば入れます。なければ 0 で構いません。" optional>
                    <input value={payPayPay} onChange={(e) => setPayPayPay(e.target.value)} inputMode="numeric" />
                  </FieldWithHint>
                  <FieldWithHint
                    label="まだ入金されていない分（円）"
                    hint="後日まとめてもらうお金など。いまは現金でなくても、メモとして残したい金額を入れられます。"
                    optional
                  >
                    <input value={payRecv} onChange={(e) => setPayRecv(e.target.value)} inputMode="numeric" />
                  </FieldWithHint>
                  <button type="button" disabled={paySaving} onClick={() => void savePayments()}>
                    {paySaving ? "保存中…" : "この内容で保存する"}
                  </button>
                </div>
              ),
            },
            {
              id: "export",
              label: "印刷・データ",
              children: (
                <div style={{ marginTop: "0.5rem" }}>
                  <p style={{ fontSize: "0.88rem", color: "var(--color-muted)", marginTop: 0 }}>
                    ブラウザの印刷で PDF 化したり、表計算用の CSV を取り出せます。チェックを入れると、社内向けに隠していた送迎は一覧に出ません。
                  </p>
                  <label>
                    <input type="checkbox" checked={officialExportOnly} onChange={(e) => setOfficialExportOnly(e.target.checked)} />{" "}
                    外部に出す資料向けだけにする（チェック時、社内メモ扱いの送迎を除く）
                  </label>
                  <p>
                    <button type="button" onClick={() => void openPrint()}>
                      きれいに印刷する（HTML）
                    </button>{" "}
                    <button type="button" onClick={() => void downloadCsv()}>
                      表計算用ファイル（CSV）
                    </button>
                  </p>
                  <p style={{ marginTop: "1.25rem", paddingTop: "1rem", borderTop: "1px solid var(--color-border)" }}>
                    <button type="button" onClick={() => void delRep()}>
                      この日の記録をすべて削除する
                    </button>
                  </p>
                </div>
              ),
            },
            {
              id: "trips",
              label: "お客様の送迎",
              children: (
                <div style={{ marginTop: "0.5rem" }}>
                  <p style={{ fontSize: "0.88rem", color: "var(--color-muted)", marginTop: 0 }}>
                    1件ずつ「お迎え〜お届け」を追加します。画面の案内に沿って「次へ」を押してください。
                  </p>
                  <p>
                    <button type="button" onClick={() => setTripWizardOpen(true)}>
                      送迎を1件追加する
                    </button>
                  </p>
                  <StepWizard
                    open={tripWizardOpen}
                    onClose={closeTripWizard}
                    title="送迎を1件追加する"
                    steps={steps}
                    finishLabel="この内容で追加する"
                    onFinish={submitTrip}
                    isSubmitting={tripSubmitting}
                  />
                  <div className="table-wrap" style={{ marginTop: "1rem" }}>
                    <table>
                      <thead>
                        <tr>
                          <th>お客様</th>
                          <th>行き先</th>
                          <th>運賃（円）</th>
                          <th>リスト／紹介</th>
                          <th>外部資料</th>
                          <th>距離（m）</th>
                          <th>待ち（分）</th>
                          <th>会員</th>
                          <th>停車</th>
                          <th>割増</th>
                          <th>迎え（m）</th>
                          <th>定額系</th>
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
                            <td>{[t.customer?.displayName, t.referralSource?.name].filter(Boolean).join(" / ") || "—"}</td>
                            <td>
                              <label>
                                <input
                                  type="checkbox"
                                  checked={!t.excludeFromOfficialPrint}
                                  onChange={(e) => void toggleTripOfficial(t, e.target.checked)}
                                />{" "}
                                資料に載せる
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
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}

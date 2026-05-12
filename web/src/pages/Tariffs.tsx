import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import { fareYenForTrip, type TierPick, type VersionPricingInput } from "../lib/tariffPricing";
import { Card, Err, StepWizard, type StepWizardStep } from "../ui";

const TARIFF_PLANS_QUERY = "?versionsLimit=30";

type Seg = { id: string; fromM: number; toM: number; fareYen: number; fareMemberYen?: number | null };
type Tier = {
  id: string;
  sortOrder: number;
  fromM: number;
  untilM: number | null;
  stepM: number;
  addYenPerStep: number;
};
type Ver = {
  id: string;
  version: number;
  initialDistanceM: number;
  initialFareYen: number;
  addUnitDistanceM: number;
  addFareYen: number;
  waitingFareYenPerMin: number;
  distanceMode: string;
  waitingRuleJson: unknown;
  perViaStopYen: number;
  cancellationFeeYen: number;
  nightSurchargeBps: number;
  leftHandSurchargeBps: number;
  segments: Seg[];
  distanceTiers?: Tier[];
};
type Plan = { id: string; name: string; versions: Ver[] };

function findVerLabel(plans: Plan[], verId: string | null): string {
  if (!verId) return "（未選択）";
  for (const p of plans) {
    for (const v of p.versions) {
      if (v.id === verId) return `${p.name} / v${v.version}`;
    }
  }
  return verId;
}

function findVersion(plans: Plan[], verId: string | null): Ver | null {
  if (!verId) return null;
  for (const p of plans) {
    for (const v of p.versions) {
      if (v.id === verId) return v;
    }
  }
  return null;
}

function versionToPricingInput(v: Ver): VersionPricingInput {
  return {
    distanceMode: v.distanceMode ?? "INITIAL_ADD",
    initialDistanceM: v.initialDistanceM,
    initialFareYen: v.initialFareYen,
    addUnitDistanceM: v.addUnitDistanceM,
    addFareYen: v.addFareYen,
    waitingFareYenPerMin: v.waitingFareYenPerMin,
    waitingRuleJson: v.waitingRuleJson,
    perViaStopYen: v.perViaStopYen ?? 0,
    nightSurchargeBps: v.nightSurchargeBps ?? 0,
    leftHandSurchargeBps: v.leftHandSurchargeBps ?? 0,
  };
}

function tiersToPick(ts: Tier[] | undefined): TierPick[] {
  return (ts ?? []).map((t) => ({
    sortOrder: t.sortOrder,
    fromM: t.fromM,
    untilM: t.untilM,
    stepM: t.stepM,
    addYenPerStep: t.addYenPerStep,
  }));
}

const WAITING_PRESETS: { id: string; label: string; json: unknown }[] = [
  { id: "linear0", label: "シンプル（分×円）", json: { type: "linear", graceMin: 0, perMinYen: 0 } },
  { id: "block_as", label: "ブロック（例: 無料10分→5分ごと500円）", json: { type: "block", graceMin: 10, blockEveryMin: 5, blockYen: 500 } },
  { id: "grace_plus", label: "PLUS型（例: 3分無料→200円→100円/分）", json: { type: "grace_flat_then_linear", graceMin: 3, firstChargeYen: 200, perMinAfterFirstYen: 100 } },
];

export default function Tariffs(): JSX.Element {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [planWizardOpen, setPlanWizardOpen] = useState(false);
  const [planSubmitting, setPlanSubmitting] = useState(false);
  const [segWizardOpen, setSegWizardOpen] = useState(false);
  const [segSubmitting, setSegSubmitting] = useState(false);
  const [verSaveSubmitting, setVerSaveSubmitting] = useState(false);
  const [selVer, setSelVer] = useState<string | null>(null);
  const [fromM, setFromM] = useState("");
  const [toM, setToM] = useState("");
  const [fareYen, setFareYen] = useState("");
  const [fareMemberYen, setFareMemberYen] = useState("");

  const [editInitialDistanceM, setEditInitialDistanceM] = useState("");
  const [editInitialFareYen, setEditInitialFareYen] = useState("");
  const [editAddUnitDistanceM, setEditAddUnitDistanceM] = useState("");
  const [editAddFareYen, setEditAddFareYen] = useState("");
  const [editWaitingFareYenPerMin, setEditWaitingFareYenPerMin] = useState("");
  const [editDistanceMode, setEditDistanceMode] = useState<string>("INITIAL_ADD");
  const [editWaitingRuleJson, setEditWaitingRuleJson] = useState("{}");
  const [editPerViaStopYen, setEditPerViaStopYen] = useState("0");
  const [editCancellationFeeYen, setEditCancellationFeeYen] = useState("0");
  const [editNightSurchargeBps, setEditNightSurchargeBps] = useState("0");
  const [editLeftHandSurchargeBps, setEditLeftHandSurchargeBps] = useState("0");

  const [simDistanceKm, setSimDistanceKm] = useState("");
  const [simWaitMin, setSimWaitMin] = useState("0");
  const [simMember, setSimMember] = useState(false);
  const [simViaStops, setSimViaStops] = useState("0");
  const [simNight, setSimNight] = useState(false);
  const [simLeftHand, setSimLeftHand] = useState(false);

  const [tierFromM, setTierFromM] = useState("");
  const [tierUntilM, setTierUntilM] = useState("");
  const [tierStepM, setTierStepM] = useState("200");
  const [tierAddYen, setTierAddYen] = useState("100");
  const [tierSubmitting, setTierSubmitting] = useState(false);

  const selectedVersion = useMemo(() => findVersion(plans, selVer), [plans, selVer]);

  const simResultYen = useMemo(() => {
    if (!selectedVersion) return null;
    const km = Number(simDistanceKm);
    const wait = Number(simWaitMin);
    const via = Number(simViaStops);
    if (!Number.isFinite(km) || km < 0 || !Number.isFinite(wait) || wait < 0 || !Number.isFinite(via) || via < 0) return null;
    const distanceM = Math.round(km * 1000);
    const segs = selectedVersion.segments.map((s) => ({
      fromM: s.fromM,
      toM: s.toM,
      fareYen: s.fareYen,
      fareMemberYen: s.fareMemberYen,
    }));
    return fareYenForTrip(
      versionToPricingInput(selectedVersion),
      distanceM,
      wait,
      segs,
      tiersToPick(selectedVersion.distanceTiers),
      {
        isMember: simMember,
        viaStopCount: Math.floor(via),
        applyNightSurcharge: simNight,
        applyLeftHandSurcharge: simLeftHand,
      },
    );
  }, [selectedVersion, simDistanceKm, simWaitMin, simMember, simViaStops, simNight, simLeftHand]);

  async function load(): Promise<void> {
    const r = await apiFetch<{ plans: Plan[] }>(`/tariff-plans${TARIFF_PLANS_QUERY}`);
    if (r.ok) {
      setPlans(r.data.plans);
      if (!selVer && r.data.plans[0]?.versions[0]) setSelVer(r.data.plans[0].versions[0].id);
    } else setErr(r.error);
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const v = findVersion(plans, selVer);
    if (!v) return;
    setEditInitialDistanceM(String(v.initialDistanceM));
    setEditInitialFareYen(String(v.initialFareYen));
    setEditAddUnitDistanceM(String(v.addUnitDistanceM));
    setEditAddFareYen(String(v.addFareYen));
    setEditWaitingFareYenPerMin(String(v.waitingFareYenPerMin));
    setEditDistanceMode(v.distanceMode ?? "INITIAL_ADD");
    try {
      setEditWaitingRuleJson(JSON.stringify(v.waitingRuleJson ?? {}, null, 2));
    } catch {
      setEditWaitingRuleJson("{}");
    }
    setEditPerViaStopYen(String(v.perViaStopYen ?? 0));
    setEditCancellationFeeYen(String(v.cancellationFeeYen ?? 0));
    setEditNightSurchargeBps(String(v.nightSurchargeBps ?? 0));
    setEditLeftHandSurchargeBps(String(v.leftHandSurchargeBps ?? 0));
  }, [selVer, plans]);

  async function submitPlan(): Promise<void> {
    setErr(null);
    setPlanSubmitting(true);
    try {
      const r = await apiFetch<{ plan: Plan; version: Ver }>("/tariff-plans", { method: "POST", json: { name: name.trim() } });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setName("");
      setPlanWizardOpen(false);
      await load();
      setSelVer(r.data.version.id);
    } finally {
      setPlanSubmitting(false);
    }
  }

  async function addVersion(planId: string): Promise<void> {
    setErr(null);
    const r = await apiFetch<Ver>(`/tariff-plans/${planId}/versions`, { method: "POST", json: {} });
    if (!r.ok) setErr(r.error);
    else {
      setSelVer(r.data.id);
      await load();
    }
  }

  async function saveVersionParams(): Promise<void> {
    if (!selVer) return;
    setErr(null);
    const initialDistanceM = Math.floor(Number(editInitialDistanceM));
    const initialFareYen = Math.floor(Number(editInitialFareYen));
    const addUnitDistanceM = Math.floor(Number(editAddUnitDistanceM));
    const addFareYen = Math.floor(Number(editAddFareYen));
    const waitingFareYenPerMin = Math.floor(Number(editWaitingFareYenPerMin));
    if (
      !Number.isFinite(initialDistanceM) ||
      !Number.isFinite(initialFareYen) ||
      !Number.isFinite(addUnitDistanceM) ||
      !Number.isFinite(addFareYen) ||
      !Number.isFinite(waitingFareYenPerMin)
    ) {
      setErr("料金版の数値はすべて整数で入力してください。");
      return;
    }
    if (initialDistanceM < 0 || initialFareYen < 0 || addUnitDistanceM < 1 || addFareYen < 0 || waitingFareYenPerMin < 0) {
      setErr("初乗り距離・運賃は0以上、加算距離単位は1以上にしてください。");
      return;
    }
    let waitingRuleJson: unknown;
    try {
      waitingRuleJson = JSON.parse(editWaitingRuleJson || "{}");
    } catch {
      setErr("待機ルール JSON の形式が不正です。");
      return;
    }
    const perViaStopYen = Math.floor(Number(editPerViaStopYen));
    const cancellationFeeYen = Math.floor(Number(editCancellationFeeYen));
    const nightSurchargeBps = Math.floor(Number(editNightSurchargeBps));
    const leftHandSurchargeBps = Math.floor(Number(editLeftHandSurchargeBps));
    if (
      !Number.isFinite(perViaStopYen) ||
      perViaStopYen < 0 ||
      !Number.isFinite(cancellationFeeYen) ||
      cancellationFeeYen < 0 ||
      !Number.isFinite(nightSurchargeBps) ||
      !Number.isFinite(leftHandSurchargeBps)
    ) {
      setErr("版メタの数値は整数で入力してください。");
      return;
    }
    setVerSaveSubmitting(true);
    try {
      const r = await apiFetch<Ver>(`/tariff-versions/${selVer}`, {
        method: "PATCH",
        json: {
          initialDistanceM,
          initialFareYen,
          addUnitDistanceM,
          addFareYen,
          waitingFareYenPerMin,
          distanceMode: editDistanceMode,
          waitingRuleJson,
          perViaStopYen,
          cancellationFeeYen,
          nightSurchargeBps,
          leftHandSurchargeBps,
        },
      });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      await load();
    } finally {
      setVerSaveSubmitting(false);
    }
  }

  function applyWaitingPreset(presetJson: unknown): void {
    const o = presetJson as Record<string, unknown>;
    if (o?.type === "linear") {
      const pm = Math.max(0, Math.floor(Number(o.perMinYen ?? 0)));
      setEditWaitingFareYenPerMin(String(pm));
    }
    setEditWaitingRuleJson(JSON.stringify(presetJson, null, 2));
  }

  function closeSegWizard(): void {
    setSegWizardOpen(false);
    setFromM("");
    setToM("");
    setFareYen("");
    setFareMemberYen("");
  }

  async function submitSegment(): Promise<void> {
    if (!selVer) return;
    setErr(null);
    setSegSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        fromM: Number(fromM),
        toM: Number(toM),
        fareYen: Number(fareYen),
      };
      if (fareMemberYen.trim() !== "") {
        const fm = Math.floor(Number(fareMemberYen));
        if (!Number.isFinite(fm) || fm < 0) {
          setErr("会員運賃は空欄（未使用）か0以上の整数にしてください。");
          return;
        }
        body.fareMemberYen = fm;
      }
      const r = await apiFetch<Seg>(`/tariff-versions/${selVer}/segments`, {
        method: "POST",
        json: body,
      });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      closeSegWizard();
      await load();
    } finally {
      setSegSubmitting(false);
    }
  }

  async function delSegment(id: string): Promise<void> {
    setErr(null);
    const r = await apiFetch(`/tariff-segments/${id}`, { method: "DELETE" });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else await load();
  }

  async function addTier(): Promise<void> {
    if (!selVer) return;
    setErr(null);
    const fromM = Math.floor(Number(tierFromM));
    const stepM = Math.floor(Number(tierStepM));
    const addYenPerStep = Math.floor(Number(tierAddYen));
    const untilRaw = tierUntilM.trim();
    const untilM = untilRaw === "" ? null : Math.floor(Number(untilRaw));
    if (!Number.isFinite(fromM) || fromM < 0 || !Number.isFinite(stepM) || stepM < 1 || !Number.isFinite(addYenPerStep) || addYenPerStep < 0) {
      setErr("ティア: fromM・stepM・加算額を正しく入力してください。");
      return;
    }
    if (untilRaw !== "" && (!Number.isFinite(untilM as number) || (untilM as number) <= fromM)) {
      setErr("ティア: untilM は空（最後まで）か、fromM より大きい整数にしてください。");
      return;
    }
    setTierSubmitting(true);
    try {
      const r = await apiFetch<Tier>(`/tariff-versions/${selVer}/distance-tiers`, {
        method: "POST",
        json: { fromM, untilM, stepM, addYenPerStep },
      });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setTierFromM("");
      setTierUntilM("");
      await load();
    } finally {
      setTierSubmitting(false);
    }
  }

  async function delTier(id: string): Promise<void> {
    setErr(null);
    const r = await apiFetch(`/tariff-distance-tiers/${id}`, { method: "DELETE" });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else await load();
  }

  const nameOk = name.trim().length > 0;
  const fromOk = fromM.trim() !== "" && !Number.isNaN(Number(fromM));
  const toOk = toM.trim() !== "" && !Number.isNaN(Number(toM));
  const fareOk = fareYen.trim() !== "" && !Number.isNaN(Number(fareYen));
  const segNumsOk = fromOk && toOk && fareOk && Number(fromM) < Number(toM);

  const planSteps: StepWizardStep[] = [
    {
      id: "plan-name",
      title: "プラン名を入力してください",
      description: "初版の料金版が自動で作成されます。",
      canProceed: nameOk,
      children: (
        <>
          <label>新規プラン名</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </>
      ),
    },
    {
      id: "plan-confirm",
      title: "作成内容の確認",
      canProceed: nameOk,
      children: (
        <dl className="step-wizard-summary">
          <dt>プラン名</dt>
          <dd>{name.trim()}</dd>
        </dl>
      ),
    },
  ];

  const segmentSteps: StepWizardStep[] = [
    {
      id: "from",
      title: "距離の開始（m）",
      description: "セグメントの開始メートルです。",
      canProceed: fromOk,
      children: (
        <>
          <label>開始距離（m）</label>
          <input value={fromM} onChange={(e) => setFromM(e.target.value)} inputMode="numeric" autoFocus />
        </>
      ),
    },
    {
      id: "to",
      title: "距離の終了（m）",
      description: "終了メートルは開始より大きい必要があります。",
      canProceed: toOk && fromOk && Number(toM) > Number(fromM),
      children: (
        <>
          <label>終了距離（m）</label>
          <input value={toM} onChange={(e) => setToM(e.target.value)} inputMode="numeric" />
        </>
      ),
    },
    {
      id: "fare",
      title: "運賃（円）",
      description: "この距離帯に適用する金額です。",
      canProceed: fareOk,
      children: (
        <>
          <label>一般運賃（円）</label>
          <input value={fareYen} onChange={(e) => setFareYen(e.target.value)} inputMode="numeric" />
          <label>会員運賃（円・任意）</label>
          <input
            value={fareMemberYen}
            onChange={(e) => setFareMemberYen(e.target.value)}
            inputMode="numeric"
            placeholder="空欄で一般と同額"
          />
        </>
      ),
    },
    {
      id: "seg-confirm",
      title: "登録内容の確認",
      canProceed: Boolean(selVer) && segNumsOk,
      children: (
        <dl className="step-wizard-summary">
          <dt>適用料金版</dt>
          <dd>{findVerLabel(plans, selVer)}</dd>
          <dt>距離帯</dt>
          <dd>
            {fromM} – {toM} m
          </dd>
          <dt>一般運賃</dt>
          <dd>{fareYen} 円</dd>
          {fareMemberYen.trim() !== "" ? (
            <>
              <dt>会員運賃</dt>
              <dd>{fareMemberYen} 円</dd>
            </>
          ) : null}
        </dl>
      ),
    },
  ];

  return (
    <Card title="料金プラン">
      <Err msg={err} />
      <p style={{ fontSize: "0.82rem", marginTop: 0 }}>
        料金版一覧は直近30版まで表示します（URL <code>?versionsLimit=1〜100</code> で API から変更可能）。「新版追加」は直前の版の数値・セグメント・距離ティア・待機ルールをコピーします。
      </p>
      <p style={{ marginTop: 0 }}>
        <button type="button" onClick={() => setPlanWizardOpen(true)}>
          新規プランを作成
        </button>{" "}
        <button type="button" onClick={() => setSegWizardOpen(true)} disabled={!selVer}>
          距離帯セグメントを追加
        </button>
      </p>
      <StepWizard
        open={planWizardOpen}
        onClose={() => {
          setPlanWizardOpen(false);
          setName("");
        }}
        title="料金プランを作成"
        steps={planSteps}
        finishLabel="プラン作成（初版付き）"
        onFinish={submitPlan}
        isSubmitting={planSubmitting}
      />
      <StepWizard
        open={segWizardOpen}
        onClose={closeSegWizard}
        title="距離帯セグメントを追加"
        steps={segmentSteps}
        finishLabel="セグメント追加"
        onFinish={submitSegment}
        isSubmitting={segSubmitting}
      />

      {selVer && selectedVersion ? (
        <section style={{ marginTop: "1rem", padding: "0.75rem", border: "1px solid #ccc", borderRadius: 4, maxWidth: 640 }}>
          <h3 style={{ marginTop: 0, fontSize: "1rem" }}>運賃シミュレータ（{findVerLabel(plans, selVer)}）</h3>
          <p style={{ fontSize: "0.8rem", marginTop: 0 }}>
            距離モードに応じて試算します（SEGMENTS_ONLY は表のヒットのみ、TIERED_ADD はティア加算）。待機は JSON ルール、経由は版の「経由1回あたり」×回数。夜間・左ハンドルは距離運賃部分に Bps を乗算します。
          </p>
          <label>走行距離（km）</label>
          <input value={simDistanceKm} onChange={(e) => setSimDistanceKm(e.target.value)} inputMode="decimal" placeholder="例: 5.2" />
          <label>待機（分）</label>
          <input value={simWaitMin} onChange={(e) => setSimWaitMin(e.target.value)} inputMode="numeric" />
          <label>
            <input type="checkbox" checked={simMember} onChange={(e) => setSimMember(e.target.checked)} /> 会員（会員運賃列ありのとき）
          </label>
          <label>経由ストップ回数（試算）</label>
          <input value={simViaStops} onChange={(e) => setSimViaStops(e.target.value)} inputMode="numeric" />
          <label>
            <input type="checkbox" checked={simNight} onChange={(e) => setSimNight(e.target.checked)} /> 夜間割増を距離運賃に適用
          </label>
          <label>
            <input type="checkbox" checked={simLeftHand} onChange={(e) => setSimLeftHand(e.target.checked)} /> 左ハンドル割増を距離運賃に適用
          </label>
          <p style={{ marginTop: "0.5rem", fontWeight: 600 }}>
            試算運賃: {simResultYen === null ? "—" : `${simResultYen.toLocaleString("ja-JP")} 円`}
          </p>
        </section>
      ) : null}

      {selVer && selectedVersion ? (
        <section style={{ marginTop: "1rem", padding: "0.75rem", border: "1px solid #ccc", borderRadius: 4, maxWidth: 640 }}>
          <h3 style={{ marginTop: 0, fontSize: "1rem" }}>選択中の料金版を編集</h3>
          <label>距離モード</label>
          <select value={editDistanceMode} onChange={(e) => setEditDistanceMode(e.target.value)}>
            <option value="INITIAL_ADD">初乗り＋単一加算（従来）</option>
            <option value="SEGMENTS_ONLY">セグメント表のみ</option>
            <option value="TIERED_ADD">初乗り＋多段距離加算（ティア）</option>
          </select>
          <label>初乗り距離（m）</label>
          <input value={editInitialDistanceM} onChange={(e) => setEditInitialDistanceM(e.target.value)} inputMode="numeric" />
          <label>初乗り運賃（円）</label>
          <input value={editInitialFareYen} onChange={(e) => setEditInitialFareYen(e.target.value)} inputMode="numeric" />
          <label>加算距離単位（m）</label>
          <input value={editAddUnitDistanceM} onChange={(e) => setEditAddUnitDistanceM(e.target.value)} inputMode="numeric" />
          <label>加算運賃（円／単位）</label>
          <input value={editAddFareYen} onChange={(e) => setEditAddFareYen(e.target.value)} inputMode="numeric" />
          <label>待機（互換・円／分・線形プリセット時は JSON と同期）</label>
          <input value={editWaitingFareYenPerMin} onChange={(e) => setEditWaitingFareYenPerMin(e.target.value)} inputMode="numeric" />
          <p style={{ fontSize: "0.8rem", marginTop: "0.5rem" }}>待機プリセット（適用後に必要なら JSON を直接編集）</p>
          <p>
            {WAITING_PRESETS.map((p) => (
              <button key={p.id} type="button" style={{ marginRight: 6, marginBottom: 6 }} onClick={() => applyWaitingPreset(p.json)}>
                {p.label}
              </button>
            ))}
          </p>
          <label>待機ルール JSON</label>
          <textarea value={editWaitingRuleJson} onChange={(e) => setEditWaitingRuleJson(e.target.value)} rows={6} style={{ width: "100%", fontFamily: "monospace", fontSize: "0.85rem" }} />
          <label>経由1回あたり（円・試算・将来の便入力用）</label>
          <input value={editPerViaStopYen} onChange={(e) => setEditPerViaStopYen(e.target.value)} inputMode="numeric" />
          <label>キャンセル料（円・帳票用メタ）</label>
          <input value={editCancellationFeeYen} onChange={(e) => setEditCancellationFeeYen(e.target.value)} inputMode="numeric" />
          <label>夜間割増（bps、10000=100%）</label>
          <input value={editNightSurchargeBps} onChange={(e) => setEditNightSurchargeBps(e.target.value)} inputMode="numeric" />
          <label>左ハンドル割増（bps）</label>
          <input value={editLeftHandSurchargeBps} onChange={(e) => setEditLeftHandSurchargeBps(e.target.value)} inputMode="numeric" />
          <p style={{ marginTop: "0.75rem" }}>
            <button type="button" disabled={verSaveSubmitting} onClick={() => void saveVersionParams()}>
              {verSaveSubmitting ? "保存中…" : "料金版を保存"}
            </button>
          </p>
        </section>
      ) : null}

      {selVer && selectedVersion && (editDistanceMode === "TIERED_ADD" || (selectedVersion.distanceTiers?.length ?? 0) > 0) ? (
        <section style={{ marginTop: "1rem", padding: "0.75rem", border: "1px solid #ccc", borderRadius: 4, maxWidth: 640 }}>
          <h3 style={{ marginTop: 0, fontSize: "1rem" }}>距離加算ティア（TIERED_ADD）</h3>
          <p style={{ fontSize: "0.8rem", marginTop: 0 }}>
            初乗り終端からの距離を、fromM 以上・untilM 未満の区間で stepM ごとに加算します。untilM を空にすると最後まで続きます。
          </p>
          <ul>
            {[...(selectedVersion.distanceTiers ?? [])]
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((t) => (
                <li key={t.id}>
                  order {t.sortOrder}: {t.fromM}m–{t.untilM == null ? "∞" : `${t.untilM}m`} / {t.stepM}m ごと +{t.addYenPerStep}円{" "}
                  <button type="button" onClick={() => void delTier(t.id)}>
                    削除
                  </button>
                </li>
              ))}
          </ul>
          <label>fromM（m）</label>
          <input value={tierFromM} onChange={(e) => setTierFromM(e.target.value)} inputMode="numeric" placeholder="例: 2000" />
          <label>untilM（空=最後まで）</label>
          <input value={tierUntilM} onChange={(e) => setTierUntilM(e.target.value)} inputMode="numeric" />
          <label>stepM</label>
          <input value={tierStepM} onChange={(e) => setTierStepM(e.target.value)} inputMode="numeric" />
          <label>加算（円/step）</label>
          <input value={tierAddYen} onChange={(e) => setTierAddYen(e.target.value)} inputMode="numeric" />
          <p style={{ marginTop: "0.5rem" }}>
            <button type="button" disabled={tierSubmitting} onClick={() => void addTier()}>
              {tierSubmitting ? "追加中…" : "ティアを追加"}
            </button>
          </p>
        </section>
      ) : null}

      {plans.map((p) => (
        <div key={p.id} style={{ marginTop: "1rem" }}>
          <strong>{p.name}</strong>{" "}
          <button type="button" onClick={() => void addVersion(p.id)}>
            新版追加（前版からコピー）
          </button>
          <ul>
            {p.versions.map((v) => (
              <li key={v.id}>
                <label>
                  <input type="radio" name="ver" checked={selVer === v.id} onChange={() => setSelVer(v.id)} /> v{v.version}{" "}
                  [{v.distanceMode ?? "INITIAL_ADD"}] 初乗り{v.initialDistanceM}m/{v.initialFareYen}円 加算{v.addUnitDistanceM}m/{v.addFareYen}円 待機
                  {v.waitingFareYenPerMin}円/分
                </label>
                <ul>
                  {[...v.segments]
                    .sort((a, b) => a.fromM - b.fromM)
                    .map((s) => (
                      <li key={s.id}>
                        {s.fromM}–{s.toM}m → 一般{s.fareYen}円
                        {s.fareMemberYen != null ? ` / 会員${s.fareMemberYen}円` : ""}{" "}
                        <button type="button" onClick={() => void delSegment(s.id)}>
                          削除
                        </button>
                      </li>
                    ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Card>
  );
}

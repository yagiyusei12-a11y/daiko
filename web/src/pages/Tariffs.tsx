import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import { fareYenForTrip } from "../lib/tariffPricing";
import { Card, Err, StepWizard, type StepWizardStep } from "../ui";

const TARIFF_PLANS_QUERY = "?versionsLimit=30";

type Seg = { id: string; fromM: number; toM: number; fareYen: number };
type Ver = {
  id: string;
  version: number;
  initialDistanceM: number;
  initialFareYen: number;
  addUnitDistanceM: number;
  addFareYen: number;
  waitingFareYenPerMin: number;
  segments: Seg[];
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

  const [editInitialDistanceM, setEditInitialDistanceM] = useState("");
  const [editInitialFareYen, setEditInitialFareYen] = useState("");
  const [editAddUnitDistanceM, setEditAddUnitDistanceM] = useState("");
  const [editAddFareYen, setEditAddFareYen] = useState("");
  const [editWaitingFareYenPerMin, setEditWaitingFareYenPerMin] = useState("");

  const [simDistanceKm, setSimDistanceKm] = useState("");
  const [simWaitMin, setSimWaitMin] = useState("0");

  const selectedVersion = useMemo(() => findVersion(plans, selVer), [plans, selVer]);

  const simResultYen = useMemo(() => {
    if (!selectedVersion) return null;
    const km = Number(simDistanceKm);
    const wait = Number(simWaitMin);
    if (!Number.isFinite(km) || km < 0 || !Number.isFinite(wait) || wait < 0) return null;
    const distanceM = Math.round(km * 1000);
    return fareYenForTrip(
      {
        initialDistanceM: selectedVersion.initialDistanceM,
        initialFareYen: selectedVersion.initialFareYen,
        addUnitDistanceM: selectedVersion.addUnitDistanceM,
        addFareYen: selectedVersion.addFareYen,
        waitingFareYenPerMin: selectedVersion.waitingFareYenPerMin,
      },
      distanceM,
      wait,
      selectedVersion.segments,
    );
  }, [selectedVersion, simDistanceKm, simWaitMin]);

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

  function closeSegWizard(): void {
    setSegWizardOpen(false);
    setFromM("");
    setToM("");
    setFareYen("");
  }

  async function submitSegment(): Promise<void> {
    if (!selVer) return;
    setErr(null);
    setSegSubmitting(true);
    try {
      const r = await apiFetch<Seg>(`/tariff-versions/${selVer}/segments`, {
        method: "POST",
        json: { fromM: Number(fromM), toM: Number(toM), fareYen: Number(fareYen) },
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
          <label>運賃（円）</label>
          <input value={fareYen} onChange={(e) => setFareYen(e.target.value)} inputMode="numeric" />
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
          <dt>運賃</dt>
          <dd>{fareYen} 円</dd>
        </dl>
      ),
    },
  ];

  return (
    <Card title="料金プラン">
      <Err msg={err} />
      <p style={{ fontSize: "0.82rem", marginTop: 0 }}>
        料金版一覧は直近30版まで表示します（URL <code>?versionsLimit=1〜100</code> で API から変更可能）。「新版追加」は直前の版の数値と距離帯セグメントをコピーします。
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
        <section style={{ marginTop: "1rem", padding: "0.75rem", border: "1px solid #ccc", borderRadius: 4, maxWidth: 520 }}>
          <h3 style={{ marginTop: 0, fontSize: "1rem" }}>運賃シミュレータ（{findVerLabel(plans, selVer)}）</h3>
          <p style={{ fontSize: "0.8rem", marginTop: 0 }}>
            走行距離に該当するセグメントがあればその運賃を優先し、なければ初乗り＋加算で計算します。待機分は距離運賃に加算されます。
          </p>
          <label>走行距離（km）</label>
          <input value={simDistanceKm} onChange={(e) => setSimDistanceKm(e.target.value)} inputMode="decimal" placeholder="例: 5.2" />
          <label>待機（分）</label>
          <input value={simWaitMin} onChange={(e) => setSimWaitMin(e.target.value)} inputMode="numeric" />
          <p style={{ marginTop: "0.5rem", fontWeight: 600 }}>
            試算運賃: {simResultYen === null ? "—" : `${simResultYen.toLocaleString("ja-JP")} 円`}
          </p>
        </section>
      ) : null}

      {selVer && selectedVersion ? (
        <section style={{ marginTop: "1rem", padding: "0.75rem", border: "1px solid #ccc", borderRadius: 4, maxWidth: 520 }}>
          <h3 style={{ marginTop: 0, fontSize: "1rem" }}>選択中の料金版を編集</h3>
          <label>初乗り距離（m）</label>
          <input value={editInitialDistanceM} onChange={(e) => setEditInitialDistanceM(e.target.value)} inputMode="numeric" />
          <label>初乗り運賃（円）</label>
          <input value={editInitialFareYen} onChange={(e) => setEditInitialFareYen(e.target.value)} inputMode="numeric" />
          <label>加算距離単位（m）</label>
          <input value={editAddUnitDistanceM} onChange={(e) => setEditAddUnitDistanceM(e.target.value)} inputMode="numeric" />
          <label>加算運賃（円／単位）</label>
          <input value={editAddFareYen} onChange={(e) => setEditAddFareYen(e.target.value)} inputMode="numeric" />
          <label>待機運賃（円／分）</label>
          <input value={editWaitingFareYenPerMin} onChange={(e) => setEditWaitingFareYenPerMin(e.target.value)} inputMode="numeric" />
          <p style={{ marginTop: "0.75rem" }}>
            <button type="button" disabled={verSaveSubmitting} onClick={() => void saveVersionParams()}>
              {verSaveSubmitting ? "保存中…" : "料金版を保存"}
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
                  初乗り{v.initialDistanceM}m/{v.initialFareYen}円 加算{v.addUnitDistanceM}m/{v.addFareYen}円 待機{v.waitingFareYenPerMin}円/分
                </label>
                <ul>
                  {[...v.segments]
                    .sort((a, b) => a.fromM - b.fromM)
                    .map((s) => (
                      <li key={s.id}>
                        {s.fromM}–{s.toM}m → {s.fareYen}円{" "}
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

import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { Card, Err, StepWizard, type StepWizardStep } from "../ui";

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

export default function Tariffs(): JSX.Element {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [planWizardOpen, setPlanWizardOpen] = useState(false);
  const [planSubmitting, setPlanSubmitting] = useState(false);
  const [segWizardOpen, setSegWizardOpen] = useState(false);
  const [segSubmitting, setSegSubmitting] = useState(false);
  const [selVer, setSelVer] = useState<string | null>(null);
  const [fromM, setFromM] = useState("");
  const [toM, setToM] = useState("");
  const [fareYen, setFareYen] = useState("");

  async function load(): Promise<void> {
    const r = await apiFetch<{ plans: Plan[] }>("/tariff-plans");
    if (r.ok) {
      setPlans(r.data.plans);
      if (!selVer && r.data.plans[0]?.versions[0]) setSelVer(r.data.plans[0].versions[0].id);
    } else setErr(r.error);
  }

  useEffect(() => {
    void load();
  }, []);

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
          <label>fromM (m)</label>
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
          <label>toM (m)</label>
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
          <label>fareYen</label>
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
      {plans.map((p) => (
        <div key={p.id} style={{ marginTop: "1rem" }}>
          <strong>{p.name}</strong>{" "}
          <button type="button" onClick={() => void addVersion(p.id)}>
            新版追加
          </button>
          <ul>
            {p.versions.map((v) => (
              <li key={v.id}>
                <label>
                  <input type="radio" name="ver" checked={selVer === v.id} onChange={() => setSelVer(v.id)} /> v{v.version}{" "}
                  初乗り{v.initialDistanceM}m/{v.initialFareYen}円 加算{v.addUnitDistanceM}m/{v.addFareYen}円 待機{v.waitingFareYenPerMin}円/分
                </label>
                <ul>
                  {v.segments.map((s) => (
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

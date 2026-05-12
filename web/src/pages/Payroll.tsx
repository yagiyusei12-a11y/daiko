import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api";
import { Card, Err, StepWizard, Tabs, type StepWizardStep } from "../ui";

type Line = {
  id: string;
  grossSalesYen: number;
  netPayYen: number;
  employee: { familyName: string; givenName: string };
};
type Run = {
  id: string;
  periodYm: string;
  status: string;
  poolRateBps: number;
  lines: Line[];
};

export default function Payroll(): JSX.Element {
  const [payTab, setPayTab] = useState("list");
  const [runs, setRuns] = useState<Run[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [filterYm, setFilterYm] = useState("");
  const [previewWizardOpen, setPreviewWizardOpen] = useState(false);
  const [previewSubmitting, setPreviewSubmitting] = useState(false);
  const [previewYm, setPreviewYm] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [poolBps, setPoolBps] = useState("0");

  async function load(): Promise<void> {
    setErr(null);
    const qs = filterYm && /^\d{4}-\d{2}$/.test(filterYm) ? `?periodYm=${encodeURIComponent(filterYm)}` : "";
    const r = await apiFetch<{ runs: Run[] }>(`/payroll-runs${qs}`);
    if (r.ok) setRuns(r.data.runs);
    else setErr(r.error);
  }

  useEffect(() => {
    void load();
  }, [filterYm]);

  async function submitPreview(): Promise<void> {
    setErr(null);
    setPreviewSubmitting(true);
    try {
      const r = await apiFetch<{ run: Run }>("/payroll-runs/preview", {
        method: "POST",
        json: { periodYm: previewYm, poolRateBps: Number(poolBps || 0) },
      });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setPreviewWizardOpen(false);
      setPayTab("list");
      await load();
    } finally {
      setPreviewSubmitting(false);
    }
  }

  const ymOk = /^\d{4}-\d{2}$/.test(previewYm);
  const poolOk = poolBps.trim() === "" || (!Number.isNaN(Number(poolBps)) && Number(poolBps) >= 0 && Number(poolBps) <= 10000);

  const previewSteps: StepWizardStep[] = [
    {
      id: "pym",
      title: "対象月を選んでください",
      description: "プレビュー再計算する給与月です。",
      canProceed: ymOk,
      children: (
        <>
          <label>対象月（YYYY-MM）</label>
          <input type="month" value={previewYm} onChange={(e) => setPreviewYm(e.target.value)} required />
        </>
      ),
    },
    {
      id: "pool",
      title: "プール率（bps）",
      description: "0〜10000 の整数。不明な場合は 0。",
      canProceed: poolOk,
      children: (
        <>
          <label>プール率（bps）</label>
          <input value={poolBps} onChange={(e) => setPoolBps(e.target.value)} inputMode="numeric" />
        </>
      ),
    },
    {
      id: "pconf",
      title: "実行前の確認",
      canProceed: ymOk && poolOk,
      children: (
        <dl className="step-wizard-summary">
          <dt>対象月</dt>
          <dd>{previewYm}</dd>
          <dt>プール率</dt>
          <dd>{poolBps || "0"} bps</dd>
        </dl>
      ),
    },
  ];

  async function lock(id: string): Promise<void> {
    setErr(null);
    const r = await apiFetch(`/payroll-runs/${id}/lock`, { method: "POST" });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else await load();
  }

  async function unlock(id: string): Promise<void> {
    setErr(null);
    const r = await apiFetch(`/payroll-runs/${id}/unlock`, { method: "POST" });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else await load();
  }

  return (
    <Card title="給与（月次）">
      <Err msg={err} />
      <p style={{ fontSize: "0.85rem", marginTop: 0 }}>
        プレビューでドラフト行を再計算します。ロック後はその月の日報削除などが 403 になります。
      </p>
      <Tabs
        aria-label="給与セクション"
        activeId={payTab}
        onActiveChange={setPayTab}
        items={[
          {
            id: "list",
            label: "一覧",
            children: (
              <>
                <label>一覧フィルタ（YYYY-MM、空なら直近）</label>
                <input
                  type="month"
                  value={filterYm}
                  onChange={(e) => setFilterYm(e.target.value)}
                  placeholder="2026-05"
                />
                <button type="button" onClick={() => void load()}>
                  再読込
                </button>
                <h3 style={{ fontSize: "1rem", margin: "1rem 0 0.5rem" }}>給与ラン一覧</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>月</th>
                        <th>状態</th>
                        <th>行数</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((x) => (
                        <tr key={x.id}>
                          <td>{x.periodYm}</td>
                          <td>{x.status}</td>
                          <td>{x.lines?.length ?? 0}</td>
                          <td>
                            <Link to={`/payroll/${x.id}`}>明細</Link>{" "}
                            {x.status !== "LOCKED" ? (
                              <button type="button" onClick={() => void lock(x.id)}>
                                ロック
                              </button>
                            ) : (
                              <button type="button" onClick={() => void unlock(x.id)}>
                                解除
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ),
          },
          {
            id: "preview",
            label: "プレビュー・再計算",
            children: (
              <>
                <p style={{ marginTop: 0 }}>
                  <button type="button" onClick={() => setPreviewWizardOpen(true)}>
                    プレビュー再計算を実行
                  </button>
                </p>
                <StepWizard
                  open={previewWizardOpen}
                  onClose={() => setPreviewWizardOpen(false)}
                  title="給与プレビュー再計算"
                  steps={previewSteps}
                  finishLabel="プレビュー保存"
                  onFinish={submitPreview}
                  isSubmitting={previewSubmitting}
                />
              </>
            ),
          },
        ]}
      />
    </Card>
  );
}

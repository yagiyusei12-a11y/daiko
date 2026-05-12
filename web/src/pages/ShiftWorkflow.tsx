import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api";
import { useAuth } from "../auth";
import { Card, Err } from "../ui";

type Punch = {
  id: string;
  businessDate: string;
  clockInAt: string;
  clockOutAt: string | null;
};

function todayYmd(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function ShiftWorkflow(): JSX.Element {
  const { me, refreshMe } = useAuth();
  const [err, setErr] = useState<string | null>(null);
  const [punches, setPunches] = useState<Punch[]>([]);
  const [checkCount, setCheckCount] = useState(0);
  const [reportCount, setReportCount] = useState(0);
  const [clocking, setClocking] = useState(false);
  const [phase, setPhase] = useState("運転前");
  const [alcoholSubmitting, setAlcoholSubmitting] = useState(false);

  const linked = Boolean(me?.employeeId);
  const openPunch = punches.find((p) => !p.clockOutAt) ?? null;

  const loadState = useCallback(async () => {
    setErr(null);
    const bd = todayYmd();
    const [pRes, aRes, rRes] = await Promise.all([
      apiFetch<{ punches: Punch[] }>(`/time-punches?businessDate=${encodeURIComponent(bd)}`),
      apiFetch<{ checks: { id: string }[] }>(`/alcohol-checks?businessDate=${encodeURIComponent(bd)}`),
      apiFetch<{ dailyReports: { id: string }[] }>(`/daily-reports?from=${encodeURIComponent(bd)}&to=${encodeURIComponent(bd)}`),
    ]);
    if (pRes.ok) setPunches(pRes.data.punches);
    else setErr(pRes.error);
    if (aRes.ok) setCheckCount(aRes.data.checks.length);
    if (rRes.ok) setReportCount(rRes.data.dailyReports.length);
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState, me?.id, me?.employeeId]);

  async function clockIn(): Promise<void> {
    if (!me?.employeeId) return;
    setErr(null);
    setClocking(true);
    try {
      const r = await apiFetch<Punch>("/time-punches/clock-in", {
        method: "POST",
        json: { employeeId: me.employeeId },
      });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      await loadState();
    } finally {
      setClocking(false);
    }
  }

  async function clockOut(): Promise<void> {
    if (!openPunch) return;
    setErr(null);
    setClocking(true);
    try {
      const r = await apiFetch<Punch>(`/time-punches/${openPunch.id}/clock-out`, { method: "POST", json: {} });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      await loadState();
    } finally {
      setClocking(false);
    }
  }

  async function submitAlcohol(): Promise<void> {
    if (!me?.employeeId) return;
    setErr(null);
    setAlcoholSubmitting(true);
    try {
      const r = await apiFetch("/alcohol-checks", {
        method: "POST",
        json: {
          employeeId: me.employeeId,
          phase: phase.trim() || "確認",
          detectorUsed: true,
          resultPositive: false,
        },
      });
      if (!r.ok) {
        setErr((r as { ok: false; error: string }).error);
        return;
      }
      await loadState();
    } finally {
      setAlcoholSubmitting(false);
    }
  }

  return (
    <div className="stack-form" style={{ maxWidth: 640 }}>
      <Card title="本日の勤務">
        <Err msg={err} />
        <p style={{ marginTop: 0, fontSize: "0.95rem", opacity: 0.9 }}>
          出勤時は順に進めてください。管理者にアカウントと従業員の紐づけがまだの場合は、権限画面から依頼してください。
        </p>
        {!linked ? (
          <p style={{ color: "crimson", fontWeight: 600 }}>
            このアカウントには従業員が紐づいていません。打刻・酒気の記録はできません（日報一覧は自分が関わる分のみ表示されます）。
          </p>
        ) : null}
      </Card>

      <Card title="1. 出勤打刻">
        <p style={{ marginTop: 0 }}>
          {openPunch ? (
            <>
              出勤済み: {new Date(openPunch.clockInAt).toLocaleString()}（未退勤）
            </>
          ) : (
            <>まだ出勤打刻がありません。</>
          )}
        </p>
        {!linked ? null : openPunch ? (
          <p style={{ fontSize: "0.9rem" }}>退勤は下の「4. 退勤打刻」で行います。</p>
        ) : (
          <button type="button" disabled={clocking} onClick={() => void clockIn()}>
            出勤する
          </button>
        )}
      </Card>

      <Card title="2. 酒気確認">
        <p style={{ marginTop: 0, fontSize: "0.9rem" }}>
          本日の記録: <strong>{checkCount}</strong> 件
        </p>
        {!linked ? null : (
          <>
            <label>段階</label>
            <p>
              <button type="button" onClick={() => setPhase("運転前")}>
                運転前
              </button>{" "}
              <button type="button" onClick={() => setPhase("運転後")}>
                運転後
              </button>
            </p>
            <input value={phase} onChange={(e) => setPhase(e.target.value)} style={{ width: "100%", marginBottom: "0.5rem" }} />
            <button type="button" disabled={alcoholSubmitting} onClick={() => void submitAlcohol()}>
              酒気確認を記録（簡易）
            </button>
            <p style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>
              詳細（確認者・方法など）は <Link to="/alcohol">酒気</Link> ページから追加できます。
            </p>
          </>
        )}
      </Card>

      <Card title="3. 日報">
        <p style={{ marginTop: 0 }}>
          本日の関連日報: <strong>{reportCount}</strong> 件
        </p>
        <p>
          <Link to="/daily-reports">日報一覧・作成へ</Link>
        </p>
      </Card>

      <Card title="4. 退勤打刻">
        {!linked ? null : !openPunch ? (
          <p style={{ marginTop: 0 }}>未退勤の打刻がありません。先に出勤してください。</p>
        ) : (
          <>
            <p style={{ marginTop: 0 }}>未退勤の打刻があります。退勤しますか？</p>
            <button type="button" disabled={clocking} onClick={() => void clockOut()}>
              退勤する
            </button>
          </>
        )}
      </Card>

      <p>
        <button type="button" onClick={() => void refreshMe()}>
          アカウント情報を再読込
        </button>{" "}
        <button type="button" onClick={() => void loadState()}>
          状態を更新
        </button>
      </p>
    </div>
  );
}

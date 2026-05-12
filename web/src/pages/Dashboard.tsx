import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { Card, Err } from "../ui";

type Dash = {
  ym: string;
  salesYen: number;
  tripLegCount: number;
  dailyReportCount: number;
  attendance: { minutesTotal: number; completedPunchCount: number };
};

export default function Dashboard(): JSX.Element {
  const ym = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const [v, setV] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await apiFetch<Dash>(`/dashboard?ym=${encodeURIComponent(ym)}`);
      if (r.ok) setV(r.data);
      else setErr(r.error);
    })();
  }, [ym]);

  return (
    <>
      <Card title="いま月のざっくり集計">
        <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--color-muted)" }}>この画面の数字は「おおよその把握」用です。細かい給与や日報はそれぞれの画面で確認してください。</p>
        <p style={{ margin: "0.35rem 0 0", fontSize: "0.9rem" }}>集計する月: {ym}</p>
        <Err msg={err} />
        {v ? (
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem" }}>
            <li>お客様からいただいた運賃の合計（ざっくり）: {v.salesYen.toLocaleString()} 円</li>
            <li>送迎の件数（区間ベース）: {v.tripLegCount}</li>
            <li>業務の記録（日報）の件数: {v.dailyReportCount}</li>
            <li>出退勤の記録で「退勤まで打った」件数: {v.attendance.completedPunchCount}</li>
            <li>出退勤の合計時間（分）: {v.attendance.minutesTotal} 分</li>
          </ul>
        ) : !err ? (
          <p>読み込み中…</p>
        ) : null}
      </Card>
    </>
  );
}

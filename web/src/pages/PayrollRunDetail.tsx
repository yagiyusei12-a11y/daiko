import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../api";
import { Card, Err } from "../ui";

type Line = {
  id: string;
  grossSalesYen: number;
  hourlyYen: number;
  commissionYen: number;
  poolYen: number;
  netPayYen: number;
  employee: { familyName: string; givenName: string };
};
type Run = { id: string; periodYm: string; status: string; poolRateBps: number; lines: Line[] };

export default function PayrollRunDetail(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<Run | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const r = await apiFetch<{ run: Run }>(`/payroll-runs/${id}`);
      if (r.ok) setRun(r.data.run);
      else setErr(r.error);
    })();
  }, [id]);

  if (!id) return <Err msg="id がありません" />;
  if (err) return <Err msg={err} />;
  if (!run) return <p>読み込み中…</p>;

  return (
    <Card title={`${run.periodYm} の給与の内訳（状態: ${run.status}）`}>
      <p style={{ fontSize: "0.88rem" }}>
        <Link to="/payroll">← 月ごとの一覧へ</Link>
        {" · "}
        みんなで分ける割合（プール）: {run.poolRateBps} bps（100 bps ＝ 1%）
      </p>
      <table style={{ marginTop: "0.5rem" }}>
        <thead>
          <tr>
            <th>氏名</th>
            <th>売上</th>
            <th>時給計</th>
            <th>歩合</th>
            <th>プール</th>
            <th>手取り</th>
          </tr>
        </thead>
        <tbody>
          {run.lines.map((ln) => (
            <tr key={ln.id}>
              <td>
                {ln.employee.familyName} {ln.employee.givenName}
              </td>
              <td>{ln.grossSalesYen}</td>
              <td>{ln.hourlyYen}</td>
              <td>{ln.commissionYen}</td>
              <td>{ln.poolYen}</td>
              <td>{ln.netPayYen}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

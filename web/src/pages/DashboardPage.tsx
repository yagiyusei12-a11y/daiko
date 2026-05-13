import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";
import { Card, Err } from "../ui";

type Summary = {
  asOfBusinessDateTokyo: string;
  thisMonthYm: string;
  prevMonthYm: string;
  totals: { todayYen: number; thisMonthYen: number; prevMonthYen: number };
  byMainDriver: Array<{
    employeeId: string;
    name: string;
    todayYen: number;
    thisMonthYen: number;
    prevMonthYen: number;
  }>;
};

function formatYen(n: number): string {
  return new Intl.NumberFormat("ja-JP").format(n);
}

export default function DashboardPage(): JSX.Element {
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<Summary | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    const r = await apiFetch<Summary>("/dashboard/summary");
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setData(r.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card title="ダッシュボード">
      <Err msg={err} />
      {!data ? (
        <p className="settings-hint">読み込み中…</p>
      ) : (
        <>
          <p className="settings-hint">
            事業日（東京）{data.asOfBusinessDateTokyo} 時点。運行区間の運賃（手動上書きがあればその金額）を日報の客車担当者に紐づけて集計しています。
          </p>
          <h3 className="settings-subtitle">全体</h3>
          <ul className="settings-sf-list">
            <li className="settings-sf-row attend-shift-list-row">
              <span className="settings-sf-name">当日売上</span>
              <span className="settings-sf-meta">{formatYen(data.totals.todayYen)} 円</span>
            </li>
            <li className="settings-sf-row attend-shift-list-row">
              <span className="settings-sf-name">今月売上（{data.thisMonthYm}）</span>
              <span className="settings-sf-meta">{formatYen(data.totals.thisMonthYen)} 円</span>
            </li>
            <li className="settings-sf-row attend-shift-list-row">
              <span className="settings-sf-name">先月売上（{data.prevMonthYm}）</span>
              <span className="settings-sf-meta">{formatYen(data.totals.prevMonthYen)} 円</span>
            </li>
          </ul>

          <h3 className="settings-subtitle" style={{ marginTop: "1.25rem" }}>
            客車担当者別
          </h3>
          {data.byMainDriver.length === 0 ? (
            <p className="settings-hint">該当する運行データはまだありません。</p>
          ) : (
            <div className="dash-driver-table-wrap">
              <table className="dash-driver-table">
                <thead>
                  <tr>
                    <th scope="col">客車担当</th>
                    <th scope="col">当日</th>
                    <th scope="col">今月</th>
                    <th scope="col">先月</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byMainDriver.map((row) => (
                    <tr key={row.employeeId}>
                      <td>{row.name}</td>
                      <td>{formatYen(row.todayYen)}</td>
                      <td>{formatYen(row.thisMonthYen)}</td>
                      <td>{formatYen(row.prevMonthYen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

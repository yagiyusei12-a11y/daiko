import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import { Err } from "../ui";
import {
  type InstructionRow,
  firstDayOfMonth,
  formatInstructionDate,
  lastDayOfMonth,
} from "../lib/instruction-records-ui";

import "../instruction-records-print.css";

/** 書類ページ「指導記録簿」タブ用：期間絞り込み・一覧・印刷 */
export default function InstructionRecordListPrintBlock(): JSX.Element {
  const now = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(() => firstDayOfMonth(now));
  const [to, setTo] = useState(() => lastDayOfMonth(now));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [records, setRecords] = useState<InstructionRow[]>([]);

  const load = useCallback(async () => {
    setErr(null);
    setBusy(true);
    const qs = new URLSearchParams({ from, to });
    const r = await apiFetch<{ records: InstructionRow[] }>(`/instruction-records?${qs.toString()}`);
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setRecords(r.data.records);
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const afterPrint = () => document.body.classList.remove("instruction-records-printing");
    window.addEventListener("afterprint", afterPrint);
    return () => {
      window.removeEventListener("afterprint", afterPrint);
    };
  }, []);

  const onPrint = () => {
    document.body.classList.add("instruction-records-printing");
    window.print();
    window.setTimeout(() => document.body.classList.remove("instruction-records-printing"), 2500);
  };

  const sortedForPrint = useMemo(() => [...records].sort((a, b) => a.date.localeCompare(b.date)), [records]);

  return (
    <div className="instruction-list">
      <Err msg={err} />
      <div className="instruction-filter no-print field-grid">
        <label className="field">
          <span className="field-label">開始日</span>
          <input className="field-control" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">終了日</span>
          <input className="field-control" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <div className="instruction-filter-actions">
          <button type="button" className="settings-secondary" disabled={busy} onClick={() => void load()}>
            {busy ? "検索中…" : "絞り込み"}
          </button>
          <button type="button" className="settings-primary" disabled={busy || records.length === 0} onClick={onPrint}>
            印刷
          </button>
        </div>
      </div>

      <p className="settings-hint no-print" style={{ marginTop: 0 }}>
        登録はメニュー「指導」から行えます。ここでは期間を指定して一覧表示し、A4横で印刷できます。
      </p>

      <div className="instruction-screen-table-wrap no-print">
        <table className="instruction-table instruction-table--screen">
          <thead>
            <tr>
              <th>No</th>
              <th>指導日時</th>
              <th>氏名</th>
              <th>指導事項</th>
              <th>特記事項</th>
              <th>備考</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr>
                <td colSpan={6} className="instruction-table-empty">
                  該当する指導記録がありません
                </td>
              </tr>
            ) : (
              records.map((r, i) => (
                <tr key={r.id}>
                  <td>{i + 1}</td>
                  <td>{formatInstructionDate(r.date)}</td>
                  <td>
                    {r.employeeFamilyName} {r.employeeGivenName}
                  </td>
                  <td className="instruction-cell-pre">{r.instructionItems}</td>
                  <td className="instruction-cell-pre">{r.specialNotes}</td>
                  <td className="instruction-cell-pre">{r.remarks}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="instruction-print-sheet">
        <h1 className="instruction-print-title">指導記録簿</h1>
        <p className="instruction-print-meta">
          期間: {from} ～ {to}（東京） / 件数: {sortedForPrint.length}
        </p>
        <table className="instruction-table instruction-table--print">
          <thead>
            <tr>
              <th className="col-no">No</th>
              <th className="col-date">指導日時</th>
              <th className="col-name">氏名</th>
              <th className="col-body">指導事項</th>
              <th className="col-body">特記事項</th>
              <th className="col-body">備考</th>
            </tr>
          </thead>
          <tbody>
            {sortedForPrint.map((r, i) => (
              <tr key={`p-${r.id}`}>
                <td>{i + 1}</td>
                <td>{formatInstructionDate(r.date)}</td>
                <td>
                  {r.employeeFamilyName} {r.employeeGivenName}
                </td>
                <td className="instruction-cell-pre">{r.instructionItems}</td>
                <td className="instruction-cell-pre">{r.specialNotes}</td>
                <td className="instruction-cell-pre">{r.remarks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

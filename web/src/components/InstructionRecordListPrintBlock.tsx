import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import { Err } from "../ui";
import {
  type InstructionRow,
  firstDayOfMonth,
  formatInstructionDate,
  groupRecordsBySession,
  lastDayOfMonth,
} from "../lib/instruction-records-ui";

import "../instruction-records-print.css";

function dashIfEmpty(s: string): string {
  const t = s.trim();
  return t ? s : "—";
}

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

  const sortedRows = useMemo(() => [...records].sort((a, b) => a.date.localeCompare(b.date)), [records]);
  const printSheets = useMemo(() => groupRecordsBySession(sortedRows), [sortedRows]);

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
        登録はメニュー「指導」から行えます。ここでは期間を指定して一覧表示し、A4縦で印刷できます。
      </p>

      <div className="instruction-screen-table-wrap no-print">
        <table className="instruction-table instruction-table--screen">
          <thead>
            <tr>
              <th>No</th>
              <th>指導日時</th>
              <th>実施場所</th>
              <th>担当者</th>
              <th>氏名</th>
              <th>指導事項</th>
              <th>特記事項</th>
              <th>備考</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr>
                <td colSpan={8} className="instruction-table-empty">
                  該当する指導記録がありません
                </td>
              </tr>
            ) : (
              sortedRows.map((r, i) => (
                <tr key={r.id}>
                  <td>{i + 1}</td>
                  <td>{formatInstructionDate(r.date)}</td>
                  <td className="instruction-cell-pre">{dashIfEmpty(r.instructionVenue ?? "")}</td>
                  <td className="instruction-cell-pre">{dashIfEmpty(r.instructorNames ?? "")}</td>
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
        <p className="instruction-print-global-meta">
          出力期間: {from} ～ {to}（東京） / 指導実施 {printSheets.length} 件
        </p>
        {printSheets.map((g) => (
          <article key={g.key} className="instruction-doc-page">
            <header className="instruction-doc-banner">
              <h1 className="instruction-doc-heading">従事者に対する指導記録簿</h1>
            </header>

            <table className="instruction-doc-table">
              <tbody>
                <tr>
                  <th scope="row">指導実施日時</th>
                  <td>{formatInstructionDate(g.dateIso)}</td>
                </tr>
                <tr>
                  <th scope="row">指導実施場所</th>
                  <td className="instruction-doc-td-pre">{dashIfEmpty(g.instructionVenue)}</td>
                </tr>
                <tr>
                  <th scope="row">指導担当者名（複数）</th>
                  <td className="instruction-doc-td-pre">{dashIfEmpty(g.instructorNames)}</td>
                </tr>
                <tr>
                  <th scope="row">指導を受けた者</th>
                  <td className="instruction-doc-td-pre">{g.recipientNames.join("、")}</td>
                </tr>
                <tr className="instruction-doc-row-tall">
                  <th scope="row">指導項目</th>
                  <td className="instruction-doc-td-pre">{g.instructionItems.trim() ? g.instructionItems : "—"}</td>
                </tr>
                <tr className="instruction-doc-row-mid">
                  <th scope="row">特記事項</th>
                  <td className="instruction-doc-td-pre">{g.specialNotes.trim() ? g.specialNotes : "—"}</td>
                </tr>
                <tr className="instruction-doc-row-mid">
                  <th scope="row">備考</th>
                  <td className="instruction-doc-td-pre">{g.remarks.trim() ? g.remarks : "—"}</td>
                </tr>
              </tbody>
            </table>

            <footer className="instruction-doc-footer">
              <span>事業者名義にて保管してください</span>
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}

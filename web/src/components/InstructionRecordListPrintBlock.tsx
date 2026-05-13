import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, apiFetchBlob } from "../api";
import { Err } from "../ui";
import { InstructionRecordEditDialog } from "./InstructionRecordEditDialog";
import { type InstructionRow, firstDayOfMonth, formatInstructionDate, lastDayOfMonth } from "../lib/instruction-records-ui";
import { downloadBrowserBlob } from "../lib/download-blob";

import "../instruction-records-print.css";

function dashIfEmpty(s: string): string {
  const t = s.trim();
  return t ? s : "—";
}

type EmployeeOpt = { id: string; familyName: string; givenName: string; status: string };

/** 書類ページ「指導記録簿」タブ用：期間絞り込み・一覧・印刷（1件＝A4縦1枚）・編集・削除 */
export default function InstructionRecordListPrintBlock(): JSX.Element {
  const now = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(() => firstDayOfMonth(now));
  const [to, setTo] = useState(() => lastDayOfMonth(now));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [records, setRecords] = useState<InstructionRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeOpt[]>([]);
  const [editRecord, setEditRecord] = useState<InstructionRow | null>(null);

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
    void (async () => {
      const r = await apiFetch<{ employees: EmployeeOpt[] }>("/settings/employees");
      if (r.ok) setEmployees(r.data.employees);
    })();
  }, []);

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

  const savePdf = async () => {
    setErr(null);
    if (records.length === 0) {
      setErr("該当する指導記録がありません。期間を確認するか、先に絞り込みしてください。");
      return;
    }
    setPdfBusy(true);
    const r = await apiFetchBlob("/instruction-records/export-pdf", {
      method: "POST",
      json: { from, to },
    });
    setPdfBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    downloadBrowserBlob(r.blob, r.filename ?? "instruction-records.pdf");
  };

  const sortedRows = useMemo(() => [...records].sort((a, b) => a.date.localeCompare(b.date)), [records]);

  return (
    <div className="instruction-list">
      <Err msg={err} />
      <InstructionRecordEditDialog
        open={editRecord != null}
        record={editRecord}
        employees={employees}
        onClose={() => setEditRecord(null)}
        onSaved={() => void load()}
      />

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
          <button type="button" className="settings-primary" disabled={pdfBusy || records.length === 0} onClick={() => void savePdf()}>
            {pdfBusy ? "PDF生成中…" : "PDFで保存"}
          </button>
          <button type="button" className="settings-secondary" disabled={busy || records.length === 0} onClick={onPrint}>
            ブラウザで印刷
          </button>
        </div>
      </div>

      <p className="settings-hint no-print" style={{ marginTop: 0 }}>
        登録はメニュー「指導」から行えます。複数人をまとめて登録すると1件のデータになります。PDFはサーバーで生成します（Chromium
        未設定時はエラーになります）。ブラウザ印刷は1件につきA4縦1枚です。
      </p>

      <div className="instruction-screen-table-wrap no-print">
        <table className="instruction-table instruction-table--screen">
          <thead>
            <tr>
              <th>No</th>
              <th>指導日時</th>
              <th>実施場所</th>
              <th>担当者</th>
              <th>受講者</th>
              <th>指導事項</th>
              <th>特記事項</th>
              <th>備考</th>
              <th className="instruction-col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr>
                <td colSpan={9} className="instruction-table-empty">
                  該当する指導記録がありません
                </td>
              </tr>
            ) : (
              sortedRows.map((r, i) => (
                <tr key={r.id}>
                  <td>{i + 1}</td>
                  <td>{formatInstructionDate(r.date)}</td>
                  <td className="instruction-cell-pre">{dashIfEmpty(r.instructionVenue ?? "")}</td>
                  <td className="instruction-cell-pre">{dashIfEmpty(r.instructorLabel ?? "")}</td>
                  <td className="instruction-cell-pre">{dashIfEmpty(r.recipientLabel ?? "")}</td>
                  <td className="instruction-cell-pre">{r.instructionItems}</td>
                  <td className="instruction-cell-pre">{r.specialNotes}</td>
                  <td className="instruction-cell-pre">{r.remarks}</td>
                  <td className="instruction-col-actions">
                    <button type="button" className="settings-secondary instruction-row-btn" onClick={() => setEditRecord(r)}>
                      編集
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="instruction-print-sheet">
        {sortedRows.map((r) => (
          <article key={r.id} className="instruction-doc-page">
            <header className="instruction-doc-banner">
              <h1 className="instruction-doc-heading">従事者に対する指導記録簿</h1>
            </header>

            <div className="instruction-doc-table-wrap">
              <table className="instruction-doc-table">
                <tbody>
                  <tr>
                    <th scope="row">指導実施日時</th>
                    <td>{formatInstructionDate(r.date)}</td>
                  </tr>
                  <tr>
                    <th scope="row">指導実施場所</th>
                    <td className="instruction-doc-td-pre">{dashIfEmpty(r.instructionVenue)}</td>
                  </tr>
                  <tr>
                    <th scope="row">指導担当者名（複数）</th>
                    <td className="instruction-doc-td-pre">{dashIfEmpty(r.instructorLabel)}</td>
                  </tr>
                  <tr>
                    <th scope="row">指導を受けた者</th>
                    <td className="instruction-doc-td-pre">{dashIfEmpty(r.recipientLabel)}</td>
                  </tr>
                  <tr className="instruction-doc-row-tall">
                    <th scope="row">指導項目</th>
                    <td className="instruction-doc-td-pre">{r.instructionItems.trim() ? r.instructionItems : "—"}</td>
                  </tr>
                  <tr className="instruction-doc-row-mid">
                    <th scope="row">特記事項</th>
                    <td className="instruction-doc-td-pre">{r.specialNotes.trim() ? r.specialNotes : "—"}</td>
                  </tr>
                  <tr className="instruction-doc-row-mid">
                    <th scope="row">備考</th>
                    <td className="instruction-doc-td-pre">{r.remarks.trim() ? r.remarks : "—"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

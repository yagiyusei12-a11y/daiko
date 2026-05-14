import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, apiFetchBlob } from "../api";
import { downloadBrowserBlob } from "../lib/download-blob";
import { Err } from "../ui";

export type ComplaintRowLite = {
  id: string;
  receivedAt: string;
  driverName: string;
  complainantName: string;
  detail: string;
  completedOn: string | null;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatReceived(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatCompleted(ymd: string | null): string {
  if (!ymd) return "―";
  return ymd.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1/$2/$3");
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export default function ComplaintLedgerPrintBlock(): JSX.Element {
  const [rows, setRows] = useState<ComplaintRowLite[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [printErr, setPrintErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoadErr(null);
    const r = await apiFetch<{ complaints: ComplaintRowLite[] }>("/complaints");
    if (!r.ok) {
      setLoadErr(r.error);
      setRows([]);
      setSelected({});
      return;
    }
    const list = r.data.complaints ?? [];
    setRows(list);
    const next: Record<string, boolean> = {};
    for (const c of list) next[c.id] = false;
    setSelected(next);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const anySelected = useMemo(() => Object.values(selected).some(Boolean), [selected]);

  function toggle(id: string): void {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function setAll(on: boolean): void {
    setSelected((prev) => {
      const next = { ...prev };
      for (const c of rows) next[c.id] = on;
      return next;
    });
  }

  async function savePdf(): Promise<void> {
    setPrintErr(null);
    const complaintIds = rows.filter((c) => selected[c.id]).map((c) => c.id);
    if (complaintIds.length === 0) {
      setPrintErr("PDF に出力する苦情を 1 件以上選んでください");
      return;
    }
    setBusy(true);
    const r = await apiFetchBlob("/documents/complaint-ledger-print", {
      method: "POST",
      json: { complaintIds, outputFormat: "pdf" },
    });
    setBusy(false);
    if (!r.ok) {
      setPrintErr(r.error);
      return;
    }
    downloadBrowserBlob(r.blob, r.filename ?? "complaint-ledger.pdf");
  }

  return (
    <div className="settings-section-panel" style={{ marginTop: "0.75rem" }}>
      <p className="settings-hint" style={{ marginTop: 0 }}>
        登録済みの苦情を複数選び、A4 縦の「苦情処理簿」形式で PDF 保存できます。新規登録・編集は{" "}
        <Link to="/complaints">苦情</Link> メニューから行ってください。
      </p>
      <Err msg={loadErr} />
      <Err msg={printErr} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.75rem" }}>
        <button type="button" className="settings-secondary" disabled={busy} onClick={() => void reload()}>
          一覧を再読込
        </button>
        <button type="button" className="settings-secondary" disabled={busy || rows.length === 0} onClick={() => setAll(true)}>
          すべて選択
        </button>
        <button type="button" className="settings-secondary" disabled={busy || rows.length === 0} onClick={() => setAll(false)}>
          選択解除
        </button>
        <button type="button" className="settings-primary" disabled={busy || !anySelected} onClick={() => void savePdf()}>
          {busy ? "生成中…" : "PDFで保存（A4縦）"}
        </button>
      </div>
      <div style={{ marginTop: "0.75rem", overflowX: "auto" }}>
        <table
          style={{
            minWidth: "720px",
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.9rem",
          }}
        >
          <thead>
            <tr style={{ background: "var(--color-surface-alt, #f3f4f6)" }}>
              <th style={{ width: "2.5rem", border: "1px solid var(--color-border, #ddd)", padding: "0.4rem" }} />
              <th style={{ border: "1px solid var(--color-border, #ddd)", padding: "0.4rem", textAlign: "left" }}>苦情受付日時</th>
              <th style={{ border: "1px solid var(--color-border, #ddd)", padding: "0.4rem", textAlign: "left" }}>運転者氏名</th>
              <th style={{ border: "1px solid var(--color-border, #ddd)", padding: "0.4rem", textAlign: "left" }}>苦情申出者（氏名）</th>
              <th style={{ border: "1px solid var(--color-border, #ddd)", padding: "0.4rem", textAlign: "left" }}>苦情の内容</th>
              <th style={{ border: "1px solid var(--color-border, #ddd)", padding: "0.4rem", textAlign: "left" }}>苦情処理完了年月日</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loadErr ? (
              <tr>
                <td colSpan={6} className="settings-hint" style={{ border: "1px solid var(--color-border, #ddd)", padding: "0.75rem" }}>
                  苦情の登録がありません。
                </td>
              </tr>
            ) : (
              rows.map((c) => (
                <tr key={c.id}>
                  <td style={{ border: "1px solid var(--color-border, #ddd)", padding: "0.35rem", textAlign: "center" }}>
                    <input type="checkbox" checked={Boolean(selected[c.id])} onChange={() => toggle(c.id)} disabled={busy} />
                  </td>
                  <td style={{ border: "1px solid var(--color-border, #ddd)", padding: "0.35rem" }}>{formatReceived(c.receivedAt)}</td>
                  <td style={{ border: "1px solid var(--color-border, #ddd)", padding: "0.35rem" }}>{c.driverName || "―"}</td>
                  <td style={{ border: "1px solid var(--color-border, #ddd)", padding: "0.35rem" }}>{c.complainantName || "―"}</td>
                  <td style={{ border: "1px solid var(--color-border, #ddd)", padding: "0.35rem", maxWidth: "280px" }} title={c.detail}>
                    {clip(c.detail, 80) || "―"}
                  </td>
                  <td style={{ border: "1px solid var(--color-border, #ddd)", padding: "0.35rem" }}>{formatCompleted(c.completedOn)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

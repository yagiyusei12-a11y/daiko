import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api";
import { Card, Err } from "../ui";
import "../instruction-records-print.css";

type EmployeeOpt = { id: string; familyName: string; givenName: string; status: string };

export type ComplaintApi = {
  id: string;
  receivedAt: string;
  receivedByEmployeeId: string | null;
  receivedByName: string;
  driverEmployeeId: string | null;
  driverName: string;
  placeOrSection: string;
  complainantName: string;
  complainantAddress: string;
  complainantContact: string;
  detail: string;
  causeAnalysis: string;
  rebuttal: string;
  correctiveAction: string;
  handlerEmployeeId: string | null;
  handlerName: string;
  completedOn: string | null;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toDatetimeLocalValue(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return toDatetimeLocalValue(new Date());
  return toDatetimeLocalValue(d);
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

function empLabel(e: EmployeeOpt): string {
  return `${e.familyName}　${e.givenName}`;
}

export default function ComplaintsPage(): JSX.Element {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<ComplaintApi[]>([]);
  const [employees, setEmployees] = useState<EmployeeOpt[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [receivedAtLocal, setReceivedAtLocal] = useState(() => toDatetimeLocalValue(new Date()));
  const [receivedByEmployeeId, setReceivedByEmployeeId] = useState("");
  const [driverEmployeeId, setDriverEmployeeId] = useState("");
  const [placeOrSection, setPlaceOrSection] = useState("");
  const [complainantName, setComplainantName] = useState("");
  const [complainantAddress, setComplainantAddress] = useState("");
  const [complainantContact, setComplainantContact] = useState("");
  const [detail, setDetail] = useState("");
  const [causeAnalysis, setCauseAnalysis] = useState("");
  const [rebuttal, setRebuttal] = useState("");
  const [correctiveAction, setCorrectiveAction] = useState("");
  const [handlerEmployeeId, setHandlerEmployeeId] = useState("");
  const [completedOn, setCompletedOn] = useState("");

  const activeEmployees = useMemo(() => employees.filter((e) => e.status === "ACTIVE"), [employees]);

  const loadRows = useCallback(async () => {
    setErr(null);
    const r = await apiFetch<{ complaints: ComplaintApi[] }>("/complaints");
    if (!r.ok) {
      setErr(r.error);
      setRows([]);
      return;
    }
    setRows(r.data.complaints ?? []);
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    void (async () => {
      const r = await apiFetch<{ employees: EmployeeOpt[] }>("/settings/employees");
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setEmployees(r.data.employees ?? []);
    })();
  }, []);

  function openCreate(): void {
    setEditingId(null);
    setReceivedAtLocal(toDatetimeLocalValue(new Date()));
    setReceivedByEmployeeId("");
    setDriverEmployeeId("");
    setPlaceOrSection("");
    setComplainantName("");
    setComplainantAddress("");
    setComplainantContact("");
    setDetail("");
    setCauseAnalysis("");
    setRebuttal("");
    setCorrectiveAction("");
    setHandlerEmployeeId("");
    setCompletedOn("");
    setModalOpen(true);
  }

  function openEdit(c: ComplaintApi): void {
    setEditingId(c.id);
    setReceivedAtLocal(isoToDatetimeLocal(c.receivedAt));
    setReceivedByEmployeeId(c.receivedByEmployeeId ?? "");
    setDriverEmployeeId(c.driverEmployeeId ?? "");
    setPlaceOrSection(c.placeOrSection);
    setComplainantName(c.complainantName);
    setComplainantAddress(c.complainantAddress);
    setComplainantContact(c.complainantContact);
    setDetail(c.detail);
    setCauseAnalysis(c.causeAnalysis);
    setRebuttal(c.rebuttal);
    setCorrectiveAction(c.correctiveAction);
    setHandlerEmployeeId(c.handlerEmployeeId ?? "");
    setCompletedOn(c.completedOn ?? "");
    setModalOpen(true);
  }

  async function saveModal(): Promise<void> {
    setErr(null);
    const parsed = new Date(receivedAtLocal);
    if (Number.isNaN(parsed.getTime())) {
      setErr("苦情受付日時が不正です");
      return;
    }
    const body = {
      receivedAt: parsed.toISOString(),
      receivedByEmployeeId: receivedByEmployeeId || null,
      driverEmployeeId: driverEmployeeId || null,
      placeOrSection,
      complainantName,
      complainantAddress,
      complainantContact,
      detail,
      causeAnalysis,
      rebuttal,
      correctiveAction,
      handlerEmployeeId: handlerEmployeeId || null,
      completedOn: completedOn.trim() || null,
    };
    setBusy(true);
    const r =
      editingId == null
        ? await apiFetch<{ id: string }>("/complaints", { method: "POST", json: body })
        : await apiFetch<{ ok: true }>(`/complaints/${editingId}`, { method: "PATCH", json: body });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setModalOpen(false);
    await loadRows();
  }

  async function removeRow(id: string): Promise<void> {
    if (!window.confirm("この苦情記録を削除しますか？")) return;
    setErr(null);
    setBusy(true);
    const r = await apiFetch<{ ok: true }>(`/complaints/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    await loadRows();
  }

  return (
    <Card title="苦情">
      <p className="settings-hint" style={{ marginTop: 0 }}>
        苦情の受付・処理内容を登録します。PDF 出力は「書類」→「苦情処理簿」タブから複数件を選んで保存できます。
      </p>
      <Err msg={err} />
      <p style={{ marginTop: "0.75rem", display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
        <button type="button" className="settings-primary" disabled={busy} onClick={openCreate}>
          新規作成
        </button>
        <button type="button" className="settings-secondary" disabled={busy} onClick={() => void loadRows()}>
          一覧を再読込
        </button>
        <Link to="/documents">書類（苦情処理簿 PDF）へ</Link>
      </p>

      <div style={{ marginTop: "1rem", overflowX: "auto" }}>
        <table
          style={{
            minWidth: "900px",
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.9rem",
          }}
        >
          <thead>
            <tr style={{ background: "var(--color-surface-alt, #f3f4f6)" }}>
              <th style={{ border: "1px solid var(--color-border, #ddd)", padding: "0.4rem", textAlign: "left" }}>
                苦情受付日時
              </th>
              <th style={{ border: "1px solid var(--color-border, #ddd)", padding: "0.4rem", textAlign: "left" }}>運転者氏名</th>
              <th style={{ border: "1px solid var(--color-border, #ddd)", padding: "0.4rem", textAlign: "left" }}>
                苦情申出者（氏名）
              </th>
              <th style={{ border: "1px solid var(--color-border, #ddd)", padding: "0.4rem", textAlign: "left" }}>苦情の内容</th>
              <th style={{ border: "1px solid var(--color-border, #ddd)", padding: "0.4rem", textAlign: "left" }}>
                苦情処理完了年月日
              </th>
              <th style={{ border: "1px solid var(--color-border, #ddd)", padding: "0.4rem", textAlign: "center", width: "9rem" }}>
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="settings-hint" style={{ border: "1px solid var(--color-border, #ddd)", padding: "0.75rem" }}>
                  登録された苦情はありません。「新規作成」から追加してください。
                </td>
              </tr>
            ) : (
              rows.map((c) => (
                <tr key={c.id}>
                  <td style={{ border: "1px solid var(--color-border, #ddd)", padding: "0.35rem" }}>{formatReceived(c.receivedAt)}</td>
                  <td style={{ border: "1px solid var(--color-border, #ddd)", padding: "0.35rem" }}>{c.driverName || "―"}</td>
                  <td style={{ border: "1px solid var(--color-border, #ddd)", padding: "0.35rem" }}>{c.complainantName || "―"}</td>
                  <td style={{ border: "1px solid var(--color-border, #ddd)", padding: "0.35rem", maxWidth: "320px" }} title={c.detail}>
                    {clip(c.detail, 100) || "―"}
                  </td>
                  <td style={{ border: "1px solid var(--color-border, #ddd)", padding: "0.35rem" }}>{formatCompleted(c.completedOn)}</td>
                  <td
                    style={{
                      border: "1px solid var(--color-border, #ddd)",
                      padding: "0.35rem",
                      textAlign: "center",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <button type="button" className="settings-secondary" disabled={busy} onClick={() => openEdit(c)}>
                      編集
                    </button>{" "}
                    <button type="button" className="settings-danger" disabled={busy} onClick={() => void removeRow(c.id)}>
                      削除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modalOpen ? (
        <div
          className="pricing-modal-backdrop"
          role="presentation"
          onMouseDown={() => !busy && setModalOpen(false)}
        >
          <div
            className="pricing-modal attend-shift-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="complaint-modal-title"
            onMouseDown={(e) => e.stopPropagation()}
            style={{ maxWidth: "36rem", width: "min(96vw, 36rem)", maxHeight: "90vh", overflowY: "auto" }}
          >
            <h2 id="complaint-modal-title" className="pricing-modal-title">
              {editingId == null ? "苦情の新規登録" : "苦情の編集"}
            </h2>
            <div className="settings-form instruction-form" style={{ marginTop: "0.5rem" }}>
              <label className="field field--block">
                <span className="field-label">苦情受付日時</span>
                <input
                  className="field-control"
                  type="datetime-local"
                  value={receivedAtLocal}
                  onChange={(e) => setReceivedAtLocal(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label className="field field--block">
                <span className="field-label">受付者（従業員）</span>
                <select
                  className="field-control"
                  value={receivedByEmployeeId}
                  onChange={(e) => setReceivedByEmployeeId(e.target.value)}
                  disabled={busy}
                >
                  <option value="">（未選択）</option>
                  {activeEmployees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {empLabel(e)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field field--block">
                <span className="field-label">運転者氏名（従業員）</span>
                <select
                  className="field-control"
                  value={driverEmployeeId}
                  onChange={(e) => setDriverEmployeeId(e.target.value)}
                  disabled={busy}
                >
                  <option value="">（未選択）</option>
                  {activeEmployees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {empLabel(e)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field field--block">
                <span className="field-label">苦情発生場所または区間</span>
                <input
                  className="field-control"
                  value={placeOrSection}
                  onChange={(e) => setPlaceOrSection(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label className="field field--block">
                <span className="field-label">苦情申出者（氏名）</span>
                <input
                  className="field-control"
                  value={complainantName}
                  onChange={(e) => setComplainantName(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label className="field field--block">
                <span className="field-label">苦情申出者（住所）</span>
                <input
                  className="field-control"
                  value={complainantAddress}
                  onChange={(e) => setComplainantAddress(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label className="field field--block">
                <span className="field-label">苦情申出者（連絡先）</span>
                <input
                  className="field-control"
                  value={complainantContact}
                  onChange={(e) => setComplainantContact(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label className="field field--block">
                <span className="field-label">苦情の内容</span>
                <textarea className="field-control instruction-textarea" rows={4} value={detail} onChange={(e) => setDetail(e.target.value)} disabled={busy} />
              </label>
              <label className="field field--block">
                <span className="field-label">原因究明の結果</span>
                <textarea
                  className="field-control instruction-textarea instruction-textarea--short"
                  rows={3}
                  value={causeAnalysis}
                  onChange={(e) => setCauseAnalysis(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label className="field field--block">
                <span className="field-label">苦情に対する弁明内容</span>
                <textarea className="field-control instruction-textarea instruction-textarea--short" rows={3} value={rebuttal} onChange={(e) => setRebuttal(e.target.value)} disabled={busy} />
              </label>
              <label className="field field--block">
                <span className="field-label">改善措置</span>
                <textarea
                  className="field-control instruction-textarea instruction-textarea--short"
                  rows={3}
                  value={correctiveAction}
                  onChange={(e) => setCorrectiveAction(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label className="field field--block">
                <span className="field-label">苦情処理担当者（従業員）</span>
                <select
                  className="field-control"
                  value={handlerEmployeeId}
                  onChange={(e) => setHandlerEmployeeId(e.target.value)}
                  disabled={busy}
                >
                  <option value="">（未選択）</option>
                  {activeEmployees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {empLabel(e)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field field--block">
                <span className="field-label">苦情処理完了年月日</span>
                <input className="field-control" type="date" value={completedOn} onChange={(e) => setCompletedOn(e.target.value)} disabled={busy} />
              </label>
            </div>
            <div className="pricing-modal-actions">
              <button type="button" className="settings-secondary" disabled={busy} onClick={() => setModalOpen(false)}>
                キャンセル
              </button>
              <button type="button" className="settings-primary" disabled={busy} onClick={() => void saveModal()}>
                {busy ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

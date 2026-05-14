import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";
import { Err } from "../ui";
import { useSavedToast } from "../saved-toast";
import type { InstructionRow } from "../lib/instruction-records-ui";

type EmployeeOpt = { id: string; familyName: string; givenName: string; status: string };

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

type Props = {
  open: boolean;
  record: InstructionRow | null;
  employees: EmployeeOpt[];
  onClose: () => void;
  onSaved: () => void;
};

export function InstructionRecordEditDialog({ open, record, employees, onClose, onSaved }: Props): JSX.Element | null {
  const { flashSaved } = useSavedToast();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recipientIds, setRecipientIds] = useState<Set<string>>(new Set());
  const [instructorIds, setInstructorIds] = useState<Set<string>>(new Set());
  const [dateLocal, setDateLocal] = useState("");
  const [instructionVenue, setInstructionVenue] = useState("");
  const [instructionItems, setInstructionItems] = useState("");
  const [specialNotes, setSpecialNotes] = useState("");
  const [remarks, setRemarks] = useState("");

  useEffect(() => {
    if (!open || !record) return;
    setErr(null);
    setRecipientIds(new Set(record.recipientEmployeeIds));
    setInstructorIds(new Set(record.instructorEmployeeIds));
    setDateLocal(isoToDatetimeLocal(record.date));
    setInstructionVenue(record.instructionVenue);
    setInstructionItems(record.instructionItems);
    setSpecialNotes(record.specialNotes);
    setRemarks(record.remarks);
  }, [open, record]);

  const toggleRec = useCallback((id: string) => {
    setRecipientIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const toggleIns = useCallback((id: string) => {
    setInstructorIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const selectAllRec = useCallback(() => {
    setRecipientIds(new Set(employees.filter((e) => e.status === "ACTIVE").map((e) => e.id)));
  }, [employees]);

  const clearRec = useCallback(() => setRecipientIds(new Set()), []);
  const selectAllIns = useCallback(() => {
    setInstructorIds(new Set(employees.filter((e) => e.status === "ACTIVE").map((e) => e.id)));
  }, [employees]);
  const clearIns = useCallback(() => setInstructorIds(new Set()), []);

  const save = useCallback(async () => {
    if (!record) return;
    setErr(null);
    const recipientEmployeeIds = [...recipientIds];
    if (recipientEmployeeIds.length === 0) {
      setErr("指導を受ける者を1名以上選択してください");
      return;
    }
    const parsed = new Date(dateLocal);
    if (Number.isNaN(parsed.getTime())) {
      setErr("指導日時が不正です");
      return;
    }
    setBusy(true);
    const r = await apiFetch<{ ok: boolean }>(`/instruction-records/${record.id}`, {
      method: "PATCH",
      json: {
        recipientEmployeeIds,
        instructorEmployeeIds: [...instructorIds],
        date: parsed.toISOString(),
        instructionVenue,
        instructionItems,
        specialNotes,
        remarks,
      },
    });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    flashSaved();
    onSaved();
    onClose();
  }, [
    record,
    flashSaved,
    recipientIds,
    instructorIds,
    dateLocal,
    instructionVenue,
    instructionItems,
    specialNotes,
    remarks,
    onSaved,
    onClose,
  ]);

  const del = useCallback(async () => {
    if (!record) return;
    if (!window.confirm("この指導記録を削除します。よろしいですか？")) return;
    setErr(null);
    setBusy(true);
    const r = await apiFetch<{ ok: boolean }>(`/instruction-records/${record.id}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    onSaved();
    onClose();
  }, [record, onSaved, onClose]);

  if (!open || !record) return null;

  const activeEmps = employees.filter((e) => e.status === "ACTIVE");

  return (
    <div
      className="instruction-modal-backdrop no-print"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="instruction-modal" role="dialog" aria-modal="true" aria-labelledby="instruction-edit-title">
        <h2 id="instruction-edit-title" className="instruction-modal-title">
          指導記録の編集
        </h2>
        <Err msg={err} />
        <div className="instruction-modal-body">
          <div className="field field--block">
            <span className="field-label">指導を受ける者（複数可）</span>
            <div className="instruction-target-actions">
              <button type="button" className="settings-secondary" disabled={busy} onClick={selectAllRec}>
                すべて選択
              </button>
              <button type="button" className="settings-secondary" disabled={busy} onClick={clearRec}>
                選択解除
              </button>
            </div>
            <div className="instruction-employee-checks" role="group" aria-label="受講者">
              {activeEmps.map((e) => (
                <label key={`ed-rec-${e.id}`} className="settings-check instruction-employee-check">
                  <input type="checkbox" checked={recipientIds.has(e.id)} onChange={() => toggleRec(e.id)} disabled={busy} />
                  <span>
                    {e.familyName} {e.givenName}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="field field--block">
            <span className="field-label">指導担当（複数可）</span>
            <div className="instruction-target-actions">
              <button type="button" className="settings-secondary" disabled={busy} onClick={selectAllIns}>
                すべて選択
              </button>
              <button type="button" className="settings-secondary" disabled={busy} onClick={clearIns}>
                選択解除
              </button>
            </div>
            <div className="instruction-employee-checks" role="group" aria-label="担当">
              {activeEmps.map((e) => (
                <label key={`ed-ins-${e.id}`} className="settings-check instruction-employee-check">
                  <input type="checkbox" checked={instructorIds.has(e.id)} onChange={() => toggleIns(e.id)} disabled={busy} />
                  <span>
                    {e.familyName} {e.givenName}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <label className="field field--block">
            <span className="field-label">指導日時</span>
            <input
              className="field-control"
              type="datetime-local"
              value={dateLocal}
              onChange={(e) => setDateLocal(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="field field--block">
            <span className="field-label">指導実施場所</span>
            <input
              className="field-control"
              type="text"
              value={instructionVenue}
              onChange={(e) => setInstructionVenue(e.target.value)}
              disabled={busy}
              maxLength={500}
            />
          </label>
          <label className="field field--block">
            <span className="field-label">指導事項</span>
            <textarea
              className="field-control instruction-textarea"
              rows={10}
              value={instructionItems}
              onChange={(e) => setInstructionItems(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="field field--block">
            <span className="field-label">特記事項</span>
            <textarea
              className="field-control instruction-textarea"
              rows={3}
              value={specialNotes}
              onChange={(e) => setSpecialNotes(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="field field--block">
            <span className="field-label">備考</span>
            <textarea
              className="field-control instruction-textarea"
              rows={3}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              disabled={busy}
            />
          </label>
        </div>
        <div className="instruction-modal-actions">
          <button type="button" className="settings-secondary" disabled={busy} onClick={onClose}>
            キャンセル
          </button>
          <button type="button" className="settings-danger" disabled={busy} onClick={() => void del()}>
            削除
          </button>
          <button type="button" className="settings-primary" disabled={busy} onClick={() => void save()}>
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

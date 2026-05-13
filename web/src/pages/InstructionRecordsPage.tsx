import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";
import { Card, Err } from "../ui";
import {
  DEFAULT_INSTRUCTION_ITEMS,
  DEFAULT_REMARKS,
  DEFAULT_SPECIAL_NOTES,
} from "../instruction-record-defaults";

type EmployeeOpt = { id: string; familyName: string; givenName: string; status: string };

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toDatetimeLocalValue(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export default function InstructionRecordsPage(): JSX.Element {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [employees, setEmployees] = useState<EmployeeOpt[]>([]);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<Set<string>>(new Set());
  const [selectedInstructorIds, setSelectedInstructorIds] = useState<Set<string>>(new Set());
  const [dateLocal, setDateLocal] = useState(() => toDatetimeLocalValue(new Date()));
  const [instructionVenue, setInstructionVenue] = useState("");
  const [instructionItems, setInstructionItems] = useState(DEFAULT_INSTRUCTION_ITEMS);
  const [specialNotes, setSpecialNotes] = useState(DEFAULT_SPECIAL_NOTES);
  const [remarks, setRemarks] = useState(DEFAULT_REMARKS);

  useEffect(() => {
    void (async () => {
      const r = await apiFetch<{ employees: EmployeeOpt[] }>("/settings/employees");
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      const active = r.data.employees.filter((e) => e.status === "ACTIVE");
      setEmployees(active);
    })();
  }, []);

  const toggleRecipient = useCallback((id: string) => {
    setSelectedRecipientIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllRecipients = useCallback(() => {
    setSelectedRecipientIds(new Set(employees.map((e) => e.id)));
  }, [employees]);

  const clearRecipients = useCallback(() => {
    setSelectedRecipientIds(new Set());
  }, []);

  const toggleInstructor = useCallback((id: string) => {
    setSelectedInstructorIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllInstructors = useCallback(() => {
    setSelectedInstructorIds(new Set(employees.map((e) => e.id)));
  }, [employees]);

  const clearInstructors = useCallback(() => {
    setSelectedInstructorIds(new Set());
  }, []);

  const save = useCallback(async () => {
    setErr(null);
    const employeeIds = [...selectedRecipientIds];
    if (employeeIds.length === 0) {
      setErr("指導を受ける対象者を1名以上選択してください");
      return;
    }
    const parsed = new Date(dateLocal);
    if (Number.isNaN(parsed.getTime())) {
      setErr("指導日時が不正です");
      return;
    }
    const instructorEmployeeIds = [...selectedInstructorIds];
    setBusy(true);
    const r = await apiFetch<{ id: string }>("/instruction-records", {
      method: "POST",
      json: {
        recipientEmployeeIds: employeeIds,
        instructorEmployeeIds,
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
    setDateLocal(toDatetimeLocalValue(new Date()));
    setInstructionVenue("");
    setInstructionItems(DEFAULT_INSTRUCTION_ITEMS);
    setSpecialNotes(DEFAULT_SPECIAL_NOTES);
    setRemarks(DEFAULT_REMARKS);
    setSelectedRecipientIds(new Set());
    setSelectedInstructorIds(new Set());
  }, [
    selectedRecipientIds,
    selectedInstructorIds,
    dateLocal,
    instructionVenue,
    instructionItems,
    specialNotes,
    remarks,
  ]);

  return (
    <Card title="指導記録簿">
      <p className="settings-hint">
        従業員への指導内容を登録します。指導を受ける者を複数選ぶと、1件の記録として保存されます。一覧・編集・削除・印刷（1件A4縦1枚）は「書類」メニューの「指導記録簿」タブから行えます。
      </p>
      <div className="instruction-form">
        <Err msg={err} />
        <div className="field-grid instruction-target-grid">
          <div className="field field--block instruction-target-field">
            <span className="field-label">指導を受ける者（複数可）</span>
            <div className="instruction-target-actions no-print">
              <button type="button" className="settings-secondary" disabled={busy} onClick={selectAllRecipients}>
                すべて選択
              </button>
              <button type="button" className="settings-secondary" disabled={busy} onClick={clearRecipients}>
                選択解除
              </button>
            </div>
            <div className="instruction-employee-checks" role="group" aria-label="指導を受ける者">
              {employees.length === 0 ? (
                <p className="settings-hint">在籍の従業員がいません。</p>
              ) : (
                employees.map((e) => (
                  <label key={`rec-${e.id}`} className="settings-check instruction-employee-check">
                    <input
                      type="checkbox"
                      checked={selectedRecipientIds.has(e.id)}
                      onChange={() => toggleRecipient(e.id)}
                      disabled={busy}
                    />
                    <span>
                      {e.familyName} {e.givenName}
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
          <div className="field field--block instruction-target-field">
            <span className="field-label">指導担当（従業員マスタ・複数可）</span>
            <div className="instruction-target-actions no-print">
              <button type="button" className="settings-secondary" disabled={busy} onClick={selectAllInstructors}>
                すべて選択
              </button>
              <button type="button" className="settings-secondary" disabled={busy} onClick={clearInstructors}>
                選択解除
              </button>
            </div>
            <div className="instruction-employee-checks" role="group" aria-label="指導担当">
              {employees.length === 0 ? (
                <p className="settings-hint">在籍の従業員がいません。</p>
              ) : (
                employees.map((e) => (
                  <label key={`ins-${e.id}`} className="settings-check instruction-employee-check">
                    <input
                      type="checkbox"
                      checked={selectedInstructorIds.has(e.id)}
                      onChange={() => toggleInstructor(e.id)}
                      disabled={busy}
                    />
                    <span>
                      {e.familyName} {e.givenName}
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
          <label className="field">
            <span className="field-label">指導日時</span>
            <input
              className="field-control"
              type="datetime-local"
              value={dateLocal}
              onChange={(e) => setDateLocal(e.target.value)}
              disabled={busy}
            />
          </label>
        </div>
        <label className="field field--block">
          <span className="field-label">指導実施場所</span>
          <input
            className="field-control"
            type="text"
            value={instructionVenue}
            onChange={(e) => setInstructionVenue(e.target.value)}
            disabled={busy}
            placeholder="例：本社会議室、車庫前"
            maxLength={500}
            autoComplete="off"
          />
        </label>
        <label className="field field--block">
          <span className="field-label">指導事項</span>
          <textarea
            className="field-control instruction-textarea"
            rows={14}
            value={instructionItems}
            onChange={(e) => setInstructionItems(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="field field--block">
          <span className="field-label">特記事項</span>
          <textarea
            className="field-control instruction-textarea"
            rows={4}
            value={specialNotes}
            onChange={(e) => setSpecialNotes(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="field field--block">
          <span className="field-label">備考</span>
          <textarea
            className="field-control instruction-textarea"
            rows={4}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            disabled={busy}
          />
        </label>
        <div className="instruction-actions no-print">
          <button type="button" className="settings-primary" disabled={busy} onClick={() => void save()}>
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </Card>
  );
}

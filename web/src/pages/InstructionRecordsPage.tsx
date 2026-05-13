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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dateLocal, setDateLocal] = useState(() => toDatetimeLocalValue(new Date()));
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

  const toggleId = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(employees.map((e) => e.id)));
  }, [employees]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const save = useCallback(async () => {
    setErr(null);
    const employeeIds = [...selectedIds];
    if (employeeIds.length === 0) {
      setErr("対象者を1名以上選択してください");
      return;
    }
    const parsed = new Date(dateLocal);
    if (Number.isNaN(parsed.getTime())) {
      setErr("指導日時が不正です");
      return;
    }
    setBusy(true);
    const r = await apiFetch<{ ids: string[]; count: number }>("/instruction-records", {
      method: "POST",
      json: {
        employeeIds,
        date: parsed.toISOString(),
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
    setInstructionItems(DEFAULT_INSTRUCTION_ITEMS);
    setSpecialNotes(DEFAULT_SPECIAL_NOTES);
    setRemarks(DEFAULT_REMARKS);
    setSelectedIds(new Set());
  }, [selectedIds, dateLocal, instructionItems, specialNotes, remarks]);

  return (
    <Card title="指導記録簿">
      <p className="settings-hint">
        従業員への指導内容を登録します。一覧・印刷（A4横）は「書類」メニューの「指導記録簿」タブから行えます。
      </p>
      <div className="instruction-form">
        <Err msg={err} />
        <div className="field-grid instruction-target-grid">
          <div className="field field--block instruction-target-field">
            <span className="field-label">対象者（複数可）</span>
            <div className="instruction-target-actions no-print">
              <button type="button" className="settings-secondary" disabled={busy} onClick={selectAll}>
                すべて選択
              </button>
              <button type="button" className="settings-secondary" disabled={busy} onClick={clearSelection}>
                選択解除
              </button>
            </div>
            <div className="instruction-employee-checks" role="group" aria-label="対象者">
              {employees.length === 0 ? (
                <p className="settings-hint">在籍の従業員がいません。</p>
              ) : (
                employees.map((e) => (
                  <label key={e.id} className="settings-check instruction-employee-check">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(e.id)}
                      onChange={() => toggleId(e.id)}
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

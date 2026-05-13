import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import { Card, Err, Tabs, type TabDef } from "../ui";
import {
  DEFAULT_INSTRUCTION_ITEMS,
  DEFAULT_REMARKS,
  DEFAULT_SPECIAL_NOTES,
} from "../instruction-record-defaults";

import "../instruction-records-print.css";

type EmployeeOpt = { id: string; familyName: string; givenName: string; status: string };

type InstructionRow = {
  id: string;
  employeeId: string;
  employeeFamilyName: string;
  employeeGivenName: string;
  date: string;
  instructionItems: string;
  specialNotes: string;
  remarks: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toDatetimeLocalValue(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function firstDayOfMonth(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
}

function lastDayOfMonth(d: Date): string {
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${pad2(last.getMonth() + 1)}-${pad2(last.getDate())}`;
}

function formatInstructionDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

function InstructionRegisterPanel({
  onSaved,
}: {
  onSaved: () => void;
}): JSX.Element {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [employees, setEmployees] = useState<EmployeeOpt[]>([]);
  const [employeeId, setEmployeeId] = useState("");
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
      setEmployeeId((prev) => prev || active[0]?.id || "");
    })();
  }, []);

  const save = useCallback(async () => {
    setErr(null);
    if (!employeeId) {
      setErr("従業員を選択してください");
      return;
    }
    const parsed = new Date(dateLocal);
    if (Number.isNaN(parsed.getTime())) {
      setErr("指導日時が不正です");
      return;
    }
    setBusy(true);
    const r = await apiFetch<{ id: string }>("/instruction-records", {
      method: "POST",
      json: {
        employeeId,
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
    onSaved();
  }, [employeeId, dateLocal, instructionItems, specialNotes, remarks, onSaved]);

  return (
    <div className="instruction-form">
      <Err msg={err} />
      <div className="field-grid">
        <label className="field">
          <span className="field-label">対象者</span>
          <select
            className="field-control"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            disabled={busy}
          >
            <option value="">選択してください</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.familyName} {e.givenName}
              </option>
            ))}
          </select>
        </label>
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
  );
}

function InstructionListPanel({ refreshKey }: { refreshKey: number }): JSX.Element {
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
  }, [load, refreshKey]);

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

export default function InstructionRecordsPage(): JSX.Element {
  const [tab, setTab] = useState("register");
  const [listTick, setListTick] = useState(0);

  const tabItems: TabDef[] = useMemo(
    () => [
      {
        id: "register",
        label: "入力・登録",
        children: <InstructionRegisterPanel onSaved={() => setListTick((t) => t + 1)} />,
      },
      {
        id: "list",
        label: "一覧・印刷",
        children: <InstructionListPanel refreshKey={listTick} />,
      },
    ],
    [listTick],
  );

  return (
    <Card title="指導記録簿">
      <p className="settings-hint no-print">従業員への指導内容を登録し、期間を指定して一覧・印刷（A4横）ができます。</p>
      <Tabs items={tabItems} activeId={tab} onActiveChange={setTab} aria-label="指導記録簿" />
    </Card>
  );
}

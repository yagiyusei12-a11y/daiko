import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import { useAuth, isStaffShiftOnlyMe } from "../auth";
import { useSavedToast } from "../saved-toast";
import { Card, Err, Tabs, type TabDef } from "../ui";

type EmployeeRow = {
  id: string;
  familyName: string;
  givenName: string;
  status: string;
  retiredAt: string | null;
};

type ShiftDaySlot = { start: string; end: string };

/** 0:00〜48:59（例: 翌4時 = 28:00） */
const FLEX_HM = /^(\d{1,2}):(\d{2})$/;

function isValidFlexHm(s: string): boolean {
  const m = FLEX_HM.exec(s.trim());
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h >= 0 && h <= 48 && min >= 0 && min <= 59;
}

function validateDaysForSave(days: Record<string, ShiftDaySlot>): string | null {
  for (const [date, slot] of Object.entries(days)) {
    const st = slot.start.trim();
    const en = slot.end.trim();
    if (!st && !en) continue;
    if (!st || !en) return `${date}: 開始・終了の両方を入力してください。`;
    if (!isValidFlexHm(st) || !isValidFlexHm(en)) {
      return `${date}: 時刻は 0:00〜48:59 の「時:分」で入力してください（例 9:00、28:00）。`;
    }
  }
  return null;
}

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function parseYm(ym: string): { y: number; m: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return { y, m: mo };
}

function shiftYearMonth(ym: string, delta: number): string {
  const p = parseYm(ym);
  if (!p) return ym;
  const d = new Date(p.y, p.m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** カレンダー用セル（null は空マス） */
function monthCalendarCells(ym: string): { key: string; date: string | null; dayNum: number | null }[] {
  const p = parseYm(ym);
  if (!p) return [];
  const { y, m } = p;
  const first = new Date(y, m - 1, 1);
  const pad = first.getDay();
  const dim = new Date(y, m, 0).getDate();
  const cells: { key: string; date: string | null; dayNum: number | null }[] = [];
  for (let i = 0; i < pad; i++) {
    cells.push({ key: `p-${i}`, date: null, dayNum: null });
  }
  const mm = String(m).padStart(2, "0");
  for (let d = 1; d <= dim; d++) {
    const dd = String(d).padStart(2, "0");
    cells.push({ key: `${y}-${mm}-${dd}`, date: `${y}-${mm}-${dd}`, dayNum: d });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ key: `t-${cells.length}`, date: null, dayNum: null });
  }
  return cells;
}

const WEEK_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function ShiftApplyDialog({
  open,
  employeeId,
  employeeLabel,
  onClose,
  onSaved,
}: {
  open: boolean;
  employeeId: string;
  employeeLabel: string;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element | null {
  const { flashSaved } = useSavedToast();
  const [err, setErr] = useState<string | null>(null);
  const [ym, setYm] = useState(currentYearMonth);
  const [days, setDays] = useState<Record<string, ShiftDaySlot>>({});
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const [copyMode, setCopyMode] = useState(false);
  const [copyTemplate, setCopyTemplate] = useState<ShiftDaySlot | null>(null);
  const [copyTargets, setCopyTargets] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);

  const loadMonth = useCallback(async () => {
    if (!employeeId) return;
    setErr(null);
    const r = await apiFetch<{ days: Record<string, ShiftDaySlot> }>(
      `/attendance/shift-applications?employeeId=${encodeURIComponent(employeeId)}&yearMonth=${encodeURIComponent(ym)}`,
    );
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setDays(r.data.days ?? {});
    setActiveDay(null);
    setCopyMode(false);
    setCopyTemplate(null);
    setCopyTargets(new Set());
  }, [employeeId, ym]);

  useEffect(() => {
    if (open && employeeId) void loadMonth();
  }, [open, employeeId, ym, loadMonth]);

  useEffect(() => {
    if (!open) {
      setYm(currentYearMonth());
      setDays({});
      setActiveDay(null);
      setCopyMode(false);
      setCopyTemplate(null);
      setCopyTargets(new Set());
      setErr(null);
    }
  }, [open]);

  const cells = useMemo(() => monthCalendarCells(ym), [ym]);

  function toggleCopyTarget(date: string): void {
    setCopyTargets((prev) => {
      const n = new Set(prev);
      if (n.has(date)) n.delete(date);
      else n.add(date);
      return n;
    });
  }

  function onCellClick(date: string | null): void {
    if (!date) return;
    if (copyMode) {
      toggleCopyTarget(date);
      return;
    }
    setActiveDay(date);
  }

  function beginCopyDay(): void {
    if (!activeDay) return;
    const slot = days[activeDay];
    const st = slot?.start?.trim() ?? "";
    const en = slot?.end?.trim() ?? "";
    if (!isValidFlexHm(st) || !isValidFlexHm(en)) {
      setErr("コピー元の日で、開始・終了を正しい時刻で入力してください（例 9:00、28:00）。");
      return;
    }
    setErr(null);
    setCopyTemplate({ start: st, end: en });
    setCopyMode(true);
    setCopyTargets(new Set());
  }

  function confirmCopy(): void {
    if (!copyTemplate || copyTargets.size === 0) {
      setErr("コピー先の日を1日以上選んでください。");
      return;
    }
    setErr(null);
    setDays((d) => {
      const n = { ...d };
      for (const dt of copyTargets) {
        n[dt] = { ...copyTemplate };
      }
      return n;
    });
    setCopyMode(false);
    setCopyTemplate(null);
    setCopyTargets(new Set());
  }

  function cancelCopyMode(): void {
    setCopyMode(false);
    setCopyTemplate(null);
    setCopyTargets(new Set());
  }

  const slot = activeDay ? days[activeDay] ?? { start: "", end: "" } : { start: "", end: "" };

  function updateActiveSlot(patch: Partial<ShiftDaySlot>): void {
    if (!activeDay) return;
    setDays((d) => {
      const cur = d[activeDay] ?? { start: "", end: "" };
      return {
        ...d,
        [activeDay]: {
          start: patch.start !== undefined ? patch.start : cur.start,
          end: patch.end !== undefined ? patch.end : cur.end,
        },
      };
    });
  }

  async function saveApplication(): Promise<void> {
    const msg = validateDaysForSave(days);
    if (msg) {
      setErr(msg);
      return;
    }
    const cleaned: Record<string, ShiftDaySlot> = {};
    for (const [k, v] of Object.entries(days)) {
      const st = v.start.trim();
      const en = v.end.trim();
      if (st && en) cleaned[k] = { start: st, end: en };
    }
    setBusy(true);
    setErr(null);
    const r = await apiFetch("/attendance/shift-applications", {
      method: "PUT",
      json: { employeeId, yearMonth: ym, days: cleaned },
    });
    setBusy(false);
    if (!r.ok) setErr(r.error);
    else {
      flashSaved();
      onSaved();
      onClose();
    }
  }

  if (!open) return null;

  const ymParts = parseYm(ym);

  return (
    <div
      className="pricing-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="pricing-modal attend-shift-dialog" role="dialog" aria-modal="true" aria-labelledby="attend-shift-title" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="attend-shift-title" className="pricing-modal-title">
          シフト申請
        </h2>
        <div className="attend-shift-dialog-scroll">
          <p className="settings-hint">
            {employeeLabel} — 日付をタップして勤務時間を入力します。
          </p>
          <Err msg={err} />

          {copyMode && copyTemplate ? (
            <p className="settings-hint attend-shift-copy-banner">
              コピー元: <strong>{copyTemplate.start}</strong> ～ <strong>{copyTemplate.end}</strong>
              。カレンダーで適用する日をタップして複数選択（<strong>赤</strong>
              ）し、「コピーを確定」を押してください。
            </p>
          ) : null}

          <div className="settings-form attend-shift-ym-row">
            <label htmlFor="shift-ym">年月</label>
            <input
              id="shift-ym"
              type="month"
              value={ym}
              onChange={(e) => {
                const v = e.target.value;
                if (/^\d{4}-\d{2}$/.test(v)) setYm(v);
              }}
            />
          </div>

          <div className="attend-cal">
            <div className="attend-cal-weekdays">
              {WEEK_LABELS.map((w) => (
                <span key={w} className="attend-cal-wd">
                  {w}
                </span>
              ))}
            </div>
            <div className="attend-cal-grid">
              {cells.map((c) => {
                const isSel = Boolean(c.date && activeDay === c.date && !copyMode);
                const isCopySel = Boolean(c.date && copyMode && copyTargets.has(c.date));
                const slotDay = c.date ? days[c.date] : null;
                const hasTime = Boolean(
                  slotDay && isValidFlexHm(slotDay.start.trim()) && isValidFlexHm(slotDay.end.trim()),
                );
                return (
                  <button
                    key={c.key}
                    type="button"
                    className={`attend-cal-cell${!c.date ? " attend-cal-cell--empty" : ""}${isSel ? " attend-cal-cell--active" : ""}${isCopySel ? " attend-cal-cell--copy" : ""}${hasTime ? " attend-cal-cell--has" : ""}`}
                    disabled={!c.date}
                    onClick={() => onCellClick(c.date)}
                  >
                    {c.dayNum != null ? c.dayNum : ""}
                  </button>
                );
              })}
            </div>
          </div>

          {!copyMode ? (
            <div className="settings-form attend-shift-time-block">
              <p className="settings-hint" style={{ marginTop: 0 }}>
                {activeDay ? `選択中: ${activeDay}` : "日付をタップしてください。"}
              </p>
              <label>開始（例 9:00、28:00）</label>
              <input
                type="text"
                className="attend-shift-time-field"
                autoComplete="off"
                placeholder="9:00"
                value={slot.start}
                onChange={(e) => updateActiveSlot({ start: e.target.value })}
                disabled={!activeDay}
              />
              <label>終了（例 18:00、36:00）</label>
              <input
                type="text"
                className="attend-shift-time-field"
                autoComplete="off"
                placeholder="18:00"
                value={slot.end}
                onChange={(e) => updateActiveSlot({ end: e.target.value })}
                disabled={!activeDay}
              />
              <p className="settings-hint">24時を超える場合は 25:00、28:00 のように入力できます（0:00〜48:59）。</p>
              <button type="button" className="settings-secondary" disabled={!activeDay} onClick={beginCopyDay}>
                この日をコピーする
              </button>
            </div>
          ) : (
            <div className="settings-form attend-shift-copy-actions">
              <button type="button" className="settings-primary" onClick={confirmCopy}>
                コピーを確定（{copyTargets.size} 日）
              </button>
              <button type="button" onClick={cancelCopyMode}>
                コピーキャンセル
              </button>
            </div>
          )}

          {ymParts ? (
            <p className="settings-hint">
              {ymParts.y}年{ymParts.m}月の申請内容を保存します（確定シフトは今後のシフト調整機能で別管理予定）。
            </p>
          ) : null}
        </div>

        <div className="pricing-modal-actions">
          <button type="button" className="settings-primary" disabled={busy} onClick={() => void saveApplication()}>
            申請を保存
          </button>
          <button type="button" disabled={busy} onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AttendanceMenuPage(): JSX.Element {
  const { me } = useAuth();
  const { flashSaved } = useSavedToast();
  const staffOnly = me ? isStaffShiftOnlyMe(me.permissions) : false;

  const [tab, setTab] = useState("shift");
  const [err, setErr] = useState<string | null>(null);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const [monthAppYm, setMonthAppYm] = useState(currentYearMonth);
  const [listDraft, setListDraft] = useState<Record<string, ShiftDaySlot>>({});
  const [listBusy, setListBusy] = useState(false);

  const roster = useMemo(
    () => employees.filter((e) => e.status === "ACTIVE" && !e.retiredAt),
    [employees],
  );

  const loadEmployees = useCallback(async () => {
    const r = await apiFetch<{ employees: EmployeeRow[] }>("/settings/employees");
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setEmployees(r.data.employees ?? []);
  }, []);

  useEffect(() => {
    void loadEmployees();
  }, [loadEmployees]);

  useEffect(() => {
    if (staffOnly && me?.employeeId) {
      setSelectedEmployeeId(me.employeeId);
    }
  }, [staffOnly, me?.employeeId]);

  const loadMonthApp = useCallback(
    async (ym: string) => {
      setMonthAppYm(ym);
      if (!selectedEmployeeId) {
        setListDraft({});
        return;
      }
      const r = await apiFetch<{ days: Record<string, ShiftDaySlot> }>(
        `/attendance/shift-applications?employeeId=${encodeURIComponent(selectedEmployeeId)}&yearMonth=${encodeURIComponent(ym)}`,
      );
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setListDraft({ ...(r.data.days ?? {}) });
      setErr(null);
    },
    [selectedEmployeeId],
  );

  useEffect(() => {
    if (tab === "shift" && selectedEmployeeId) void loadMonthApp(currentYearMonth());
  }, [tab, selectedEmployeeId, loadMonthApp]);

  const bumpMonth = (delta: number): void => {
    if (!selectedEmployeeId) return;
    void loadMonthApp(shiftYearMonth(monthAppYm, delta));
  };

  const selectedLabel = useMemo(() => {
    const e = roster.find((x) => x.id === selectedEmployeeId);
    return e ? `${e.familyName} ${e.givenName}` : "";
  }, [roster, selectedEmployeeId]);

  const listRows = useMemo(() => {
    const prefix = `${monthAppYm}-`;
    return Object.entries(listDraft)
      .filter(([d, v]) => d.startsWith(prefix) && (v.start.trim() || v.end.trim()))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [listDraft, monthAppYm]);

  function updateListDraft(date: string, patch: Partial<ShiftDaySlot>): void {
    setListDraft((d) => {
      const cur = d[date] ?? { start: "", end: "" };
      return {
        ...d,
        [date]: {
          start: patch.start !== undefined ? patch.start : cur.start,
          end: patch.end !== undefined ? patch.end : cur.end,
        },
      };
    });
  }

  async function saveListDraft(): Promise<void> {
    if (!selectedEmployeeId) return;
    const msg = validateDaysForSave(listDraft);
    if (msg) {
      setErr(msg);
      return;
    }
    const out: Record<string, ShiftDaySlot> = {};
    for (const [date, slot] of Object.entries(listDraft)) {
      if (!date.startsWith(`${monthAppYm}-`)) continue;
      const st = slot.start.trim();
      const en = slot.end.trim();
      if (!st && !en) continue;
      out[date] = { start: st, end: en };
    }
    setListBusy(true);
    setErr(null);
    const r = await apiFetch("/attendance/shift-applications", {
      method: "PUT",
      json: { employeeId: selectedEmployeeId, yearMonth: monthAppYm, days: out },
    });
    setListBusy(false);
    if (!r.ok) setErr(r.error);
    else {
      flashSaved();
      void loadMonthApp(monthAppYm);
    }
  }

  const shiftPanel = (
    <div className="settings-form attend-shift-root">
      {staffOnly && !me?.employeeId ? (
        <p className="settings-hint">このアカウントは従業員に紐づいていないため、シフト申請を利用できません。</p>
      ) : (
        <>
          <label>氏名（名簿）</label>
          <select
            value={selectedEmployeeId}
            disabled={staffOnly}
            onChange={(e) => setSelectedEmployeeId(e.target.value)}
          >
            <option value="">選択してください</option>
            {roster.map((e) => (
              <option key={e.id} value={e.id}>
                {e.familyName} {e.givenName}
              </option>
            ))}
          </select>
          {staffOnly ? <p className="settings-hint">スタッフ権限のため、ご自身のみ選択できます。</p> : null}

          <div className="settings-toolbar" style={{ marginTop: "0.75rem" }}>
            <button type="button" className="settings-primary" disabled={!selectedEmployeeId} onClick={() => setDialogOpen(true)}>
              シフト申請
            </button>
          </div>

          <h3 className="attend-shift-section-title">今月のシフト（確定）</h3>
          <p className="settings-hint">
            確定したシフトは、今後実装するシフト調整機能で反映される予定です。現時点ではここには表示されません。
          </p>

          <h3 className="attend-shift-section-title">申請一覧</h3>
          {!selectedEmployeeId ? (
            <p className="settings-hint">従業員を選ぶと、保存済みの申請を表示・編集できます。</p>
          ) : (
            <>
              <div className="attend-shift-month-nav">
                <button type="button" className="settings-secondary" disabled={listBusy} onClick={() => bumpMonth(-1)}>
                  前の月
                </button>
                <strong>{monthAppYm}</strong>
                <button type="button" className="settings-secondary" disabled={listBusy} onClick={() => bumpMonth(1)}>
                  次の月
                </button>
              </div>
              {listRows.length === 0 ? (
                <p className="settings-hint">この月の申請データはまだありません。</p>
              ) : (
                <ul className="settings-sf-list">
                  {listRows.map(([date, t]) => (
                    <li key={date} className="settings-sf-row attend-shift-list-row">
                      <span className="settings-sf-name">{date}</span>
                      <input
                        type="text"
                        className="attend-shift-time-field"
                        aria-label={`${date} 開始`}
                        value={t.start}
                        onChange={(e) => updateListDraft(date, { start: e.target.value })}
                      />
                      <span className="settings-sf-meta">～</span>
                      <input
                        type="text"
                        className="attend-shift-time-field"
                        aria-label={`${date} 終了`}
                        value={t.end}
                        onChange={(e) => updateListDraft(date, { end: e.target.value })}
                      />
                    </li>
                  ))}
                </ul>
              )}
              <p className="settings-hint">
                24時超は 28:00 のように入力できます。両方空にして保存するとその日は削除されます。申請がない月は保存で空にできます。
              </p>
              <button type="button" className="settings-primary" disabled={listBusy} onClick={() => void saveListDraft()}>
                保存
              </button>
            </>
          )}
        </>
      )}

      <ShiftApplyDialog
        open={dialogOpen}
        employeeId={selectedEmployeeId}
        employeeLabel={selectedLabel}
        onClose={() => setDialogOpen(false)}
        onSaved={() => {
          void loadMonthApp(monthAppYm);
        }}
      />
    </div>
  );

  const timeCardPanel = (
    <div className="settings-form">
      <p className="settings-hint">タイムカード（打刻・集計）は今後実装予定です。</p>
    </div>
  );

  const tabItems: TabDef[] = [
    { id: "shift", label: "シフト", children: shiftPanel },
    { id: "timecard", label: "タイムカード", children: timeCardPanel },
  ];

  return (
    <Card title="勤怠">
      <Err msg={err} />
      <Tabs items={tabItems} activeId={tab} onActiveChange={setTab} aria-label="勤怠の種類" />
    </Card>
  );
}

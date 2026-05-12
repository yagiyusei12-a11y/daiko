import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import { useSavedToast } from "../saved-toast";
import { Err } from "../ui";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;
const WEEK_LABELS_CAL = ["日", "月", "火", "水", "木", "金", "土"];

type BusinessHoursSlot = { id: string; open: string; close: string };

type RegularHolidayWeekly = { id: string; kind: "weekly"; weekdays: number[] };
type RegularHolidayNthWeekday = { id: string; kind: "nthWeekday"; nth: number; weekday: number };
type RegularHolidayMonthlyDay = { id: string; kind: "monthlyDay"; day: number };
type RegularHolidayEntry = RegularHolidayWeekly | RegularHolidayNthWeekday | RegularHolidayMonthlyDay;

type BusinessBasicsV1 = {
  version: 1;
  businessHours: BusinessHoursSlot[];
  regularHolidays: RegularHolidayEntry[];
  temporaryClosureDates: string[];
};

function newId(prefix: string): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${prefix}_${Date.now()}`;
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

function formatRegularHoliday(r: RegularHolidayEntry): string {
  if (r.kind === "weekly") {
    const names = r.weekdays.map((d) => `${WEEKDAY_LABELS[d]}曜`).join("・");
    return `毎週 ${names}`;
  }
  if (r.kind === "nthWeekday") {
    const nthLabel = r.nth === -1 ? "最終" : `第${r.nth}`;
    const wd = WEEKDAY_LABELS[r.weekday] ?? String(r.weekday);
    return `毎月 ${nthLabel} ${wd}曜`;
  }
  return `毎月 ${r.day}日`;
}

type Props = {
  setErr: (msg: string | null) => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
};

export default function BasicSettingsPanel({ setErr, busy, setBusy }: Props): JSX.Element {
  const { flashSaved } = useSavedToast();
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<BusinessBasicsV1 | null>(null);

  const [regularDialogOpen, setRegularDialogOpen] = useState(false);
  const [rhEdit, setRhEdit] = useState<RegularHolidayEntry[]>([]);
  const [rhKind, setRhKind] = useState<"weekly" | "nthWeekday" | "monthlyDay">("weekly");
  const [rhWeekdays, setRhWeekdays] = useState<number[]>([]);
  const [rhNth, setRhNth] = useState<1 | 2 | 3 | 4 | -1>(2);
  const [rhWeekday, setRhWeekday] = useState(1);
  const [rhMonthDay, setRhMonthDay] = useState(1);

  const [tempDialogOpen, setTempDialogOpen] = useState(false);
  const [tempYm, setTempYm] = useState(currentYearMonth);
  const [tempSelected, setTempSelected] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    setLocalErr(null);
    const r = await apiFetch<BusinessBasicsV1>("/settings/basics");
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setDraft({
      version: 1,
      businessHours: r.data.businessHours ?? [],
      regularHolidays: r.data.regularHolidays ?? [],
      temporaryClosureDates: r.data.temporaryClosureDates ?? [],
    });
  }, [setErr]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveAll(): Promise<void> {
    if (!draft) return;
    setBusy(true);
    setErr(null);
    setLocalErr(null);
    const r = await apiFetch("/settings/basics", {
      method: "PUT",
      json: {
        businessHours: draft.businessHours,
        regularHolidays: draft.regularHolidays,
        temporaryClosureDates: draft.temporaryClosureDates,
      },
    });
    setBusy(false);
    if (!r.ok) setErr(r.error);
    else {
      flashSaved();
      void load();
    }
  }

  function openRegularDialog(): void {
    if (!draft) return;
    setRhEdit([...draft.regularHolidays]);
    setRhKind("weekly");
    setRhWeekdays([]);
    setRhNth(2);
    setRhWeekday(1);
    setRhMonthDay(1);
    setRegularDialogOpen(true);
    setLocalErr(null);
  }

  function confirmRegularDialog(): void {
    if (!draft) return;
    setDraft({ ...draft, regularHolidays: rhEdit });
    setRegularDialogOpen(false);
  }

  function addRegularPattern(): void {
    if (rhKind === "weekly") {
      if (rhWeekdays.length === 0) {
        setLocalErr("曜日を1つ以上選んでください。");
        return;
      }
      setLocalErr(null);
      setRhEdit((list) => [...list, { id: newId("rh"), kind: "weekly", weekdays: [...rhWeekdays].sort((a, b) => a - b) }]);
      return;
    }
    if (rhKind === "nthWeekday") {
      setLocalErr(null);
      setRhEdit((list) => [...list, { id: newId("rh"), kind: "nthWeekday", nth: rhNth, weekday: rhWeekday }]);
      return;
    }
    setLocalErr(null);
    setRhEdit((list) => [...list, { id: newId("rh"), kind: "monthlyDay", day: rhMonthDay }]);
  }

  function removeRh(id: string): void {
    setRhEdit((list) => list.filter((x) => x.id !== id));
  }

  function toggleRhWeekday(d: number): void {
    setRhWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));
  }

  function openTempDialog(): void {
    if (!draft) return;
    setTempYm(currentYearMonth());
    setTempSelected(new Set(draft.temporaryClosureDates));
    setTempDialogOpen(true);
    setLocalErr(null);
  }

  function confirmTempDialog(): void {
    if (!draft) return;
    const sorted = [...tempSelected].sort((a, b) => a.localeCompare(b));
    setDraft({ ...draft, temporaryClosureDates: sorted });
    setTempDialogOpen(false);
  }

  function toggleTempDate(date: string | null): void {
    if (!date) return;
    setTempSelected((prev) => {
      const n = new Set(prev);
      if (n.has(date)) n.delete(date);
      else n.add(date);
      return n;
    });
  }

  const tempCells = useMemo(() => monthCalendarCells(tempYm), [tempYm]);

  const regularSummary = useMemo(() => {
    if (!draft || draft.regularHolidays.length === 0) return "未設定";
    return draft.regularHolidays.map(formatRegularHoliday).join(" / ");
  }, [draft]);

  const tempSummary = useMemo(() => {
    if (!draft || draft.temporaryClosureDates.length === 0) return "未設定";
    return draft.temporaryClosureDates.join("、");
  }, [draft]);

  if (!draft) {
    return <p className="settings-hint">読み込み中…</p>;
  }

  return (
    <div className="settings-form settings-basic-root">
      <p className="settings-hint">
        営業時間は翌未明まで「26:00」のように入力できます。複数枠（昼休みで分割など）は「営業時間を追加」で行を足してください。
      </p>

      <h3 className="settings-subtitle">営業時間</h3>
      {draft.businessHours.length === 0 ? (
        <p className="settings-hint">まだ登録がありません。下のボタンで追加してください。</p>
      ) : (
        <ul className="settings-sf-list">
          {draft.businessHours.map((row, idx) => (
            <li key={row.id} className="settings-sf-row settings-basic-hours-row">
              <span className="settings-sf-name">枠 {idx + 1}</span>
              <input
                type="text"
                className="attend-shift-time-field"
                aria-label={`枠${idx + 1} 開始`}
                value={row.open}
                onChange={(e) =>
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          businessHours: d.businessHours.map((x) =>
                            x.id === row.id ? { ...x, open: e.target.value } : x,
                          ),
                        }
                      : d,
                  )
                }
              />
              <span className="settings-sf-meta">～</span>
              <input
                type="text"
                className="attend-shift-time-field"
                aria-label={`枠${idx + 1} 終了`}
                value={row.close}
                onChange={(e) =>
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          businessHours: d.businessHours.map((x) =>
                            x.id === row.id ? { ...x, close: e.target.value } : x,
                          ),
                        }
                      : d,
                  )
                }
              />
              <button
                type="button"
                className="settings-secondary"
                onClick={() =>
                  setDraft((d) =>
                    d ? { ...d, businessHours: d.businessHours.filter((x) => x.id !== row.id) } : d,
                  )
                }
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="settings-secondary"
        onClick={() =>
          setDraft((d) =>
            d
              ? {
                  ...d,
                  businessHours: [...d.businessHours, { id: newId("bh"), open: "9:00", close: "18:00" }],
                }
              : d,
          )
        }
      >
        営業時間を追加
      </button>

      <h3 className="settings-subtitle" style={{ marginTop: "1.25rem" }}>
        定休日
      </h3>
      <p className="settings-hint">現在の設定: {regularSummary}</p>
      <button type="button" className="settings-secondary" onClick={() => openRegularDialog()}>
        定休日を編集（ダイアログ）
      </button>

      <h3 className="settings-subtitle" style={{ marginTop: "1.25rem" }}>
        臨時休業日
      </h3>
      <p className="settings-hint">選択中: {tempSummary}</p>
      <button type="button" className="settings-secondary" onClick={() => openTempDialog()}>
        臨時休業日を編集（カレンダー）
      </button>

      <div className="settings-actions" style={{ marginTop: "1.25rem" }}>
        <button type="button" className="settings-primary" disabled={busy} onClick={() => void saveAll()}>
          保存
        </button>
      </div>

      {regularDialogOpen ? (
        <div
          className="pricing-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setRegularDialogOpen(false);
          }}
        >
          <div
            className="pricing-modal attend-shift-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="basic-rh-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="basic-rh-title" className="pricing-modal-title">
              定休日パターン
            </h2>
            <div className="attend-shift-dialog-scroll">
              <Err msg={localErr} />
              <p className="settings-hint">
                毎週の曜日・毎月の第N曜日（または最終曜日）・毎月の日付、のいずれかを追加できます。
              </p>
              {rhEdit.length === 0 ? (
                <p className="settings-hint">パターンはまだありません。</p>
              ) : (
                <ul className="settings-sf-list">
                  {rhEdit.map((r) => (
                    <li key={r.id} className="settings-sf-row attend-shift-list-row">
                      <span className="settings-sf-name">{formatRegularHoliday(r)}</span>
                      <button type="button" className="settings-secondary" onClick={() => removeRh(r.id)}>
                        削除
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="settings-form" style={{ marginTop: "1rem" }}>
                <label>追加するパターン</label>
                <select value={rhKind} onChange={(e) => setRhKind(e.target.value as typeof rhKind)}>
                  <option value="weekly">毎週（曜日を複数選択）</option>
                  <option value="nthWeekday">毎月 第N ○曜日</option>
                  <option value="monthlyDay">毎月 ○日</option>
                </select>

                {rhKind === "weekly" ? (
                  <div className="settings-checkbox-row" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                    {WEEKDAY_LABELS.map((label, d) => (
                      <label key={label} className="settings-inline-check">
                        <input type="checkbox" checked={rhWeekdays.includes(d)} onChange={() => toggleRhWeekday(d)} />
                        {label}曜
                      </label>
                    ))}
                  </div>
                ) : null}

                {rhKind === "nthWeekday" ? (
                  <>
                    <label>第何週</label>
                    <select value={rhNth} onChange={(e) => setRhNth(Number(e.target.value) as 1 | 2 | 3 | 4 | -1)}>
                      <option value={1}>第1</option>
                      <option value={2}>第2</option>
                      <option value={3}>第3</option>
                      <option value={4}>第4</option>
                      <option value={-1}>最終</option>
                    </select>
                    <label>曜日</label>
                    <select value={rhWeekday} onChange={(e) => setRhWeekday(Number(e.target.value))}>
                      {WEEKDAY_LABELS.map((label, d) => (
                        <option key={label} value={d}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </>
                ) : null}

                {rhKind === "monthlyDay" ? (
                  <>
                    <label>日（1〜31）</label>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={rhMonthDay}
                      onChange={(e) => setRhMonthDay(Math.min(31, Math.max(1, Number(e.target.value) || 1)))}
                    />
                  </>
                ) : null}

                <button type="button" className="settings-primary" onClick={() => addRegularPattern()}>
                  このパターンを追加
                </button>
              </div>
            </div>
            <div className="pricing-modal-actions">
              <button type="button" className="settings-primary" onClick={() => confirmRegularDialog()}>
                確定
              </button>
              <button type="button" onClick={() => setRegularDialogOpen(false)}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tempDialogOpen ? (
        <div
          className="pricing-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setTempDialogOpen(false);
          }}
        >
          <div
            className="pricing-modal attend-shift-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="basic-temp-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="basic-temp-title" className="pricing-modal-title">
              臨時休業日（複数選択）
            </h2>
            <div className="attend-shift-dialog-scroll">
              <p className="settings-hint">日付をタップして選択／解除します。複数月にまたがる場合は年月を変えて選んでください。</p>
              <div className="settings-form attend-shift-ym-row">
                <label htmlFor="basic-temp-ym">年月</label>
                <input
                  id="basic-temp-ym"
                  type="month"
                  value={tempYm}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (/^\d{4}-\d{2}$/.test(v)) setTempYm(v);
                  }}
                />
                <button type="button" className="settings-secondary" onClick={() => setTempYm((y) => shiftYearMonth(y, -1))}>
                  前月
                </button>
                <button type="button" className="settings-secondary" onClick={() => setTempYm((y) => shiftYearMonth(y, 1))}>
                  次月
                </button>
              </div>
              <div className="attend-cal">
                <div className="attend-cal-weekdays">
                  {WEEK_LABELS_CAL.map((w) => (
                    <span key={w} className="attend-cal-wd">
                      {w}
                    </span>
                  ))}
                </div>
                <div className="attend-cal-grid">
                  {tempCells.map((c) => {
                    const sel = Boolean(c.date && tempSelected.has(c.date));
                    return (
                      <button
                        key={c.key}
                        type="button"
                        className={`attend-cal-cell${!c.date ? " attend-cal-cell--empty" : ""}${sel ? " attend-cal-cell--copy" : ""}`}
                        disabled={!c.date}
                        onClick={() => toggleTempDate(c.date)}
                      >
                        {c.dayNum != null ? c.dayNum : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="settings-hint">
                選択中 {tempSelected.size} 日: {[...tempSelected].sort((a, b) => a.localeCompare(b)).join("、") || "なし"}
              </p>
            </div>
            <div className="pricing-modal-actions">
              <button type="button" className="settings-primary" onClick={() => confirmTempDialog()}>
                確定
              </button>
              <button type="button" onClick={() => setTempDialogOpen(false)}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

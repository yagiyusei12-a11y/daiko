import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import { useAuth, isFullNavMe, isStaffShiftOnlyMe } from "../auth";
import { useSavedToast } from "../saved-toast";
import { Card, Err, Tabs, type TabDef } from "../ui";
import { filterSubTabsForMe } from "../lib/staff-menu-client";
import { FlexTimeInput } from "../components/FlexTimeInput";
import {
  flexHmToMinutes,
  formatFlexTimeOnBlur,
  isValidFlexHm,
  normalizeShiftDaySlot,
} from "../lib/flex-time-input";
import { weekDatesContaining, shiftYmd } from "../lib/schedule-week";
import { timecardButtonAvailability } from "../lib/timecard-punch-order";

type EmployeeRow = {
  id: string;
  familyName: string;
  givenName: string;
  status: string;
  retiredAt: string | null;
  safetyDrivingManager?: boolean;
};

type BreathalyzerEntry = {
  id: string;
  name: string;
  lastInspectionYmd: string | null;
  verificationMethods: string[];
};

type ShiftDaySlot = { start: string; end: string };

type ConfirmedDayInfo = { startTime: string; endTime: string; duties: string[] };

type TcMonthSummarySlot = { id: string; punchedAt: string; hm: string };

function computeWorkMinutes(row: {
  clockIn: TcMonthSummarySlot | null;
  breakStart: TcMonthSummarySlot | null;
  breakEnd: TcMonthSummarySlot | null;
  clockOut: TcMonthSummarySlot | null;
}): number | null {
  if (!row.clockIn?.punchedAt || !row.clockOut?.punchedAt) return null;
  const inMs = new Date(row.clockIn.punchedAt).getTime();
  const outMs = new Date(row.clockOut.punchedAt).getTime();
  if (outMs <= inMs) return null;
  let workMs = outMs - inMs;
  if (row.breakStart?.punchedAt && row.breakEnd?.punchedAt) {
    const bsMs = new Date(row.breakStart.punchedAt).getTime();
    const beMs = new Date(row.breakEnd.punchedAt).getTime();
    if (beMs > bsMs) workMs -= beMs - bsMs;
  }
  return Math.max(0, Math.floor(workMs / 60000));
}

function formatWorkDuration(minutes: number | null): string {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}時間${m}分` : `${h}時間`;
}

/** 給料の「×」表示用（端数分を含む場合は時間の小数表記） */
function formatBasisForRateLine(minutes: number): string {
  const intMin = Math.round(minutes);
  if (Math.abs(minutes - intMin) < 1e-3) {
    const h = Math.floor(intMin / 60);
    const m = intMin % 60;
    return m > 0 ? `${h}h${m}m` : `${h}h`;
  }
  return `${(minutes / 60).toFixed(2)}時間`;
}

type SalaryPrefsClient = {
  version: 1;
  minuteStep: number;
  timeRounding: "floor" | "ceil" | "round";
  yenRounding: "floor" | "ceil" | "round";
};

type TcMonthSummaryRow = {
  employeeId: string;
  familyName: string;
  givenName: string;
  businessDate: string;
  clockIn: TcMonthSummarySlot | null;
  breakStart: TcMonthSummarySlot | null;
  breakEnd: TcMonthSummarySlot | null;
  clockOut: TcMonthSummarySlot | null;
  baseHourlyYen: number;
  roleLabel: string | null;
  wageYen: number | null;
  wageBasisMinutes?: number | null;
};

type TcEditField = { punchId: string; label: string; local: string; originalIso: string };

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatAlcoholBrief(ac: unknown): string | null {
  if (!ac || typeof ac !== "object") return null;
  const o = ac as Record<string, unknown>;
  const name = typeof o.breathalyzerName === "string" ? o.breathalyzerName : "";
  const vm = typeof o.verificationMethod === "string" ? o.verificationMethod : "";
  const det = Boolean(o.alcoholDetected);
  if (!name) return null;
  return `${name} / ${vm || "—"} / ${det ? "酒気帯びあり" : "酒気帯びなし"}`;
}

const SHIFT_DUTY_OPTIONS = ["客車", "随伴車", "電話", "スケジュール"] as const;

type AllDateShiftRow = {
  employeeId: string;
  familyName: string;
  givenName: string;
  businessDate: string;
  startTime: string;
  endTime: string;
  duties: string[];
};

function validateDaysForSave(days: Record<string, ShiftDaySlot>): string | null {
  for (const [date, slot] of Object.entries(days)) {
    const { start: st, end: en } = normalizeShiftDaySlot(slot);
    if (!st && !en) continue;
    if (!st || !en) return `${date}: 開始・終了の両方を入力してください。`;
    if (!isValidFlexHm(st) || !isValidFlexHm(en)) {
      return `${date}: 時刻は 0:00〜48:59 の「時:分」で入力してください（例 9:00、28:00）。`;
    }
  }
  return null;
}

function validateOneDaySlot(date: string, start: string, end: string): string | null {
  const st = formatFlexTimeOnBlur(start);
  const en = formatFlexTimeOnBlur(end);
  if (!st || !en) return `${date}: 開始・終了の両方を入力してください。`;
  if (!isValidFlexHm(st) || !isValidFlexHm(en)) {
    return `${date}: 時刻は 0:00〜48:59 の「時:分」で入力してください（例 9:00、28:00）。`;
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
/** 月曜始まりの週ラベル（weekDatesContaining の並びと一致） */
const WEEKDAY_MON_START = ["月", "火", "水", "木", "金", "土", "日"] as const;

function tokyoYmdToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function ymdToYearMonth(ymd: string): string {
  return ymd.slice(0, 7);
}

function mondayOfWeekContaining(ymd: string): string {
  return weekDatesContaining(ymd)[0] ?? ymd;
}

function formatShiftWeekLabel(dates: string[]): string {
  if (dates.length === 0) return "";
  const fmt = (ymd: string, wd: string) => {
    const parts = ymd.split("-");
    const mo = Number(parts[1]);
    const d = Number(parts[2]);
    return `${mo}/${d}（${wd}）`;
  };
  const first = dates[0];
  const last = dates[dates.length - 1];
  return `${fmt(first, "月")} 〜 ${fmt(last, "日")}`;
}

function formatShiftDayRowLabel(ymd: string, weekday: string): string {
  const parts = ymd.split("-");
  const mo = Number(parts[1]);
  const d = Number(parts[2]);
  return `${mo}/${d}（${weekday}）`;
}

function emptyWeekSlots(dates: string[]): Record<string, ShiftDaySlot> {
  const out: Record<string, ShiftDaySlot> = {};
  for (const d of dates) out[d] = { start: "", end: "" };
  return out;
}

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
  const [weekStart, setWeekStart] = useState(() => mondayOfWeekContaining(tokyoYmdToday()));
  /** 月ごとの申請全体（保存時のマージ用） */
  const [monthDays, setMonthDays] = useState<Record<string, Record<string, ShiftDaySlot>>>({});
  /** 表示中の週の編集下書き */
  const [weekDraft, setWeekDraft] = useState<Record<string, ShiftDaySlot>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const weekDates = useMemo(() => weekDatesContaining(weekStart), [weekStart]);

  const loadWeek = useCallback(async () => {
    if (!employeeId) return;
    const dates = weekDatesContaining(weekStart);
    const months = [...new Set(dates.map(ymdToYearMonth))];
    setLoading(true);
    setErr(null);
    const nextMonthDays: Record<string, Record<string, ShiftDaySlot>> = {};
    for (const ym of months) {
      const r = await apiFetch<{ days: Record<string, ShiftDaySlot> }>(
        `/attendance/shift-applications?employeeId=${encodeURIComponent(employeeId)}&yearMonth=${encodeURIComponent(ym)}`,
      );
      if (!r.ok) {
        setLoading(false);
        setErr(r.error);
        return;
      }
      nextMonthDays[ym] = { ...(r.data.days ?? {}) };
    }
    const draft = emptyWeekSlots(dates);
    for (const d of dates) {
      const slot = nextMonthDays[ymdToYearMonth(d)]?.[d];
      if (slot) draft[d] = { start: slot.start ?? "", end: slot.end ?? "" };
    }
    setMonthDays(nextMonthDays);
    setWeekDraft(draft);
    setLoading(false);
  }, [employeeId, weekStart]);

  useEffect(() => {
    if (open && employeeId) void loadWeek();
  }, [open, employeeId, loadWeek]);

  useEffect(() => {
    if (!open) {
      setWeekStart(mondayOfWeekContaining(tokyoYmdToday()));
      setMonthDays({});
      setWeekDraft({});
      setErr(null);
      setBusy(false);
      setLoading(false);
    }
  }, [open]);

  function updateWeekSlot(date: string, patch: Partial<ShiftDaySlot>): void {
    setWeekDraft((prev) => {
      const cur = prev[date] ?? { start: "", end: "" };
      return {
        ...prev,
        [date]: {
          start: patch.start !== undefined ? patch.start : cur.start,
          end: patch.end !== undefined ? patch.end : cur.end,
        },
      };
    });
  }

  function clearWeekSlot(date: string): void {
    setWeekDraft((prev) => ({ ...prev, [date]: { start: "", end: "" } }));
  }

  async function saveApplication(): Promise<void> {
    const dates = weekDates;
    const normalizedWeek: Record<string, ShiftDaySlot> = {};
    for (const d of dates) {
      normalizedWeek[d] = normalizeShiftDaySlot(weekDraft[d] ?? { start: "", end: "" });
    }
    setWeekDraft(normalizedWeek);
    const msg = validateDaysForSave(normalizedWeek);
    if (msg) {
      setErr(msg);
      return;
    }

    const months = [...new Set(dates.map(ymdToYearMonth))];
    setBusy(true);
    setErr(null);

    for (const ym of months) {
      const base: Record<string, ShiftDaySlot> = { ...(monthDays[ym] ?? {}) };
      for (const d of dates) {
        if (ymdToYearMonth(d) !== ym) continue;
        const slot = normalizedWeek[d];
        const st = slot.start.trim();
        const en = slot.end.trim();
        if (st && en) base[d] = { start: st, end: en };
        else delete base[d];
      }
      const cleaned: Record<string, ShiftDaySlot> = {};
      for (const [k, v] of Object.entries(base)) {
        const st = String(v.start ?? "").trim();
        const en = String(v.end ?? "").trim();
        if (st && en) cleaned[k] = { start: st, end: en };
      }
      const r = await apiFetch("/attendance/shift-applications", {
        method: "PUT",
        json: { employeeId, yearMonth: ym, days: cleaned },
      });
      if (!r.ok) {
        setBusy(false);
        setErr(r.error);
        return;
      }
    }

    setBusy(false);
    flashSaved();
    onSaved();
    onClose();
  }

  if (!open) return null;

  const isThisWeek = weekStart === mondayOfWeekContaining(tokyoYmdToday());

  return (
    <div
      className="pricing-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="pricing-modal attend-shift-dialog attend-shift-dialog--week"
        role="dialog"
        aria-modal="true"
        aria-labelledby="attend-shift-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="attend-shift-title" className="pricing-modal-title">
          シフト申請
        </h2>
        <div className="attend-shift-dialog-scroll">
          <p className="settings-hint">{employeeLabel} — 1週間分の勤務時間を入力します。</p>
          <Err msg={err} />

          <div className="attend-shift-week-nav">
            <button
              type="button"
              className="settings-secondary"
              disabled={busy || loading}
              onClick={() => setWeekStart((w) => shiftYmd(w, -7))}
            >
              前の週
            </button>
            <strong className="attend-shift-week-range">{formatShiftWeekLabel(weekDates)}</strong>
            <button
              type="button"
              className="settings-secondary"
              disabled={busy || loading}
              onClick={() => setWeekStart((w) => shiftYmd(w, 7))}
            >
              次の週
            </button>
            <button
              type="button"
              className="settings-secondary"
              disabled={busy || loading || isThisWeek}
              onClick={() => setWeekStart(mondayOfWeekContaining(tokyoYmdToday()))}
            >
              今週へ
            </button>
          </div>

          {loading ? (
            <p className="settings-hint">読み込み中…</p>
          ) : (
            <ul className="attend-shift-week-list">
              {weekDates.map((date, i) => {
                const slot = weekDraft[date] ?? { start: "", end: "" };
                const wd = WEEKDAY_MON_START[i] ?? "";
                const hasAny = Boolean(slot.start.trim() || slot.end.trim());
                return (
                  <li key={date} className="attend-shift-week-row">
                    <div className="attend-shift-week-row-head">
                      <span className="attend-shift-week-day">{formatShiftDayRowLabel(date, wd)}</span>
                      <button
                        type="button"
                        className="attend-shift-week-clear"
                        disabled={!hasAny || busy}
                        onClick={() => clearWeekSlot(date)}
                      >
                        クリア
                      </button>
                    </div>
                    <div className="attend-shift-week-times">
                      <label className="attend-shift-week-time-label">
                        <span>開始</span>
                        <FlexTimeInput
                          aria-label={`${date} 開始`}
                          placeholder="20:00"
                          value={slot.start}
                          onChange={(start) => updateWeekSlot(date, { start })}
                          disabled={busy}
                        />
                      </label>
                      <span className="attend-shift-week-tilde" aria-hidden="true">
                        ～
                      </span>
                      <label className="attend-shift-week-time-label">
                        <span>終了</span>
                        <FlexTimeInput
                          aria-label={`${date} 終了`}
                          placeholder="28:00"
                          value={slot.end}
                          onChange={(end) => updateWeekSlot(date, { end })}
                          disabled={busy}
                        />
                      </label>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="settings-hint">
            24時超は 28:00 のように入力。両方空ならその日は申請なし。確定シフトは「シフト調整」で登録します。
          </p>
        </div>

        <div className="pricing-modal-actions">
          <button type="button" className="settings-primary" disabled={busy || loading} onClick={() => void saveApplication()}>
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

function AllStaffShiftsDialog({
  open,
  initialYm,
  onClose,
}: {
  open: boolean;
  initialYm: string;
  onClose: () => void;
}): JSX.Element | null {
  const [ym, setYm] = useState(initialYm);
  const [picked, setPicked] = useState<string | null>(null);
  const [rows, setRows] = useState<AllDateShiftRow[]>([]);
  const [errLocal, setErrLocal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setYm(initialYm);
    setPicked(null);
    setRows([]);
    setErrLocal(null);
  }, [open, initialYm]);

  useEffect(() => {
    if (!open) return;
    setPicked(null);
    setRows([]);
  }, [ym, open]);

  const cells = useMemo(() => monthCalendarCells(ym), [ym]);

  async function pickDate(date: string | null): Promise<void> {
    if (!date) return;
    setBusy(true);
    setErrLocal(null);
    const r = await apiFetch<{ rows: AllDateShiftRow[] }>(
      `/attendance/confirmed-shifts/by-date?date=${encodeURIComponent(date)}`,
    );
    setBusy(false);
    if (!r.ok) {
      setErrLocal(r.error);
      return;
    }
    setPicked(date);
    setRows(r.data.rows ?? []);
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
      <div
        className="pricing-modal attend-shift-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="all-shifts-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="all-shifts-title" className="pricing-modal-title">
          その日の全員のシフト
        </h2>
        <div className="attend-shift-dialog-scroll">
          <p className="settings-hint">カレンダーで日付をタップすると、確定シフトの一覧を表示します。</p>
          <Err msg={errLocal} />
          <div className="settings-form attend-shift-ym-row">
            <label htmlFor="all-shifts-ym">年月</label>
            <input
              id="all-shifts-ym"
              type="month"
              value={ym}
              onChange={(e) => {
                const v = e.target.value;
                if (/^\d{4}-\d{2}$/.test(v)) setYm(v);
              }}
            />
          </div>
          {ymParts ? (
            <p className="settings-hint">
              {ymParts.y}年{ymParts.m}月
            </p>
          ) : null}
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
                const isSel = Boolean(c.date && picked === c.date);
                return (
                  <button
                    key={c.key}
                    type="button"
                    className={`attend-cal-cell${!c.date ? " attend-cal-cell--empty" : ""}${isSel ? " attend-cal-cell--active" : ""}`}
                    disabled={!c.date}
                    onClick={() => void pickDate(c.date)}
                  >
                    {c.dayNum != null ? c.dayNum : ""}
                  </button>
                );
              })}
            </div>
          </div>
          {picked ? (
            busy ? (
              <p className="settings-hint">読み込み中…</p>
            ) : rows.length === 0 ? (
              <p className="settings-hint">
                {picked} の確定シフトはまだありません。
              </p>
            ) : (
              <ul className="settings-sf-list">
                {rows.map((r) => (
                  <li key={r.employeeId} className="settings-sf-row attend-shift-list-row">
                    <span className="settings-sf-name">
                      {r.familyName} {r.givenName}
                    </span>
                    <span className="settings-sf-meta">
                      {r.startTime} ～ {r.endTime}
                      {r.duties.length ? `（${r.duties.join("・")}）` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
        <div className="pricing-modal-actions">
          <button type="button" onClick={onClose}>
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
  const isAdmin = me ? isFullNavMe(me.permissions) : false;
  const canPickEmployee = isAdmin;

  const [tab, setTab] = useState("shift");
  const [err, setErr] = useState<string | null>(null);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const [monthAppYm, setMonthAppYm] = useState(currentYearMonth);
  const [listDraft, setListDraft] = useState<Record<string, ShiftDaySlot>>({});
  const [listBusy, setListBusy] = useState(false);
  const [monthLoading, setMonthLoading] = useState(false);
  const [confirmedMap, setConfirmedMap] = useState<Record<string, ConfirmedDayInfo>>({});
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [allDialogOpen, setAllDialogOpen] = useState(false);
  const [adjustAppDates, setAdjustAppDates] = useState<string[]>([]);
  const [adjustConfDates, setAdjustConfDates] = useState<string[]>([]);
  const [adjustIndLoading, setAdjustIndLoading] = useState(false);
  const [adjustDialogDate, setAdjustDialogDate] = useState<string | null>(null);
  type AdjustUiRow = {
    employeeId: string;
    familyName: string;
    givenName: string;
    applyStart: string;
    applyEnd: string;
    confStart: string;
    confEnd: string;
    duties: string[];
  };
  const [adjustUiRows, setAdjustUiRows] = useState<AdjustUiRow[]>([]);
  const [adjustRowBusy, setAdjustRowBusy] = useState<string | null>(null);

  const [dayChangeHour, setDayChangeHour] = useState(28);

  function tokyoBusinessDate(dch: number): string {
    const now = new Date();
    const tokyoParts = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(now);
    const get = (t: string) => tokyoParts.find((p) => p.type === t)?.value ?? "00";
    const ymd = `${get("year")}-${get("month")}-${get("day")}`;
    const hour = Number(get("hour"));
    const rollHour = dch - 24;
    if (rollHour > 0 && hour < rollHour) {
      // まだ事業日が変わっていない → 前日の事業日
      const prev = new Date(`${ymd}T12:00:00+09:00`);
      prev.setDate(prev.getDate() - 1);
      return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}-${String(prev.getDate()).padStart(2, "0")}`;
    }
    return ymd;
  }

  const [tcDate, setTcDate] = useState(() => tokyoBusinessDate(28));
  const [tcEmployeeId, setTcEmployeeId] = useState("");
  const [tcPunches, setTcPunches] = useState<
    Array<{ id: string; kind: string; punchedAt: string; alcoholCheck?: unknown }>
  >([]);
  const [tcLoading, setTcLoading] = useState(false);
  const [tcAlcoholOpen, setTcAlcoholOpen] = useState(false);
  const [tcAlcoholPhase, setTcAlcoholPhase] = useState<"CLOCK_IN" | "CLOCK_OUT">("CLOCK_IN");
  const [tcAlcoholErr, setTcAlcoholErr] = useState<string | null>(null);
  const [tcBreathList, setTcBreathList] = useState<BreathalyzerEntry[]>([]);
  const [alcBreathId, setAlcBreathId] = useState("");
  const [alcVerifierId, setAlcVerifierId] = useState("");
  const [alcMethod, setAlcMethod] = useState("");
  const [alcDetected, setAlcDetected] = useState(false);
  const [alcNote, setAlcNote] = useState("");
  const [tcListYm, setTcListYm] = useState(currentYearMonth);
  const [tcListRows, setTcListRows] = useState<TcMonthSummaryRow[]>([]);
  const [tcListLoading, setTcListLoading] = useState(false);
  const [tcEdit, setTcEdit] = useState<{
    employeeId: string;
    businessDate: string;
    displayName: string;
    fields: TcEditField[];
  } | null>(null);
  const [tcEditBusy, setTcEditBusy] = useState(false);

  const [salaryEmpId, setSalaryEmpId] = useState("");
  const [salaryYm, setSalaryYm] = useState(currentYearMonth);
  const [salaryRows, setSalaryRows] = useState<TcMonthSummaryRow[]>([]);
  const [salaryLoading, setSalaryLoading] = useState(false);
  const [salaryPrefs, setSalaryPrefs] = useState<SalaryPrefsClient | null>(null);

  const roster = useMemo(
    () => employees.filter((e) => e.status === "ACTIVE" && !e.retiredAt),
    [employees],
  );

  const safetyManagers = useMemo(() => roster.filter((e) => e.safetyDrivingManager), [roster]);

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
    void apiFetch<{ dayChangeHour?: number }>("/settings/basics").then((r) => {
      if (!r.ok) return;
      const dch = typeof r.data.dayChangeHour === "number" ? r.data.dayChangeHour : 28;
      setDayChangeHour(dch);
      setTcDate(tokyoBusinessDate(dch));
    });
  }, [loadEmployees]);

  useEffect(() => {
    if (!me?.employeeId) return;
    if (!canPickEmployee) {
      setSelectedEmployeeId(me.employeeId);
      setTcEmployeeId(me.employeeId);
      setSalaryEmpId(me.employeeId);
    } else {
      setSelectedEmployeeId((v) => v || me.employeeId);
      setTcEmployeeId((v) => v || me.employeeId);
      setSalaryEmpId((v) => v || me.employeeId);
    }
  }, [me?.employeeId, canPickEmployee]);

  const loadTcList = useCallback(async () => {
    setTcListLoading(true);
    const r = await apiFetch<{ rows: TcMonthSummaryRow[] }>(
      `/attendance/timecard/month-summary?yearMonth=${encodeURIComponent(tcListYm)}`,
    );
    setTcListLoading(false);
    if (!r.ok) {
      setErr(r.error);
      setTcListRows([]);
      return;
    }
    setTcListRows(r.data.rows ?? []);
  }, [tcListYm]);

  useEffect(() => {
    if (tab === "timecard" || tab === "timecard-list") void loadTcList();
  }, [tab, tcListYm, loadTcList]);

  const loadSalaryData = useCallback(async () => {
    setSalaryLoading(true);
    const r = await apiFetch<{ rows: TcMonthSummaryRow[]; salaryPrefs?: SalaryPrefsClient }>(
      `/attendance/timecard/month-summary?yearMonth=${encodeURIComponent(salaryYm)}`,
    );
    setSalaryLoading(false);
    if (!r.ok) {
      setErr(r.error);
      setSalaryRows([]);
      setSalaryPrefs(null);
      return;
    }
    setSalaryRows(r.data.rows ?? []);
    setSalaryPrefs(r.data.salaryPrefs ?? null);
  }, [salaryYm]);

  useEffect(() => {
    if (tab === "salary") void loadSalaryData();
  }, [tab, salaryYm, loadSalaryData]);

  const loadMonthApp = useCallback(
    async (ym: string) => {
      if (!selectedEmployeeId) {
        setListDraft({});
        setConfirmedMap({});
        setMonthLoading(false);
        return;
      }
      setMonthLoading(true);
      setErr(null);
      try {
        const [r1, r2] = await Promise.all([
          apiFetch<{ days: Record<string, ShiftDaySlot> }>(
            `/attendance/shift-applications?employeeId=${encodeURIComponent(selectedEmployeeId)}&yearMonth=${encodeURIComponent(ym)}`,
          ),
          apiFetch<{
            rows: Array<{ businessDate: string; startTime: string; endTime: string; duties: string[] }>;
          }>(
            `/attendance/confirmed-shifts?employeeId=${encodeURIComponent(selectedEmployeeId)}&yearMonth=${encodeURIComponent(ym)}`,
          ),
        ]);
        if (!r1.ok) {
          setErr(r1.error);
          return;
        }
        if (!r2.ok) {
          setErr(r2.error);
          return;
        }
        setListDraft({ ...(r1.data.days ?? {}) });
        const cmap: Record<string, ConfirmedDayInfo> = {};
        for (const row of r2.data.rows ?? []) {
          cmap[row.businessDate] = {
            startTime: row.startTime,
            endTime: row.endTime,
            duties: row.duties ?? [],
          };
        }
        setConfirmedMap(cmap);
      } finally {
        setMonthLoading(false);
      }
    },
    [selectedEmployeeId],
  );

  const loadAdjustIndicators = useCallback(async (ym: string) => {
    setAdjustIndLoading(true);
    setErr(null);
    const r = await apiFetch<{ applicationDates: string[]; confirmedDates: string[] }>(
      `/attendance/shift-adjust/month-indicators?yearMonth=${encodeURIComponent(ym)}`,
    );
    setAdjustIndLoading(false);
    if (!r.ok) {
      setErr(r.error);
      setAdjustAppDates([]);
      setAdjustConfDates([]);
      return;
    }
    setAdjustAppDates(r.data.applicationDates ?? []);
    setAdjustConfDates(r.data.confirmedDates ?? []);
  }, []);

  useEffect(() => {
    if (tab === "shift" && selectedEmployeeId) void loadMonthApp(monthAppYm);
  }, [tab, selectedEmployeeId, monthAppYm, loadMonthApp]);

  useEffect(() => {
    if (tab === "adjust") void loadAdjustIndicators(monthAppYm);
  }, [tab, monthAppYm, loadAdjustIndicators]);

  const bumpShiftMonth = (delta: number): void => {
    if (!selectedEmployeeId) return;
    setMonthAppYm((prev) => shiftYearMonth(prev, delta));
  };

  const bumpAdjustMonth = (delta: number): void => {
    setMonthAppYm((prev) => shiftYearMonth(prev, delta));
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

  const confirmedListRows = useMemo(() => {
    const prefix = `${monthAppYm}-`;
    return Object.entries(confirmedMap)
      .filter(([d]) => d.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [confirmedMap, monthAppYm]);

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
    const normalizedDraft = Object.fromEntries(
      Object.entries(listDraft).map(([k, v]) => [k, normalizeShiftDaySlot(v)]),
    );
    setListDraft(normalizedDraft);
    const msg = validateDaysForSave(normalizedDraft);
    if (msg) {
      setErr(msg);
      return;
    }
    const out: Record<string, ShiftDaySlot> = {};
    for (const [date, slot] of Object.entries(normalizedDraft)) {
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

  const adjustAppSet = useMemo(() => new Set(adjustAppDates), [adjustAppDates]);
  const adjustConfSet = useMemo(() => new Set(adjustConfDates), [adjustConfDates]);

  async function openAdjustDayDialog(date: string, opts?: { quiet?: boolean }): Promise<void> {
    const quiet = Boolean(opts?.quiet);
    if (!quiet) setAdjustBusy(true);
    setErr(null);
    const r = await apiFetch<{
      rows: Array<{
        employeeId: string;
        familyName: string;
        givenName: string;
        application: { start: string; end: string } | null;
        confirmed: { startTime: string; endTime: string; duties: string[] } | null;
      }>;
    }>(`/attendance/shift-adjust/day?date=${encodeURIComponent(date)}`);
    if (!quiet) setAdjustBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setAdjustUiRows(
      (r.data.rows ?? []).map((row) => ({
        employeeId: row.employeeId,
        familyName: row.familyName,
        givenName: row.givenName,
        applyStart: row.application?.start ?? "",
        applyEnd: row.application?.end ?? "",
        confStart: row.confirmed?.startTime ?? row.application?.start ?? "",
        confEnd: row.confirmed?.endTime ?? row.application?.end ?? "",
        duties: row.confirmed?.duties?.length ? [...row.confirmed.duties] : [],
      })),
    );
    setAdjustDialogDate(date);
  }

  function patchAdjustUiRow(employeeId: string, patch: Partial<AdjustUiRow>): void {
    setAdjustUiRows((rows) => rows.map((x) => (x.employeeId === employeeId ? { ...x, ...patch } : x)));
  }

  function toggleAdjustRowDuty(employeeId: string, duty: string): void {
    setAdjustUiRows((rows) =>
      rows.map((x) => {
        if (x.employeeId !== employeeId) return x;
        const has = x.duties.includes(duty);
        return { ...x, duties: has ? x.duties.filter((d) => d !== duty) : [...x.duties, duty] };
      }),
    );
  }

  async function saveAdjustApplicationRow(employeeId: string): Promise<void> {
    if (!adjustDialogDate) return;
    const row = adjustUiRows.find((x) => x.employeeId === employeeId);
    if (!row) return;
    const { start, end } = normalizeShiftDaySlot({ start: row.applyStart, end: row.applyEnd });
    patchAdjustUiRow(employeeId, { applyStart: start, applyEnd: end });
    const msg = validateOneDaySlot(adjustDialogDate, start, end);
    if (msg) {
      setErr(msg);
      return;
    }
    setAdjustRowBusy(employeeId);
    setErr(null);
    const r = await apiFetch("/attendance/shift-applications/day", {
      method: "PUT",
      json: {
        employeeId,
        businessDate: adjustDialogDate,
        start: start.trim(),
        end: end.trim(),
      },
    });
    setAdjustRowBusy(null);
    if (!r.ok) setErr(r.error);
    else {
      flashSaved();
      void loadAdjustIndicators(monthAppYm);
      if (adjustDialogDate) void openAdjustDayDialog(adjustDialogDate, { quiet: true });
    }
  }

  async function saveAdjustConfirmedRow(employeeId: string): Promise<void> {
    if (!adjustDialogDate) return;
    const row = adjustUiRows.find((x) => x.employeeId === employeeId);
    if (!row) return;
    const { start: confStart, end: confEnd } = normalizeShiftDaySlot({
      start: row.confStart,
      end: row.confEnd,
    });
    patchAdjustUiRow(employeeId, { confStart, confEnd });
    const msg = validateOneDaySlot(adjustDialogDate, confStart, confEnd);
    if (msg) {
      setErr(msg);
      return;
    }
    setAdjustRowBusy(employeeId);
    setErr(null);
    const r = await apiFetch("/attendance/confirmed-shifts", {
      method: "PUT",
      json: {
        employeeId,
        businessDate: adjustDialogDate,
        startTime: confStart.trim(),
        endTime: confEnd.trim(),
        duties: row.duties,
      },
    });
    setAdjustRowBusy(null);
    if (!r.ok) setErr(r.error);
    else {
      flashSaved();
      void loadAdjustIndicators(monthAppYm);
      if (adjustDialogDate) void openAdjustDayDialog(adjustDialogDate, { quiet: true });
    }
  }

  const adjustCalCells = useMemo(() => monthCalendarCells(monthAppYm), [monthAppYm]);

  const loadTcPunches = useCallback(async () => {
    if (!tcEmployeeId || !tcDate) return;
    setTcLoading(true);
    const r = await apiFetch<{
      punches: Array<{ id: string; kind: string; punchedAt: string; alcoholCheck?: unknown }>;
    }>(`/attendance/timecard/punches?employeeId=${encodeURIComponent(tcEmployeeId)}&businessDate=${encodeURIComponent(tcDate)}`);
    setTcLoading(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setTcPunches(r.data.punches ?? []);
  }, [tcEmployeeId, tcDate]);

  useEffect(() => {
    if (tab === "timecard" && tcEmployeeId) void loadTcPunches();
  }, [tab, tcEmployeeId, tcDate, loadTcPunches]);

  const tcPunchesSorted = useMemo(
    () => [...tcPunches].sort((a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime()),
    [tcPunches],
  );
  const tcPunchBtn = useMemo(() => timecardButtonAvailability(tcPunchesSorted), [tcPunchesSorted]);

  useEffect(() => {
    const d = tcBreathList.find((x) => x.id === alcBreathId);
    if (d?.verificationMethods?.length) {
      setAlcMethod((m) => (d.verificationMethods.includes(m) ? m : d.verificationMethods[0]));
    }
  }, [alcBreathId, tcBreathList]);

  async function postTimecardPunch(kind: string, alcoholCheck?: Record<string, unknown> | null): Promise<boolean> {
    if (!tcEmployeeId || !tcDate) return false;
    setTcLoading(true);
    setErr(null);
    const body: Record<string, unknown> = { employeeId: tcEmployeeId, businessDate: tcDate, kind };
    if ((kind === "CLOCK_IN" || kind === "CLOCK_OUT") && alcoholCheck) body.alcoholCheck = alcoholCheck;
    const r = await apiFetch("/attendance/timecard/punch", {
      method: "POST",
      json: body,
    });
    setTcLoading(false);
    if (!r.ok) {
      setErr(r.error);
      return false;
    }
    flashSaved();
    void loadTcPunches();
    void loadTcList();
    return true;
  }

  async function openAlcoholDialog(phase: "CLOCK_IN" | "CLOCK_OUT"): Promise<void> {
    if (!tcEmployeeId || !tcDate) return;
    setErr(null);
    setTcAlcoholErr(null);
    const r = await apiFetch<{ breathalyzers?: BreathalyzerEntry[] }>("/settings/basics");
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    const raw = r.data.breathalyzers;
    const list = Array.isArray(raw) ? raw.filter((b) => b && typeof b.id === "string" && typeof b.name === "string") : [];
    setTcBreathList(list);
    const first = list[0];
    setAlcBreathId(first?.id ?? "");
    setAlcVerifierId("");
    setAlcMethod(first?.verificationMethods?.[0] ?? "");
    setAlcDetected(false);
    setAlcNote("");
    setTcAlcoholPhase(phase);
    setTcAlcoholOpen(true);
  }

  async function submitAlcohol(): Promise<void> {
    setTcAlcoholErr(null);
    const hasBreathalyzers = tcBreathList.length > 0;
    if (hasBreathalyzers && (!alcBreathId || !alcMethod)) {
      setTcAlcoholErr("アルコール探知機・確認方法を選んでください。");
      return;
    }
    if (!alcVerifierId && safetyManagers.length > 0) {
      setTcAlcoholErr("確認者（安全運転管理者）を選んでください。");
      return;
    }
    if (hasBreathalyzers) {
      const dev = tcBreathList.find((x) => x.id === alcBreathId);
      if (!dev || !dev.verificationMethods.includes(alcMethod)) {
        setTcAlcoholErr("確認方法が不正です。");
        return;
      }
    }
    const alcoholCheck: Record<string, unknown> = {
      alcoholDetected: alcDetected,
      instructionsNote: alcNote.trim() || null,
    };
    if (alcVerifierId) alcoholCheck.verifierEmployeeId = alcVerifierId;
    if (alcBreathId) alcoholCheck.breathalyzerId = alcBreathId;
    if (alcMethod) alcoholCheck.verificationMethod = alcMethod;

    const ok = await postTimecardPunch(tcAlcoholPhase, alcoholCheck);
    if (ok) setTcAlcoholOpen(false);
  }

  async function deleteTimecardPunch(punchId: string): Promise<void> {
    if (!tcEmployeeId) return;
    setTcLoading(true);
    setErr(null);
    const r = await apiFetch(`/attendance/timecard/punches/${encodeURIComponent(punchId)}`, { method: "DELETE" });
    setTcLoading(false);
    if (!r.ok) setErr(r.error);
    else {
      flashSaved();
      void loadTcPunches();
      void loadTcList();
    }
  }

  function openTcEditRow(row: TcMonthSummaryRow): void {
    const fields: TcEditField[] = [];
    const add = (label: string, slot: TcMonthSummarySlot | null) => {
      if (!slot) return;
      fields.push({
        punchId: slot.id,
        label,
        local: toDatetimeLocalValue(slot.punchedAt),
        originalIso: slot.punchedAt,
      });
    };
    add("出勤", row.clockIn);
    add("休憩入", row.breakStart);
    add("休憩終", row.breakEnd);
    add("退勤", row.clockOut);
    if (fields.length === 0) return;
    setTcEdit({
      employeeId: row.employeeId,
      businessDate: row.businessDate,
      displayName: `${row.familyName} ${row.givenName}`.trim(),
      fields,
    });
  }

  async function saveTcEditForm(): Promise<void> {
    if (!tcEdit) return;
    setTcEditBusy(true);
    setErr(null);
    try {
      for (const f of tcEdit.fields) {
        const newMs = new Date(f.local).getTime();
        if (Number.isNaN(newMs)) {
          setErr("日時の形式が不正です");
          return;
        }
        const origMs = new Date(f.originalIso).getTime();
        if (newMs === origMs) continue;
        const r = await apiFetch(`/attendance/timecard/punches/${encodeURIComponent(f.punchId)}`, {
          method: "PATCH",
          json: { punchedAt: new Date(f.local).toISOString() },
        });
        if (!r.ok) {
          setErr(r.error);
          return;
        }
      }
      flashSaved();
      setTcEdit(null);
      void loadTcList();
      void loadTcPunches();
    } finally {
      setTcEditBusy(false);
    }
  }

  async function deleteTcSummaryDay(row: TcMonthSummaryRow): Promise<void> {
    const ids = [row.clockIn?.id, row.breakStart?.id, row.breakEnd?.id, row.clockOut?.id].filter((x): x is string =>
      Boolean(x),
    );
    if (ids.length === 0) return;
    if (!window.confirm(`${row.businessDate}（${row.familyName} ${row.givenName}）の打刻をすべて削除しますか？`)) return;
    setTcLoading(true);
    setErr(null);
    for (const id of ids) {
      const r = await apiFetch(`/attendance/timecard/punches/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!r.ok) {
        setErr(r.error);
        setTcLoading(false);
        return;
      }
    }
    setTcLoading(false);
    flashSaved();
    void loadTcList();
    void loadTcPunches();
  }

  const shiftPanel = (
    <div className="settings-form attend-shift-root">
      {staffOnly && !me?.employeeId ? (
        <p className="settings-hint">このアカウントは従業員に紐づいていないため、シフト申請を利用できません。</p>
      ) : (
        <>
          <label>氏名（名簿）</label>
          {canPickEmployee ? (
            <select value={selectedEmployeeId} onChange={(e) => setSelectedEmployeeId(e.target.value)}>
              <option value="">選択してください</option>
              {roster.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.familyName} {e.givenName}
                </option>
              ))}
            </select>
          ) : (
            <p style={{ margin: "0.25rem 0 0.5rem", fontWeight: 600, fontSize: "0.95rem" }}>
              {me?.employeeDisplayName ?? "—"}
            </p>
          )}

          <div className="settings-toolbar" style={{ marginTop: "0.75rem" }}>
            <button type="button" className="settings-primary" disabled={!selectedEmployeeId} onClick={() => setDialogOpen(true)}>
              シフト申請
            </button>
          </div>
          <p className="settings-hint">
            「シフト申請」から1週間分（月曜〜日曜）の勤務時間をまとめて入力できます。スマホでも週ごとに申請しやすい画面です。
          </p>

          <div className="attend-shift-section-head">
            <h3 className="attend-shift-section-title attend-shift-section-title--inline">今月のシフト（確定）</h3>
            <button type="button" className="settings-secondary" onClick={() => setAllDialogOpen(true)}>
              全員
            </button>
          </div>
          {!selectedEmployeeId ? (
            <p className="settings-hint">従業員を選ぶと、確定済みのシフトが表示されます。</p>
          ) : confirmedListRows.length === 0 ? (
            <p className="settings-hint">この月の確定シフトはまだありません。「シフト調整」タブで登録できます。</p>
          ) : (
            <ul className="settings-sf-list">
              {confirmedListRows.map(([date, c]) => (
                <li key={date} className="settings-sf-row attend-shift-list-row">
                  <span className="settings-sf-name">{date}</span>
                  <span className="settings-sf-meta">
                    {c.startTime} ～ {c.endTime}
                    {c.duties.length ? `（${c.duties.join("・")}）` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h3 className="attend-shift-section-title">申請一覧</h3>
          {!selectedEmployeeId ? (
            <p className="settings-hint">従業員を選ぶと、保存済みの申請を表示・編集できます。</p>
          ) : (
            <>
              <div className="attend-shift-month-nav">
                <button
                  type="button"
                  className="settings-secondary"
                  disabled={listBusy || monthLoading}
                  onClick={() => bumpShiftMonth(-1)}
                >
                  前の月
                </button>
                <strong>{monthAppYm}</strong>
                <button
                  type="button"
                  className="settings-secondary"
                  disabled={listBusy || monthLoading}
                  onClick={() => bumpShiftMonth(1)}
                >
                  次の月
                </button>
              </div>
              {listRows.length === 0 ? (
                <p className="settings-hint">
                  この月の申請データはまだありません。上の「シフト申請」から今週分を入力してください。
                </p>
              ) : (
                <ul className="settings-sf-list">
                  {listRows.map(([date, t]) => (
                    <li key={date} className="settings-sf-row attend-shift-list-row">
                      <span className="settings-sf-name">{date}</span>
                      <FlexTimeInput
                        aria-label={`${date} 開始`}
                        value={t.start}
                        onChange={(start) => updateListDraft(date, { start })}
                      />
                      <span className="settings-sf-meta">～</span>
                      <FlexTimeInput
                        aria-label={`${date} 終了`}
                        value={t.end}
                        onChange={(end) => updateListDraft(date, { end })}
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

  const adjustPanel = (
    <div className="settings-form attend-shift-root">
      {staffOnly && !me?.employeeId ? (
        <p className="settings-hint">このアカウントは従業員に紐づいていないため、シフト調整を利用できません。</p>
      ) : (
        <>
          <p className="settings-hint">
            氏名の選択は不要です。日付をタップすると、その日のシフト申請一覧が表示されます。各行で申請の修正・保存と、確定シフトの保存ができます。
          </p>

          <div className="attend-shift-month-nav">
            <button
              type="button"
              className="settings-secondary"
              disabled={adjustIndLoading || adjustBusy}
              onClick={() => bumpAdjustMonth(-1)}
            >
              前の月
            </button>
            <strong>{monthAppYm}</strong>
            <button
              type="button"
              className="settings-secondary"
              disabled={adjustIndLoading || adjustBusy}
              onClick={() => bumpAdjustMonth(1)}
            >
              次の月
            </button>
          </div>
          {adjustIndLoading ? <p className="settings-hint">読み込み中…</p> : null}
          <div className="attend-cal">
            <div className="attend-cal-weekdays">
              {WEEK_LABELS.map((w) => (
                <span key={w} className="attend-cal-wd">
                  {w}
                </span>
              ))}
            </div>
            <div className="attend-cal-grid">
              {adjustCalCells.map((c) => {
                const hasApp = Boolean(c.date && adjustAppSet.has(c.date));
                const hasConf = Boolean(c.date && adjustConfSet.has(c.date));
                const isActive = Boolean(c.date && adjustDialogDate === c.date);
                return (
                  <button
                    key={c.key}
                    type="button"
                    className={`attend-cal-cell${!c.date ? " attend-cal-cell--empty" : ""}${isActive ? " attend-cal-cell--active" : ""}${hasApp ? " attend-cal-cell--has" : ""}${hasConf ? " attend-cal-cell--confirmed" : ""}`}
                    disabled={!c.date || adjustBusy}
                    onClick={() => {
                      if (c.date) void openAdjustDayDialog(c.date);
                    }}
                  >
                    {c.dayNum != null ? c.dayNum : ""}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );

  const timeCardPanel = (
    <div className="settings-form attend-shift-root attend-tc-page">
      {staffOnly && !me?.employeeId ? (
        <p className="settings-hint">このアカウントは従業員に紐づいていないため、タイムカードを利用できません。</p>
      ) : (
        <div className="attend-tc-col attend-tc-col--form">
            <label>氏名（名簿）</label>
            {canPickEmployee ? (
              <select value={tcEmployeeId} onChange={(e) => setTcEmployeeId(e.target.value)}>
                <option value="">選択してください</option>
                {roster.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.familyName} {e.givenName}
                  </option>
                ))}
              </select>
            ) : (
              <p style={{ margin: "0.25rem 0 0.5rem", fontWeight: 600, fontSize: "0.95rem" }}>
                {me?.employeeDisplayName ?? "—"}
              </p>
            )}

            <label htmlFor="tc-date">日付（事業日）</label>
            <input id="tc-date" type="date" value={tcDate} onChange={(e) => setTcDate(e.target.value)} />

            {tcEmployeeId ? (
              <p className="settings-hint" style={{ marginTop: 0 }}>
                打刻は「出勤 →（休憩入 → 休憩終）→ 退勤」の順のみです。休憩を挟まない場合は出勤のあとすぐ退勤できます。同日の出勤は1回までです。
              </p>
            ) : null}

            <div className="settings-toolbar attend-tc-buttons">
              <button
                type="button"
                className="settings-primary"
                disabled={!tcEmployeeId || tcLoading || !tcPunchBtn.clockIn}
                onClick={() => void openAlcoholDialog("CLOCK_IN")}
              >
                出勤
              </button>
              <button
                type="button"
                className="settings-primary"
                disabled={!tcEmployeeId || tcLoading || !tcPunchBtn.clockOut}
                onClick={() => void openAlcoholDialog("CLOCK_OUT")}
              >
                退勤
              </button>
              <button
                type="button"
                className="settings-secondary"
                disabled={!tcEmployeeId || tcLoading || !tcPunchBtn.breakStart}
                onClick={() => void postTimecardPunch("BREAK_START")}
              >
                休憩入
              </button>
              <button
                type="button"
                className="settings-secondary"
                disabled={!tcEmployeeId || tcLoading || !tcPunchBtn.breakEnd}
                onClick={() => void postTimecardPunch("BREAK_END")}
              >
                休憩終
              </button>
            </div>

            <h3 className="attend-shift-section-title">打刻一覧（当日）</h3>
            {!tcEmployeeId ? (
              <p className="settings-hint">従業員を選ぶと打刻一覧が表示されます。</p>
            ) : tcLoading ? (
              <p className="settings-hint">読み込み中…</p>
            ) : tcPunches.length === 0 ? (
              <p className="settings-hint">この日の打刻はまだありません。</p>
            ) : (
              <ul className="settings-sf-list">
                {tcPunchesSorted.map((p) => (
                  <li key={p.id} className="settings-sf-row attend-shift-list-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
                    <div style={{ display: "flex", alignItems: "center", width: "100%", gap: "0.35rem" }}>
                      <span className="settings-sf-name">
                        {p.kind === "CLOCK_IN"
                          ? "出勤"
                          : p.kind === "CLOCK_OUT"
                            ? "退勤"
                            : p.kind === "BREAK_START"
                              ? "休憩入"
                              : p.kind === "BREAK_END"
                                ? "休憩終"
                                : p.kind}
                      </span>
                      <span className="settings-sf-meta">{new Date(p.punchedAt).toLocaleString("ja-JP")}</span>
                      <button
                        type="button"
                        className="settings-secondary"
                        style={{ marginLeft: "auto", flexShrink: 0 }}
                        disabled={tcLoading}
                        onClick={() => void deleteTimecardPunch(p.id)}
                      >
                        削除
                      </button>
                    </div>
                    {p.kind === "CLOCK_IN" && formatAlcoholBrief(p.alcoholCheck) ? (
                      <span className="settings-hint" style={{ marginTop: "0.15rem" }}>
                        アルコール: {formatAlcoholBrief(p.alcoholCheck)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}
    </div>
  );

  const timeCardListPanel = (
    <div className="settings-form attend-shift-root attend-tc-page">
      {staffOnly && !me?.employeeId ? (
        <p className="settings-hint">このアカウントは従業員に紐づいていないため、タイムカードを利用できません。</p>
      ) : (
        <>
          <div className="attend-shift-month-nav attend-tc-list-month">
            <button type="button" className="settings-secondary" disabled={tcListLoading} onClick={() => setTcListYm((p) => shiftYearMonth(p, -1))}>
              前の月
            </button>
            <strong>{tcListYm}</strong>
            <button type="button" className="settings-secondary" disabled={tcListLoading} onClick={() => setTcListYm((p) => shiftYearMonth(p, 1))}>
              次の月
            </button>
          </div>
          {tcListLoading ? (
            <p className="settings-hint">読み込み中…</p>
          ) : tcListRows.length === 0 ? (
            <p className="settings-hint">この月の打刻はまだありません。</p>
          ) : (
            <div className="attend-tc-summary-table-wrap">
              <table className="attend-tc-summary-table">
                <thead>
                  <tr>
                    <th>日付</th>
                    <th>氏名</th>
                    <th>出勤</th>
                    <th>休憩入</th>
                    <th>休憩終</th>
                    <th>退勤</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {tcListRows.map((row) => (
                    <tr key={`${row.employeeId}-${row.businessDate}`}>
                      <td>{row.businessDate}</td>
                      <td>
                        {row.familyName} {row.givenName}
                      </td>
                      <td>{row.clockIn?.hm ?? "—"}</td>
                      <td>{row.breakStart?.hm ?? "—"}</td>
                      <td>{row.breakEnd?.hm ?? "—"}</td>
                      <td>{row.clockOut?.hm ?? "—"}</td>
                      <td>
                        <div className="attend-tc-summary-actions">
                          <button
                            type="button"
                            className="settings-secondary"
                            disabled={tcLoading || tcListLoading}
                            onClick={() => openTcEditRow(row)}
                          >
                            修正
                          </button>
                          <button
                            type="button"
                            className="settings-secondary"
                            disabled={tcLoading || tcListLoading}
                            onClick={() => void deleteTcSummaryDay(row)}
                          >
                            全削除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );

  const salaryFilteredRows = useMemo(
    () => (salaryEmpId ? salaryRows.filter((r) => r.employeeId === salaryEmpId) : []),
    [salaryRows, salaryEmpId],
  );
  const salaryTotal = useMemo(
    () => salaryFilteredRows.reduce((s, r) => s + (r.wageYen ?? 0), 0),
    [salaryFilteredRows],
  );

  const salaryPrefsHint = useMemo(() => {
    if (!salaryPrefs) return null;
    const yenLab =
      salaryPrefs.yenRounding === "floor" ? "切り捨て" : salaryPrefs.yenRounding === "ceil" ? "切り上げ" : "四捨五入";
    if (salaryPrefs.minuteStep <= 1) {
      return `給料の円は「${yenLab}」で計算しています。`;
    }
    const timeLab =
      salaryPrefs.timeRounding === "floor"
        ? "切り捨て"
        : salaryPrefs.timeRounding === "ceil"
          ? "切り上げ"
          : "四捨五入";
    return `給料は勤務時間を${salaryPrefs.minuteStep}分刻み（${timeLab}）にそろえたうえで時給を掛け、円は「${yenLab}」しています。`;
  }, [salaryPrefs]);

  const salaryPanel = (
    <div className="settings-form attend-shift-root">
      <label>氏名</label>
      {canPickEmployee ? (
        <select value={salaryEmpId} onChange={(e) => setSalaryEmpId(e.target.value)}>
          <option value="">選択してください</option>
          {roster.map((e) => (
            <option key={e.id} value={e.id}>
              {e.familyName} {e.givenName}
            </option>
          ))}
        </select>
      ) : (
        <p style={{ margin: "0.25rem 0 0.5rem", fontWeight: 600, fontSize: "0.95rem" }}>
          {me?.employeeDisplayName ?? "—"}
        </p>
      )}

      <label style={{ marginTop: "0.75rem" }}>期間</label>
      <div className="attend-shift-month-nav" style={{ marginTop: 0 }}>
        <button
          type="button"
          className="settings-secondary"
          disabled={salaryLoading}
          onClick={() => setSalaryYm((p) => shiftYearMonth(p, -1))}
        >
          前の月
        </button>
        <input
          type="month"
          value={salaryYm}
          onChange={(e) => setSalaryYm(e.target.value || currentYearMonth())}
          style={{ textAlign: "center", minWidth: "9rem" }}
        />
        <button
          type="button"
          className="settings-secondary"
          disabled={salaryLoading}
          onClick={() => setSalaryYm((p) => shiftYearMonth(p, 1))}
        >
          次の月
        </button>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.4rem" }}>
        <button type="button" className="settings-secondary" onClick={() => setSalaryYm(currentYearMonth())}>
          今月
        </button>
        <button
          type="button"
          className="settings-secondary"
          onClick={() => setSalaryYm(shiftYearMonth(currentYearMonth(), -1))}
        >
          先月
        </button>
      </div>

      {salaryLoading ? (
        <p className="settings-hint" style={{ marginTop: "1rem" }}>
          読み込み中…
        </p>
      ) : !salaryEmpId ? (
        <p className="settings-hint" style={{ marginTop: "1rem" }}>
          従業員を選択してください。
        </p>
      ) : salaryFilteredRows.length === 0 ? (
        <p className="settings-hint" style={{ marginTop: "1rem" }}>
          この期間の打刻はありません。
        </p>
      ) : (
        <div className="settings-comp-table-wrap" style={{ marginTop: "1rem" }}>
          {salaryPrefsHint ? (
            <p className="settings-hint" style={{ marginTop: 0, marginBottom: "0.75rem" }}>
              {salaryPrefsHint}
            </p>
          ) : null}
          <table className="settings-comp-table salary-table">
            <thead>
              <tr>
                <th>日付</th>
                <th>勤務時間</th>
                <th>内訳</th>
                <th>給料</th>
              </tr>
            </thead>
            <tbody>
              {salaryFilteredRows.map((row) => {
                const workMin = computeWorkMinutes(row);
                const basisMin =
                  row.wageYen != null && row.wageBasisMinutes != null && Number.isFinite(row.wageBasisMinutes)
                    ? row.wageBasisMinutes
                    : workMin;
                return (
                  <tr key={row.businessDate}>
                    <td>{row.businessDate}</td>
                    <td>{formatWorkDuration(workMin)}</td>
                    <td className="salary-breakdown">
                      {row.clockIn?.hm && row.clockOut?.hm ? (
                        <span className="salary-breakdown-time">
                          {row.clockIn.hm}〜{row.clockOut.hm}
                          {row.breakStart?.hm && row.breakEnd?.hm
                            ? `（休憩 ${row.breakStart.hm}〜${row.breakEnd.hm}）`
                            : ""}
                        </span>
                      ) : null}
                      <span className="salary-breakdown-rate">
                        {row.roleLabel ? `${row.roleLabel}・` : ""}時給{row.baseHourlyYen.toLocaleString("ja-JP")}円
                        {basisMin != null
                          ? ` × ${formatBasisForRateLine(basisMin)}`
                          : ""}
                      </span>
                    </td>
                    <td className="salary-amount">
                      {row.wageYen != null ? `${row.wageYen.toLocaleString("ja-JP")}円` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="salary-total-row">
                <td colSpan={3}>合計</td>
                <td className="salary-amount">{salaryTotal.toLocaleString("ja-JP")}円</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );

  const tabItems: TabDef[] = [
    { id: "shift", label: "シフト", children: shiftPanel },
    { id: "adjust", label: "シフト調整", children: adjustPanel },
    { id: "timecard", label: "タイムカード", children: timeCardPanel },
    { id: "timecard-list", label: "タイムカード一覧", children: timeCardListPanel },
    { id: "salary", label: "給料", children: salaryPanel },
  ];

  const visTabs = me ? filterSubTabsForMe("attendance", tabItems, me) : tabItems;
  const visTabKey = visTabs.map((t) => t.id).join(",");

  useEffect(() => {
    if (!visTabs.some((t) => t.id === tab)) {
      setTab(visTabs[0]?.id ?? "shift");
    }
  }, [tab, visTabKey]);

  return (
    <>
      <Card title="勤怠">
        <Err msg={err} />
        <Tabs items={visTabs} activeId={tab} onActiveChange={setTab} aria-label="勤怠の種類" />
      </Card>

      {adjustDialogDate ? (
        <div
          className="pricing-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setAdjustDialogDate(null);
          }}
        >
          <div
            className="pricing-modal attend-shift-dialog attend-adjust-day-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="adjust-shift-day-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="adjust-shift-day-title" className="pricing-modal-title">
              シフト調整（{adjustDialogDate}）
            </h2>
            <div className="attend-shift-dialog-scroll">
              {adjustUiRows.length === 0 ? (
                <p className="settings-hint">この日の申請または確定シフトはまだありません。</p>
              ) : (
                <div className="attend-adjust-table-wrap">
                  <table className="attend-adjust-table">
                    <thead>
                      <tr>
                        <th>氏名</th>
                        <th>申請（開始）</th>
                        <th>申請（終了）</th>
                        <th>申請</th>
                        <th>確定（開始）</th>
                        <th>確定（終了）</th>
                        <th>担当</th>
                        <th>確定</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adjustUiRows.map((row) => (
                        <tr key={row.employeeId}>
                          <td>
                            {row.familyName} {row.givenName}
                          </td>
                          <td>
                            <FlexTimeInput
                              aria-label={`${row.familyName} 申請開始`}
                              value={row.applyStart}
                              onChange={(applyStart) => patchAdjustUiRow(row.employeeId, { applyStart })}
                            />
                          </td>
                          <td>
                            <FlexTimeInput
                              aria-label={`${row.familyName} 申請終了`}
                              value={row.applyEnd}
                              onChange={(applyEnd) => patchAdjustUiRow(row.employeeId, { applyEnd })}
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="settings-secondary"
                              disabled={adjustRowBusy === row.employeeId}
                              onClick={() => void saveAdjustApplicationRow(row.employeeId)}
                            >
                              保存
                            </button>
                          </td>
                          <td>
                            <FlexTimeInput
                              aria-label={`${row.familyName} 確定開始`}
                              value={row.confStart}
                              onChange={(confStart) => patchAdjustUiRow(row.employeeId, { confStart })}
                            />
                          </td>
                          <td>
                            <FlexTimeInput
                              aria-label={`${row.familyName} 確定終了`}
                              value={row.confEnd}
                              onChange={(confEnd) => patchAdjustUiRow(row.employeeId, { confEnd })}
                            />
                          </td>
                          <td>
                            <div className="settings-checkbox-row attend-adjust-duty-cell">
                              {SHIFT_DUTY_OPTIONS.map((d) => (
                                <label key={d} className="settings-inline-check">
                                  <input
                                    type="checkbox"
                                    checked={row.duties.includes(d)}
                                    onChange={() => toggleAdjustRowDuty(row.employeeId, d)}
                                  />
                                  {d}
                                </label>
                              ))}
                            </div>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="settings-primary"
                              disabled={adjustRowBusy === row.employeeId}
                              onClick={() => void saveAdjustConfirmedRow(row.employeeId)}
                            >
                              確定
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="settings-hint">申請の「保存」はシフト申請のみ更新します。「確定」は確定シフトに反映します（0:00〜48:59）。</p>
            </div>
            <div className="pricing-modal-actions">
              <button type="button" disabled={adjustBusy} onClick={() => setAdjustDialogDate(null)}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tcEdit ? (
        <div
          className="pricing-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setTcEdit(null);
          }}
        >
          <div
            className="pricing-modal attend-shift-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tc-edit-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="tc-edit-title" className="pricing-modal-title">
              打刻の修正（{tcEdit.businessDate}）
            </h2>
            <div className="attend-shift-dialog-scroll">
              <p className="settings-hint" style={{ marginTop: 0 }}>
                {tcEdit.displayName}
              </p>
              <div className="settings-form">
                {tcEdit.fields.map((f) => (
                  <div key={f.punchId}>
                    <label htmlFor={`tc-edit-${f.punchId}`}>{f.label}</label>
                    <input
                      id={`tc-edit-${f.punchId}`}
                      type="datetime-local"
                      value={f.local}
                      onChange={(e) =>
                        setTcEdit((prev) =>
                          prev
                            ? {
                                ...prev,
                                fields: prev.fields.map((x) =>
                                  x.punchId === f.punchId ? { ...x, local: e.target.value } : x,
                                ),
                              }
                            : prev,
                        )
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="pricing-modal-actions">
              <button type="button" className="settings-primary" disabled={tcEditBusy} onClick={() => void saveTcEditForm()}>
                保存
              </button>
              <button type="button" disabled={tcEditBusy} onClick={() => setTcEdit(null)}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tcAlcoholOpen ? (
        <div
          className="pricing-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setTcAlcoholOpen(false);
          }}
        >
          <div
            className="pricing-modal attend-shift-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tc-alc-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="tc-alc-title" className="pricing-modal-title">
              {tcAlcoholPhase === "CLOCK_IN" ? "出勤" : "退勤"}（アルコールチェック）
            </h2>
            <div className="attend-shift-dialog-scroll">
              <Err msg={tcAlcoholErr} />
              <div className="settings-form">
                <label htmlFor="tc-alc-bz">アルコール探知機</label>
                <select id="tc-alc-bz" value={alcBreathId} onChange={(e) => setAlcBreathId(e.target.value)}>
                  {tcBreathList.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <label htmlFor="tc-alc-ver">確認者（安全運転管理者）</label>
                <select id="tc-alc-ver" value={alcVerifierId} onChange={(e) => setAlcVerifierId(e.target.value)}>
                  <option value="">選択</option>
                  {safetyManagers.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.familyName} {e.givenName}
                    </option>
                  ))}
                </select>
                <label htmlFor="tc-alc-m">確認方法</label>
                <select id="tc-alc-m" value={alcMethod} onChange={(e) => setAlcMethod(e.target.value)}>
                  {(tcBreathList.find((x) => x.id === alcBreathId)?.verificationMethods ?? []).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <span className="settings-hint">酒気帯びの有無</span>
                <div className="settings-toolbar" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
                  <label className="settings-inline-check">
                    <input type="radio" name="alc-det" checked={!alcDetected} onChange={() => setAlcDetected(false)} /> なし
                  </label>
                  <label className="settings-inline-check">
                    <input type="radio" name="alc-det" checked={alcDetected} onChange={() => setAlcDetected(true)} /> あり
                  </label>
                </div>
                <label htmlFor="tc-alc-note">指示事項（任意）</label>
                <textarea id="tc-alc-note" value={alcNote} onChange={(e) => setAlcNote(e.target.value)} rows={2} maxLength={2000} />
              </div>
            </div>
            <div className="pricing-modal-actions">
              <button type="button" className="settings-primary" disabled={tcLoading} onClick={() => void submitAlcohol()}>
                {tcAlcoholPhase === "CLOCK_IN" ? "出勤" : "退勤"}を記録
              </button>
              <button type="button" disabled={tcLoading} onClick={() => setTcAlcoholOpen(false)}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <AllStaffShiftsDialog
        open={allDialogOpen}
        initialYm={monthAppYm}
        onClose={() => setAllDialogOpen(false)}
      />
    </>
  );
}

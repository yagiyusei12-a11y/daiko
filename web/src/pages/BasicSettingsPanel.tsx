import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import { useAuth } from "../auth";
import {
  STAFF_HEADER_NAV_META,
  STAFF_SUB_TAB_LABELS,
  buildStaffMenuVisibilityPut,
  staffVisDraftFromApi,
  type StaffVisDraft,
} from "../lib/staff-menu-client";
import { FlexTimeInput } from "../components/FlexTimeInput";
import { normalizeOpenCloseSlot } from "../lib/flex-time-input";
import { useSavedToast } from "../saved-toast";
import { Err } from "../ui";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;
const WEEK_LABELS_CAL = ["日", "月", "火", "水", "木", "金", "土"];

type BusinessHoursSlot = { id: string; open: string; close: string };

type RegularHolidayWeekly = { id: string; kind: "weekly"; weekdays: number[] };
type RegularHolidayNthWeekday = { id: string; kind: "nthWeekday"; nth: number; weekday: number };
type RegularHolidayMonthlyDay = { id: string; kind: "monthlyDay"; day: number };
type RegularHolidayEntry = RegularHolidayWeekly | RegularHolidayNthWeekday | RegularHolidayMonthlyDay;

type BreathalyzerEntry = {
  id: string;
  name: string;
  lastInspectionYmd: string | null;
  verificationMethods: string[];
};

const DEFAULT_BREATH_METHODS = ["対面", "電話"];

type BusinessBasicsV2 = {
  version: 2;
  businessHours: BusinessHoursSlot[];
  businessHoursByWeekday: Record<string, BusinessHoursSlot[]>;
  businessHoursByDate: Record<string, BusinessHoursSlot[]>;
  paymentMethods: string[];
  regularHolidays: RegularHolidayEntry[];
  temporaryClosureDates: string[];
  breathalyzers: BreathalyzerEntry[];
};

type BasicsApi = {
  version?: number;
  businessHours?: BusinessHoursSlot[];
  businessHoursByWeekday?: Record<string, BusinessHoursSlot[]>;
  businessHoursByDate?: Record<string, BusinessHoursSlot[]>;
  paymentMethods?: string[];
  regularHolidays?: RegularHolidayEntry[];
  temporaryClosureDates?: string[];
  breathalyzers?: BreathalyzerEntry[];
  dayChangeHour?: number;
  staffMenuVisibility?: {
    allowedHeaderNavIds: string[] | null;
    allowedSubTabIdsByNav: Partial<Record<string, string[]>>;
  } | null;
};

function newId(prefix: string): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${prefix}_${Date.now()}`;
}

function tokyoTodayYmd(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date()).slice(0, 10);
}

function fromApiBasics(a: BasicsApi): BusinessBasicsV2 {
  const breath = Array.isArray(a.breathalyzers)
    ? (a.breathalyzers as BreathalyzerEntry[]).filter((x) => x && typeof x.name === "string" && x.name.trim())
    : [];
  if (a.version === 2) {
    return {
      version: 2,
      businessHours: a.businessHours ?? [],
      businessHoursByWeekday: { ...(a.businessHoursByWeekday ?? {}) },
      businessHoursByDate: { ...(a.businessHoursByDate ?? {}) },
      paymentMethods: [...(a.paymentMethods ?? [])],
      regularHolidays: a.regularHolidays ?? [],
      temporaryClosureDates: a.temporaryClosureDates ?? [],
      breathalyzers: breath.map((b) => ({
        ...b,
        verificationMethods:
          Array.isArray(b.verificationMethods) && b.verificationMethods.length > 0
            ? [...new Set(b.verificationMethods.map((m) => String(m).trim()).filter(Boolean))]
            : [...DEFAULT_BREATH_METHODS],
      })),
    };
  }
  return {
    version: 2,
    businessHours: a.businessHours ?? [],
    businessHoursByWeekday: {},
    businessHoursByDate: {},
    paymentMethods: [],
    regularHolidays: a.regularHolidays ?? [],
    temporaryClosureDates: a.temporaryClosureDates ?? [],
    breathalyzers: breath.map((b) => ({
      ...b,
      verificationMethods:
        Array.isArray(b.verificationMethods) && b.verificationMethods.length > 0
          ? [...new Set(b.verificationMethods.map((m) => String(m).trim()).filter(Boolean))]
          : [...DEFAULT_BREATH_METHODS],
    })),
  };
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

function normalizeHoursSlotList(slots: BusinessHoursSlot[]): BusinessHoursSlot[] {
  return slots.map((s) => ({ ...s, ...normalizeOpenCloseSlot(s) }));
}

function normalizeHoursMap(m: Record<string, BusinessHoursSlot[]>): Record<string, BusinessHoursSlot[]> {
  const out: Record<string, BusinessHoursSlot[]> = {};
  for (const [k, v] of Object.entries(m)) {
    out[k] = normalizeHoursSlotList(v);
  }
  return out;
}

function HoursSlotList({
  slots,
  onChange,
  emptyHint,
}: {
  slots: BusinessHoursSlot[];
  onChange: (next: BusinessHoursSlot[]) => void;
  emptyHint: string;
}): JSX.Element {
  return (
    <>
      {slots.length === 0 ? (
        <p className="settings-hint">{emptyHint}</p>
      ) : (
        <ul className="settings-sf-list">
          {slots.map((row, idx) => (
            <li key={row.id} className="settings-sf-row settings-basic-hours-row">
              <span className="settings-sf-name">枠 {idx + 1}</span>
              <FlexTimeInput
                aria-label={`枠${idx + 1} 開始`}
                value={row.open}
                onChange={(open) =>
                  onChange(slots.map((x) => (x.id === row.id ? { ...x, open } : x)))
                }
              />
              <span className="settings-sf-meta">～</span>
              <FlexTimeInput
                aria-label={`枠${idx + 1} 終了`}
                value={row.close}
                onChange={(close) =>
                  onChange(slots.map((x) => (x.id === row.id ? { ...x, close } : x)))
                }
              />
              <button type="button" className="settings-secondary" onClick={() => onChange(slots.filter((x) => x.id !== row.id))}>
                削除
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="settings-secondary"
        onClick={() => onChange([...slots, { id: newId("bh"), open: "9:00", close: "18:00" }])}
      >
        営業時間を追加
      </button>
    </>
  );
}

type Props = {
  setErr: (msg: string | null) => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
};

export default function BasicSettingsPanel({ setErr, busy, setBusy }: Props): JSX.Element {
  const { refreshMe } = useAuth();
  const { flashSaved } = useSavedToast();
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<BusinessBasicsV2 | null>(null);
  const [dayChangeHour, setDayChangeHour] = useState(28);
  const [hoursSubTab, setHoursSubTab] = useState<"default" | "weekday" | "special">("default");
  const [hoursWeekday, setHoursWeekday] = useState(1);
  const [specialDateDialogOpen, setSpecialDateDialogOpen] = useState(false);
  const [newSpecialDate, setNewSpecialDate] = useState("");
  const [paymentInput, setPaymentInput] = useState("");

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
  const [bzMethodDraft, setBzMethodDraft] = useState<Record<string, string>>({});
  const [staffVis, setStaffVis] = useState<StaffVisDraft>(() => staffVisDraftFromApi(null));

  const load = useCallback(async () => {
    setLocalErr(null);
    const r = await apiFetch<BasicsApi>("/settings/basics");
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setDraft(fromApiBasics(r.data));
    setDayChangeHour(typeof r.data.dayChangeHour === "number" ? r.data.dayChangeHour : 28);
    setStaffVis(staffVisDraftFromApi(r.data.staffMenuVisibility ?? null));
  }, [setErr]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveAll(): Promise<void> {
    if (!draft) return;
    for (const br of draft.breathalyzers) {
      if (!br.name.trim()) {
        setLocalErr("アルコール探知機の名称が空の行があります。削除するか名称を入力してください。");
        return;
      }
    }
    const navOnCount = STAFF_HEADER_NAV_META.filter((m) => staffVis.nav[m.id]).length;
    if (navOnCount === 0) {
      setLocalErr("管理者以外向けに表示するヘッダーを1つ以上選んでください。");
      return;
    }
    for (const [navId, defs] of Object.entries(STAFF_SUB_TAB_LABELS)) {
      if (!staffVis.nav[navId]) continue;
      const row = staffVis.tabs[navId];
      const nOn = defs.filter((d) => row[d.id]).length;
      if (nOn === 0) {
        const label = STAFF_HEADER_NAV_META.find((x) => x.id === navId)?.label ?? navId;
        setLocalErr(`「${label}」内のタブを1つ以上選んでください。`);
        return;
      }
    }
    const smPut = buildStaffMenuVisibilityPut(staffVis);
    setBusy(true);
    setErr(null);
    setLocalErr(null);
    const dch = Math.round(dayChangeHour);
    if (dch < 24 || dch > 30) {
      setLocalErr("日付変更時間は 24〜30 の範囲で入力してください（例: 28 = 28:00）。");
      return;
    }
    const businessHours = normalizeHoursSlotList(draft.businessHours);
    const businessHoursByWeekday = normalizeHoursMap(draft.businessHoursByWeekday);
    const businessHoursByDate = normalizeHoursMap(draft.businessHoursByDate);
    setDraft({ ...draft, businessHours, businessHoursByWeekday, businessHoursByDate });
    const r = await apiFetch("/settings/basics", {
      method: "PUT",
      json: {
        businessHours,
        businessHoursByWeekday,
        businessHoursByDate,
        paymentMethods: draft.paymentMethods,
        regularHolidays: draft.regularHolidays,
        temporaryClosureDates: draft.temporaryClosureDates,
        breathalyzers: draft.breathalyzers,
        dayChangeHour: dch,
        staffMenuVisibility: {
          allowedHeaderNavIds: smPut.allowedHeaderNavIds,
          allowedSubTabIdsByNav: smPut.allowedSubTabIdsByNav,
        },
      },
    });
    setBusy(false);
    if (!r.ok) setErr(r.error);
    else {
      flashSaved();
      void load();
      void refreshMe();
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

  const specialDateKeys = useMemo(() => {
    if (!draft) return [];
    return Object.keys(draft.businessHoursByDate).sort((a, b) => a.localeCompare(b));
  }, [draft]);

  const weekdaySlots = draft ? draft.businessHoursByWeekday[String(hoursWeekday)] ?? [] : [];

  function setWeekdaySlots(next: BusinessHoursSlot[]): void {
    if (!draft) return;
    const key = String(hoursWeekday);
    const m = { ...draft.businessHoursByWeekday };
    if (next.length === 0) delete m[key];
    else m[key] = next;
    setDraft({ ...draft, businessHoursByWeekday: m });
  }

  function setDateSlots(date: string, next: BusinessHoursSlot[]): void {
    if (!draft) return;
    const m = { ...draft.businessHoursByDate };
    if (next.length === 0) delete m[date];
    else m[date] = next;
    setDraft({ ...draft, businessHoursByDate: m });
  }

  function confirmAddSpecialDate(): void {
    if (!draft) return;
    const d = newSpecialDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      setLocalErr("日付は yyyy-MM-dd で選んでください。");
      return;
    }
    if (draft.businessHoursByDate[d]) {
      setLocalErr("その日はすでに登録されています。");
      return;
    }
    setLocalErr(null);
    setDraft({
      ...draft,
      businessHoursByDate: {
        ...draft.businessHoursByDate,
        [d]: draft.businessHours.map((x) => ({ ...x, id: newId("bh") })),
      },
    });
    setSpecialDateDialogOpen(false);
    setNewSpecialDate("");
  }

  function addPaymentMethod(): void {
    if (!draft) return;
    const t = paymentInput.trim();
    if (!t || t.length > 80) return;
    if (draft.paymentMethods.includes(t)) {
      setPaymentInput("");
      return;
    }
    setDraft({ ...draft, paymentMethods: [...draft.paymentMethods, t] });
    setPaymentInput("");
  }

  if (!draft) {
    return <p className="settings-hint">読み込み中…</p>;
  }

  return (
    <div className="settings-form settings-basic-root">
      <Err msg={localErr} />
      <p className="settings-hint">
        営業時間は翌未明まで「26:00」のように入力できます。基本は全曜日共通です。曜日別・特定日で上書きすると、その優先順位で勤怠スケジュールの軸に使われます（特定日 → 曜日 → 基本）。
      </p>

      <div className="settings-section-panel">
        <h3 className="settings-subtitle">営業時間</h3>
        <div className="settings-toolbar" style={{ flexWrap: "wrap", gap: "0.35rem" }}>
        <button
          type="button"
          className={hoursSubTab === "default" ? "settings-primary" : "settings-secondary"}
          onClick={() => setHoursSubTab("default")}
        >
          基本
        </button>
        <button
          type="button"
          className={hoursSubTab === "weekday" ? "settings-primary" : "settings-secondary"}
          onClick={() => setHoursSubTab("weekday")}
        >
          曜日別
        </button>
        <button
          type="button"
          className={hoursSubTab === "special" ? "settings-primary" : "settings-secondary"}
          onClick={() => setHoursSubTab("special")}
        >
          特定日
        </button>
      </div>

      {hoursSubTab === "default" ? (
        <HoursSlotList
          slots={draft.businessHours}
          onChange={(next) => setDraft({ ...draft, businessHours: next })}
          emptyHint="まだ登録がありません。下のボタンで追加してください。"
        />
      ) : null}

      {hoursSubTab === "weekday" ? (
        <div style={{ marginTop: "0.75rem" }}>
          <p className="settings-hint">上書きしたい曜日を選びます。枠を空にするとその曜日は「基本」に従います。</p>
          <div className="settings-toolbar" style={{ flexWrap: "wrap", gap: "0.35rem" }}>
            {WEEKDAY_LABELS.map((label, d) => (
              <button
                key={label}
                type="button"
                className={hoursWeekday === d ? "settings-primary" : "settings-secondary"}
                onClick={() => setHoursWeekday(d)}
              >
                {label}
              </button>
            ))}
          </div>
          <HoursSlotList
            slots={weekdaySlots}
            onChange={setWeekdaySlots}
            emptyHint={`${WEEKDAY_LABELS[hoursWeekday]}曜は未設定（基本の営業時間に従います）。`}
          />
        </div>
      ) : null}

      {hoursSubTab === "special" ? (
        <div style={{ marginTop: "0.75rem" }}>
          <p className="settings-hint">祝日など、特定の日だけ営業時間を変える場合に使います。日付ごとに枠を設定します。</p>
          <button type="button" className="settings-secondary" onClick={() => setSpecialDateDialogOpen(true)}>
            日付を追加
          </button>
          {specialDateKeys.length === 0 ? (
            <p className="settings-hint">まだ特定日の上書きはありません。</p>
          ) : (
            specialDateKeys.map((date) => (
              <div key={date} style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid var(--color-border)" }}>
                <div className="settings-toolbar" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <strong>{date}</strong>
                  <button type="button" className="settings-secondary" onClick={() => setDateSlots(date, [])}>
                    この日の上書きを削除
                  </button>
                </div>
                <HoursSlotList
                  slots={draft.businessHoursByDate[date] ?? []}
                  onChange={(next) => setDateSlots(date, next)}
                  emptyHint="枠がありません。追加してください。"
                />
              </div>
            ))
          )}
        </div>
      ) : null}
      </div>

      <div className="settings-section-panel">
        <h3 className="settings-subtitle">日付変更時間</h3>
        <p className="settings-hint">
          この時刻を過ぎると翌事業日になります。例: 28 にすると「28:00（＝翌暦日 4:00）」まで前の事業日として扱います。タイムカード・日報などシステム全体に適用されます。
        </p>
        <div className="settings-toolbar" style={{ alignItems: "center", gap: "0.5rem" }}>
          <input
            id="day-change-hour"
            type="number"
            min={24}
            max={30}
            step={1}
            value={dayChangeHour}
            onChange={(e) => setDayChangeHour(Number(e.target.value))}
            style={{ width: "6rem" }}
          />
          <label htmlFor="day-change-hour" style={{ margin: 0 }}>時</label>
          <span className="settings-hint" style={{ margin: 0 }}>（24〜30、通常は 28）</span>
        </div>
      </div>

      <div className="settings-section-panel">
        <h3 className="settings-subtitle">支払方法（候補）</h3>
      <p className="settings-hint">日報などで使う支払方法の名前を登録します。入力して追加できます。</p>
      <div className="settings-toolbar" style={{ flexWrap: "wrap", gap: "0.35rem" }}>
        <input
          type="text"
          style={{ minWidth: "14rem", maxWidth: "100%" }}
          placeholder="例: QR決済"
          value={paymentInput}
          onChange={(e) => setPaymentInput(e.target.value)}
          maxLength={80}
        />
        <button type="button" className="settings-secondary" onClick={() => addPaymentMethod()}>
          追加
        </button>
      </div>
      {draft.paymentMethods.length === 0 ? (
        <p className="settings-hint">まだありません。</p>
      ) : (
        <ul className="settings-sf-list">
          {draft.paymentMethods.map((pm) => (
            <li key={pm} className="settings-sf-row attend-shift-list-row">
              <span className="settings-sf-name">{pm}</span>
              <button
                type="button"
                className="settings-secondary"
                onClick={() => setDraft({ ...draft, paymentMethods: draft.paymentMethods.filter((x) => x !== pm) })}
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      )}
      </div>

      <div className="settings-section-panel">
        <h3 className="settings-subtitle">アルコール探知機</h3>
        <p className="settings-hint">
          何台でも登録できます。「点検実施」を押すと当日（日本時間）を最終点検日として記録します。確認方法は出勤時のチェックで選べる候補です（初期値は対面・電話）。
        </p>
        {draft.breathalyzers.length === 0 ? (
          <p className="settings-hint">まだ登録がありません。</p>
        ) : (
          <ul className="settings-sf-list">
            {draft.breathalyzers.map((br) => (
              <li
                key={br.id}
                className="settings-sf-row attend-shift-list-row"
                style={{ flexDirection: "column", alignItems: "stretch", gap: "0.5rem" }}
              >
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center" }}>
                  <span className="settings-hint" style={{ minWidth: "3rem" }}>
                    名称
                  </span>
                  <input
                    type="text"
                    style={{ flex: "1 1 10rem", minWidth: 0 }}
                    value={br.name}
                    maxLength={120}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        breathalyzers: draft.breathalyzers.map((x) => (x.id === br.id ? { ...x, name: e.target.value } : x)),
                      })
                    }
                  />
                  <button
                    type="button"
                    className="settings-secondary"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        breathalyzers: draft.breathalyzers.map((x) =>
                          x.id === br.id ? { ...x, lastInspectionYmd: tokyoTodayYmd() } : x,
                        ),
                      })
                    }
                  >
                    点検実施
                  </button>
                  <span className="settings-hint">{br.lastInspectionYmd ? `最終点検: ${br.lastInspectionYmd}` : "点検未記録"}</span>
                  <button
                    type="button"
                    className="settings-secondary"
                    onClick={() => setDraft({ ...draft, breathalyzers: draft.breathalyzers.filter((x) => x.id !== br.id) })}
                  >
                    行を削除
                  </button>
                </div>
                <div>
                  <span className="settings-hint">確認方法</span>
                  <ul className="settings-sf-list" style={{ marginTop: "0.25rem" }}>
                    {br.verificationMethods.map((m) => (
                      <li key={`${br.id}-${m}`} className="settings-sf-row attend-shift-list-row">
                        <span className="settings-sf-name">{m}</span>
                        <button
                          type="button"
                          className="settings-secondary"
                          disabled={br.verificationMethods.length <= 1}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              breathalyzers: draft.breathalyzers.map((x) =>
                                x.id === br.id ? { ...x, verificationMethods: x.verificationMethods.filter((t) => t !== m) } : x,
                              ),
                            })
                          }
                        >
                          削除
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="settings-toolbar" style={{ marginTop: "0.35rem", flexWrap: "wrap" }}>
                    <input
                      type="text"
                      placeholder="候補を追加"
                      value={bzMethodDraft[br.id] ?? ""}
                      maxLength={40}
                      onChange={(e) => setBzMethodDraft((d) => ({ ...d, [br.id]: e.target.value }))}
                    />
                    <button
                      type="button"
                      className="settings-secondary"
                      onClick={() => {
                        const t = (bzMethodDraft[br.id] ?? "").trim();
                        if (!t) return;
                        setDraft({
                          ...draft,
                          breathalyzers: draft.breathalyzers.map((x) => {
                            if (x.id !== br.id) return x;
                            if (x.verificationMethods.includes(t)) return x;
                            return { ...x, verificationMethods: [...x.verificationMethods, t] };
                          }),
                        });
                        setBzMethodDraft((d) => ({ ...d, [br.id]: "" }));
                      }}
                    >
                      追加
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="settings-secondary"
          style={{ marginTop: "0.35rem" }}
          onClick={() =>
            setDraft({
              ...draft,
              breathalyzers: [
                ...draft.breathalyzers,
                { id: newId("bz"), name: "", lastInspectionYmd: null, verificationMethods: [...DEFAULT_BREATH_METHODS] },
              ],
            })
          }
        >
          アルコール探知機を追加
        </button>
      </div>

      <div className="settings-section-panel">
        <h3 className="settings-subtitle">定休日</h3>
      <p className="settings-hint">現在の設定: {regularSummary}</p>
      <button type="button" className="settings-secondary" onClick={() => openRegularDialog()}>
        定休日を編集（ダイアログ）
      </button>
      </div>

      <div className="settings-section-panel">
        <h3 className="settings-subtitle">臨時休業日</h3>
      <p className="settings-hint">選択中: {tempSummary}</p>
      <button type="button" className="settings-secondary" onClick={() => openTempDialog()}>
        臨時休業日を編集（カレンダー）
      </button>
      </div>

      <div className="settings-section-panel">
        <h3 className="settings-subtitle">管理者以外のメニュー</h3>
        <p className="settings-hint" style={{ marginTop: 0 }}>
          権限に <code>*</code> または <code>nav.full</code> があるユーザー（全メニュー）は常にすべて表示されます。それ以外のユーザーには、下でチェックしたヘッダーとタブだけが表示されます。
        </p>
        <p className="settings-hint">すべてのヘッダーをオンにすると制限なし（従来どおり）です。</p>

        <p style={{ margin: "0.75rem 0 0.35rem", fontWeight: 600, fontSize: "0.95rem" }}>ヘッダー</p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(11rem, 1fr))",
            gap: "0.35rem",
          }}
        >
          {STAFF_HEADER_NAV_META.map((m) => (
            <label key={m.id} className="settings-inline-check settings-check--block">
              <input
                type="checkbox"
                checked={Boolean(staffVis.nav[m.id])}
                onChange={(e) =>
                  setStaffVis((prev) => ({
                    ...prev,
                    nav: { ...prev.nav, [m.id]: e.target.checked },
                  }))
                }
              />{" "}
              {m.label}
            </label>
          ))}
        </div>

        <p style={{ margin: "1rem 0 0.35rem", fontWeight: 600, fontSize: "0.95rem" }}>画面内タブ（ヘッダーがオンのときのみ有効）</p>
        {STAFF_HEADER_NAV_META.map((m) => {
          const subs = STAFF_SUB_TAB_LABELS[m.id];
          if (!subs) return null;
          const parentOn = Boolean(staffVis.nav[m.id]);
          return (
            <fieldset
              key={m.id}
              style={{
                marginTop: "0.65rem",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-sm)",
                padding: "0.5rem 0.75rem",
              }}
              disabled={!parentOn}
            >
              <legend style={{ fontSize: "0.9rem", padding: "0 0.25rem" }}>{m.label}</legend>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(10rem, 1fr))",
                  gap: "0.3rem",
                }}
              >
                {subs.map((t) => (
                  <label key={t.id} className="settings-inline-check settings-check--block">
                    <input
                      type="checkbox"
                      checked={Boolean(staffVis.tabs[m.id]?.[t.id])}
                      onChange={(e) =>
                        setStaffVis((prev) => ({
                          ...prev,
                          tabs: {
                            ...prev.tabs,
                            [m.id]: { ...(prev.tabs[m.id] ?? {}), [t.id]: e.target.checked },
                          },
                        }))
                      }
                    />{" "}
                    {t.label}
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>

      <div className="settings-actions" style={{ marginTop: "1.25rem" }}>
        <button type="button" className="settings-primary" disabled={busy} onClick={() => void saveAll()}>
          保存
        </button>
      </div>

      {specialDateDialogOpen ? (
        <div
          className="pricing-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSpecialDateDialogOpen(false);
          }}
        >
          <div
            className="pricing-modal attend-shift-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="basic-sp-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="basic-sp-title" className="pricing-modal-title">
              特定日を追加
            </h2>
            <div className="attend-shift-dialog-scroll">
              <Err msg={localErr} />
              <label htmlFor="basic-sp-date">日付</label>
              <input id="basic-sp-date" type="date" value={newSpecialDate} onChange={(e) => setNewSpecialDate(e.target.value)} />
              <p className="settings-hint">追加後、基本と同じ枠がコピーされます。必要に応じて編集してください。</p>
            </div>
            <div className="pricing-modal-actions">
              <button type="button" className="settings-primary" onClick={() => confirmAddSpecialDate()}>
                追加
              </button>
              <button
                type="button"
                onClick={() => {
                  setSpecialDateDialogOpen(false);
                  setLocalErr(null);
                }}
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      ) : null}

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

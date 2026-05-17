import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";
import { FlexTimeInput } from "../components/FlexTimeInput";
import { formatFlexTimeOnBlur } from "../lib/flex-time-input";
import { useSavedToast } from "../saved-toast";
import { Err } from "../ui";

const ALL_DURATION_OPTIONS = [15, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 360, 480];

type ReservationTimingForm = {
  defaultTripEstimateMinutes: number;
  blockedTimeMode: "multiply" | "add";
  blockedTimeMultiply: number;
  blockedTimeAddMinutes: number;
  availabilityMode: "confirmed_shifts" | "virtual_concurrent";
  virtualConcurrentSlots: number;
  virtualSlotsByDate: Record<string, number>;
};

const RT_DEFAULT: ReservationTimingForm = {
  defaultTripEstimateMinutes: 60,
  blockedTimeMode: "multiply",
  blockedTimeMultiply: 2,
  blockedTimeAddMinutes: 10,
  availabilityMode: "confirmed_shifts",
  virtualConcurrentSlots: 2,
  virtualSlotsByDate: {},
};

type OnlineBookingApi = {
  enabled: boolean;
  message: string;
  durationOptions: number[];
  daysAhead: number;
  onlineLatestCloseHm: string | null;
  tenantSlug: string;
  reservationTiming: ReservationTimingForm;
};

function guestBookingUrl(slug: string): string {
  return `${window.location.origin}/app/book/${encodeURIComponent(slug)}`;
}

export default function OnlineBookingSettingsPanel({
  setErr,
  busy,
  setBusy,
}: {
  setErr: (e: string | null) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
}): JSX.Element {
  const { flashSaved } = useSavedToast();

  const [loading, setLoading] = useState(true);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [tenantSlug, setTenantSlug] = useState("");
  const [copied, setCopied] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [durationOptions, setDurationOptions] = useState<number[]>([30, 45, 60, 75, 90, 120, 150, 180, 240]);
  const [daysAhead, setDaysAhead] = useState<number>(30);
  /** ネット予約の空き枠終了（28時間表記 HH:mm）。空なら営業終了まで */
  const [onlineLatestCloseHm, setOnlineLatestCloseHm] = useState("");
  const [rt, setRt] = useState<ReservationTimingForm>(RT_DEFAULT);

  const load = useCallback(async () => {
    setLoading(true);
    setLocalErr(null);
    const r = await apiFetch<OnlineBookingApi>("/settings/online-booking");
    setLoading(false);
    if (!r.ok) {
      setLocalErr(r.error);
      return;
    }
    setEnabled(r.data.enabled);
    setMessage(r.data.message);
    setDurationOptions(r.data.durationOptions);
    setDaysAhead(r.data.daysAhead);
    setOnlineLatestCloseHm(r.data.onlineLatestCloseHm?.trim() ?? "");
    setTenantSlug(r.data.tenantSlug);
    const incoming = r.data.reservationTiming;
    if (incoming && typeof incoming === "object") {
      const vs =
        incoming.virtualSlotsByDate &&
        typeof incoming.virtualSlotsByDate === "object" &&
        !Array.isArray(incoming.virtualSlotsByDate)
          ? { ...(incoming.virtualSlotsByDate as Record<string, number>) }
          : {};
      setRt({
        ...RT_DEFAULT,
        ...incoming,
        blockedTimeMode: incoming.blockedTimeMode === "add" ? "add" : "multiply",
        availabilityMode: incoming.availabilityMode === "virtual_concurrent" ? "virtual_concurrent" : "confirmed_shifts",
        virtualSlotsByDate: vs,
      });
    } else {
      setRt(RT_DEFAULT);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(): Promise<void> {
    if (durationOptions.length === 0) {
      setLocalErr("目安時間の選択肢を1つ以上チェックしてください");
      return;
    }
    const closeHm = formatFlexTimeOnBlur(onlineLatestCloseHm);
    setOnlineLatestCloseHm(closeHm);
    setBusy(true);
    setLocalErr(null);
    setErr(null);
    const r = await apiFetch("/settings/online-booking", {
      method: "PUT",
      json: {
        enabled,
        message,
        durationOptions,
        daysAhead,
        onlineLatestCloseHm: closeHm.trim() || null,
        reservationTiming: {
          defaultTripEstimateMinutes: rt.defaultTripEstimateMinutes,
          blockedTimeMode: rt.blockedTimeMode,
          blockedTimeMultiply: rt.blockedTimeMultiply,
          blockedTimeAddMinutes: rt.blockedTimeAddMinutes,
          availabilityMode: rt.availabilityMode,
          virtualConcurrentSlots: rt.virtualConcurrentSlots,
          virtualSlotsByDate: rt.virtualSlotsByDate,
        },
      },
    });
    setBusy(false);
    if (!r.ok) {
      setLocalErr(r.error);
      return;
    }
    flashSaved();
  }

  function toggleDuration(min: number): void {
    setDurationOptions((prev) =>
      prev.includes(min) ? prev.filter((x) => x !== min) : [...prev, min].sort((a, b) => a - b),
    );
  }

  async function copyUrl(): Promise<void> {
    try {
      await navigator.clipboard.writeText(guestBookingUrl(tenantSlug));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // フォールバック: 選択状態にする
    }
  }

  if (loading) return <p className="settings-hint">読み込み中…</p>;

  return (
    <div className="settings-form">
      <Err msg={localErr} />

      <div className="settings-checkbox-row" style={{ marginBottom: "0.25rem" }}>
        <label className="settings-inline-check" style={{ fontWeight: 600, fontSize: "1rem" }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          ネット予約を受け付ける
        </label>
      </div>
      <p className="settings-hint" style={{ marginTop: 0 }}>
        オンにすると、QR コードや URL を知っていれば誰でもゲスト予約ページを開けます。
        オフのときは予約フォームが「現在受け付けていません」と表示されます。
      </p>

      {enabled && tenantSlug ? (
        <div
          style={{
            background: "var(--color-accent-muted)",
            border: "1px solid var(--color-accent)",
            borderRadius: "var(--radius-md)",
            padding: "0.75rem 1rem",
            marginBottom: "0.5rem",
          }}
        >
          <p style={{ margin: "0 0 0.4rem", fontWeight: 600, fontSize: "0.9rem" }}>ゲスト予約 URL</p>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <code
              style={{
                flex: 1,
                minWidth: 0,
                wordBreak: "break-all",
                fontSize: "0.82rem",
                background: "var(--color-surface)",
                padding: "0.3rem 0.5rem",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-border)",
                userSelect: "all",
              }}
            >
              {guestBookingUrl(tenantSlug)}
            </code>
            <button
              type="button"
              className="settings-secondary"
              style={{ whiteSpace: "nowrap" }}
              onClick={() => void copyUrl()}
            >
              {copied ? "コピーしました" : "コピー"}
            </button>
          </div>
          <p className="settings-hint" style={{ marginTop: "0.4rem" }}>
            このURLをQRコードにしてお店に貼るか、LINE や SNS でシェアしてください。
          </p>
        </div>
      ) : null}

      <label style={{ marginTop: "0.5rem" }}>予約ページに表示するメッセージ（任意・400文字以内）</label>
      <textarea
        rows={3}
        style={{ resize: "vertical" }}
        value={message}
        maxLength={400}
        placeholder="例: ご不明な点はお電話（090-xxxx-xxxx）でもお受けします。"
        onChange={(e) => setMessage(e.target.value)}
      />
      <p className="settings-hint" style={{ marginTop: 0 }}>{message.length}/400文字</p>

      <label>ゲストが選べる「送り先までの目安」（15分刻み・複数選択可）</label>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(7rem, 1fr))",
          gap: "0.35rem",
          marginBottom: "0.25rem",
        }}
      >
        {ALL_DURATION_OPTIONS.map((m) => (
          <label key={m} className="settings-check settings-check--block">
            <input
              type="checkbox"
              checked={durationOptions.includes(m)}
              onChange={() => toggleDuration(m)}
            />{" "}
            {m} 分
          </label>
        ))}
      </div>
      {durationOptions.length === 0 ? (
        <p className="err">目安時間の選択肢を1つ以上チェックしてください</p>
      ) : null}

      <label style={{ marginTop: "0.5rem" }}>何日先まで予約可能か（0 = 制限なし・最大365日）</label>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <input
          type="number"
          min={0}
          max={365}
          style={{ width: "6rem" }}
          value={daysAhead}
          onChange={(e) => {
            const n = Math.max(0, Math.min(365, Math.floor(Number(e.target.value) || 0)));
            setDaysAhead(n);
          }}
        />
        <span style={{ color: "var(--color-muted)", fontSize: "0.9rem" }}>
          {daysAhead === 0 ? "制限なし" : `本日から ${daysAhead} 日先まで`}
        </span>
      </div>
      <p className="settings-hint">
        例: 30 なら今日から30日後の分まで予約できます。0にすると日付に制限をかけません。
      </p>

      <label style={{ marginTop: "0.75rem" }}>ネット予約の終了時刻（28時間表記・任意）</label>
      <FlexTimeInput
        placeholder="例: 26:00（空欄＝営業時間の終わりまで枠を表示）"
        style={{ maxWidth: "22rem" }}
        value={onlineLatestCloseHm}
        onChange={setOnlineLatestCloseHm}
      />
      <p className="settings-hint" style={{ marginTop: 0 }}>
        営業が28時まででも、ここを26:00にするとゲスト予約の空きは26時までしか出ません（LIFF・ゲスト予約の両方）。
      </p>

      <hr style={{ margin: "1.25rem 0", border: 0, borderTop: "1px solid var(--color-border)" }} />
      <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem", fontWeight: 600 }}>
        目安時間・実車ブロック・空き枠
      </h3>
      <p className="settings-hint" style={{ marginTop: 0, marginBottom: "0.75rem" }}>
        以下はネット予約に加え、スタッフの「今日のスケジュール」から運行予定を登録するときも同じ式でブロック時間が決まります。
      </p>

      <label htmlFor="ob-rt-default">フォームの目安の初期値（分・15分刻み）</label>
      <select
        id="ob-rt-default"
        value={rt.defaultTripEstimateMinutes}
        onChange={(e) =>
          setRt((prev) => ({ ...prev, defaultTripEstimateMinutes: Number(e.target.value) }))
        }
      >
        {ALL_DURATION_OPTIONS.map((m) => (
          <option key={m} value={m}>
            {m} 分
          </option>
        ))}
      </select>

      <p style={{ margin: "0.85rem 0 0.35rem", fontWeight: 600, fontSize: "0.95rem" }}>スケジュール上の実車ブロック</p>
      <div className="settings-checkbox-row" style={{ flexDirection: "column", alignItems: "stretch", gap: "0.35rem" }}>
        <label className="settings-inline-check">
          <input
            type="radio"
            name="ob-rt-block-mode"
            checked={rt.blockedTimeMode === "multiply"}
            onChange={() => setRt((p) => ({ ...p, blockedTimeMode: "multiply" }))}
          />
          掛け算（目安 × 係数を 15 分に切り上げ、15〜480 分に収める）
        </label>
        <label className="settings-inline-check">
          <input
            type="radio"
            name="ob-rt-block-mode"
            checked={rt.blockedTimeMode === "add"}
            onChange={() => setRt((p) => ({ ...p, blockedTimeMode: "add" }))}
          />
          加算（目安 + 加算分を同様に丸める）
        </label>
      </div>
      {rt.blockedTimeMode === "multiply" ? (
        <div style={{ marginTop: "0.5rem" }}>
          <label htmlFor="ob-rt-mul">係数（0より大きく10以下）</label>
          <input
            id="ob-rt-mul"
            type="number"
            min={0.01}
            max={10}
            step={0.1}
            style={{ width: "8rem" }}
            value={rt.blockedTimeMultiply}
            onChange={(e) => setRt((p) => ({ ...p, blockedTimeMultiply: Number(e.target.value) || 1 }))}
          />
        </div>
      ) : (
        <div style={{ marginTop: "0.5rem" }}>
          <label htmlFor="ob-rt-add">加算する分（0〜480・整数）</label>
          <input
            id="ob-rt-add"
            type="number"
            min={0}
            max={480}
            step={1}
            style={{ width: "8rem" }}
            value={rt.blockedTimeAddMinutes}
            onChange={(e) => setRt((p) => ({ ...p, blockedTimeAddMinutes: Math.floor(Number(e.target.value) || 0) }))}
          />
        </div>
      )}

      <p style={{ margin: "0.85rem 0 0.35rem", fontWeight: 600, fontSize: "0.95rem" }}>空き枠の出し方</p>
      <div className="settings-checkbox-row" style={{ flexDirection: "column", alignItems: "stretch", gap: "0.35rem" }}>
        <label className="settings-inline-check">
          <input
            type="radio"
            name="ob-rt-avail"
            checked={rt.availabilityMode === "confirmed_shifts"}
            onChange={() => setRt((p) => ({ ...p, availabilityMode: "confirmed_shifts" }))}
          />
          確定シフトに基づく（従来どおり）
        </label>
        <label className="settings-inline-check">
          <input
            type="radio"
            name="ob-rt-avail"
            checked={rt.availabilityMode === "virtual_concurrent"}
            onChange={() => setRt((p) => ({ ...p, availabilityMode: "virtual_concurrent" }))}
          />
          シフトなし・同時予約の上限で枠を出す
        </label>
      </div>
      {rt.availabilityMode === "virtual_concurrent" ? (
        <div style={{ marginTop: "0.5rem" }}>
          <label htmlFor="ob-rt-vslots">同時に走れる予約の上限（1〜50）</label>
          <input
            id="ob-rt-vslots"
            type="number"
            min={1}
            max={50}
            step={1}
            style={{ width: "6rem" }}
            value={rt.virtualConcurrentSlots}
            onChange={(e) =>
              setRt((p) => ({ ...p, virtualConcurrentSlots: Math.floor(Number(e.target.value) || 1) }))
            }
          />
          <p className="settings-hint" style={{ marginTop: "0.35rem" }}>
            仮想枠では予約は担当未割当（未予定列）で作成され、後から担当を割り当てる想定です。上限はトランザクションで担保します。
          </p>
          <div style={{ marginTop: "0.75rem" }}>
            <p style={{ margin: "0 0 0.35rem", fontWeight: 600, fontSize: "0.9rem" }}>日別の同時上限（任意）</p>
            <p className="settings-hint" style={{ marginBottom: "0.5rem" }}>
              キーは yyyy-MM-dd、未設定の日は上の全体デフォルトを使います。将来カレンダーUIに拡張可。
            </p>
            <table className="dash-driver-table" style={{ maxWidth: "28rem" }}>
              <thead>
                <tr>
                  <th>日付</th>
                  <th>上限</th>
                  <th style={{ width: "4rem" }} />
                </tr>
              </thead>
              <tbody>
                {Object.entries(rt.virtualSlotsByDate)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([ymd, slots]) => (
                    <tr key={ymd}>
                      <td>
                        <input
                          type="date"
                          value={ymd}
                          onChange={(e) => {
                            const next = e.target.value;
                            if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return;
                            setRt((p) => {
                              const copy = { ...p.virtualSlotsByDate };
                              delete copy[ymd];
                              copy[next] = slots;
                              return { ...p, virtualSlotsByDate: copy };
                            });
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={1}
                          max={50}
                          step={1}
                          style={{ width: "5rem" }}
                          value={slots}
                          onChange={(e) =>
                            setRt((p) => ({
                              ...p,
                              virtualSlotsByDate: {
                                ...p.virtualSlotsByDate,
                                [ymd]: Math.floor(Number(e.target.value) || 1),
                              },
                            }))
                          }
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="settings-secondary"
                          onClick={() =>
                            setRt((p) => {
                              const copy = { ...p.virtualSlotsByDate };
                              delete copy[ymd];
                              return { ...p, virtualSlotsByDate: copy };
                            })
                          }
                        >
                          削除
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <div className="settings-toolbar" style={{ marginTop: "0.5rem", gap: "0.35rem" }}>
              <button
                type="button"
                className="settings-secondary"
                onClick={() => {
                  const t = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date()).slice(0, 10);
                  setRt((p) => ({
                    ...p,
                    virtualSlotsByDate: { ...p.virtualSlotsByDate, [t]: p.virtualConcurrentSlots },
                  }));
                }}
              >
                今日の行を追加
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p className="settings-hint" style={{ marginTop: "0.35rem" }}>
          客車の確定シフトが予約区間をすべて含む場合のみ空きとして数えます。シフト未登録の日は枠が出ません。
        </p>
      )}

      <button
        type="button"
        className="settings-primary"
        style={{ marginTop: "1rem" }}
        disabled={busy || durationOptions.length === 0}
        onClick={() => void save()}
      >
        保存
      </button>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";
import { useSavedToast } from "../saved-toast";
import { Err } from "../ui";

const ALL_DURATION_OPTIONS = [15, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 360, 480];

type OnlineBookingApi = {
  enabled: boolean;
  message: string;
  durationOptions: number[];
  daysAhead: number;
  tenantSlug: string;
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
    setTenantSlug(r.data.tenantSlug);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(): Promise<void> {
    if (durationOptions.length === 0) {
      setLocalErr("所要時間の選択肢を1つ以上チェックしてください");
      return;
    }
    setBusy(true);
    setLocalErr(null);
    setErr(null);
    const r = await apiFetch("/settings/online-booking", {
      method: "PUT",
      json: { enabled, message, durationOptions, daysAhead },
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

      <label>ゲストが選べる所要時間（15分刻み・複数選択可）</label>
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
        <p className="err">所要時間の選択肢を1つ以上チェックしてください</p>
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

      <button
        type="button"
        className="settings-primary"
        disabled={busy || durationOptions.length === 0}
        onClick={() => void save()}
      >
        保存
      </button>
    </div>
  );
}

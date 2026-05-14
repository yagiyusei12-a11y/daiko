import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { publicFetch } from "../lib/public-api";

type BusinessHourSlot = { id: string; open: string; close: string };

type OnlineBookingInfo = {
  enabled: boolean;
  message: string;
  durationOptions: number[];
  daysAhead: number;
};

type BookingInitResp = {
  tenant: { name: string };
  date: string;
  timeZone: string;
  businessHours: BusinessHourSlot[];
  isClosed: boolean;
  onlineBooking: OnlineBookingInfo;
};

type AvailabilitySlot = { startLocal: string; endLocal: string; availableCount: number };

type AvailabilityResp = {
  tenantId: string;
  date: string;
  durationMinutes: number;
  isClosed: boolean;
  slots: AvailabilitySlot[];
};

type CreateOk = { id: string };

const DEFAULT_DURATION_OPTIONS = [30, 45, 60, 75, 90, 120, 150, 180, 240];

function tokyoTodayYmd(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date()).slice(0, 10);
}

function formatHm(local: string): string {
  return local.slice(11, 16);
}

function formatDayTitleJa(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat("ja-JP", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  }).format(dt);
}

export default function GuestBookingPage(): JSX.Element {
  const params = useParams<{ slug: string }>();
  const slug = (params.slug ?? "").trim();

  const [init, setInit] = useState<BookingInitResp | null>(null);
  const [initErr, setInitErr] = useState<string | null>(null);
  const [initLoading, setInitLoading] = useState(true);

  const [obInfo, setObInfo] = useState<OnlineBookingInfo>({
    enabled: true,
    message: "",
    durationOptions: DEFAULT_DURATION_OPTIONS,
    daysAhead: 30,
  });

  const [date, setDate] = useState<string>(tokyoTodayYmd);
  const [durationMinutes, setDurationMinutes] = useState<number>(60);

  const [availability, setAvailability] = useState<AvailabilityResp | null>(null);
  const [availLoading, setAvailLoading] = useState(false);
  const [availErr, setAvailErr] = useState<string | null>(null);

  const [selectedSlot, setSelectedSlot] = useState<string>("");

  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [pickup, setPickup] = useState("");
  const [viaStops, setViaStops] = useState<string[]>([""]);
  const [dropoff, setDropoff] = useState("");
  const [website, setWebsite] = useState("");

  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInitLoading(true);
    setInitErr(null);
    void publicFetch<BookingInitResp>(`/public/book/${encodeURIComponent(slug)}?date=${encodeURIComponent(date)}`).then(
      (r) => {
        if (cancelled) return;
        setInitLoading(false);
        if (!r.ok) {
          setInit(null);
          setInitErr(r.error);
          return;
        }
        setInit(r.data);
        if (r.data.onlineBooking) {
          setObInfo(r.data.onlineBooking);
          // durationOptions が変わったとき、現在選択中の duration が含まれていなければ最初の値に戻す
          setDurationMinutes((prev) => {
            const opts = r.data.onlineBooking.durationOptions;
            return opts.includes(prev) ? prev : (opts[0] ?? 60);
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [slug, date]);

  const loadAvailability = useCallback(async () => {
    if (!slug || !date) return;
    setAvailLoading(true);
    setAvailErr(null);
    setSelectedSlot("");
    const r = await publicFetch<AvailabilityResp>(
      `/public/book/${encodeURIComponent(slug)}/availability?date=${encodeURIComponent(date)}&durationMinutes=${durationMinutes}`,
    );
    setAvailLoading(false);
    if (!r.ok) {
      setAvailability(null);
      setAvailErr(r.error);
      return;
    }
    setAvailability(r.data);
  }, [slug, date, durationMinutes]);

  useEffect(() => {
    void loadAvailability();
  }, [loadAvailability]);

  const availableSlots = useMemo(() => {
    return (availability?.slots ?? []).filter((s) => s.availableCount > 0);
  }, [availability?.slots]);

  async function submit(): Promise<void> {
    setSubmitErr(null);
    if (!selectedSlot) {
      setSubmitErr("ご希望のお時間を選んでください");
      return;
    }
    if (!customerName.trim() || !phone.trim() || !pickup.trim() || !dropoff.trim()) {
      setSubmitErr("お名前・電話番号・迎え先・送り先を入力してください");
      return;
    }
    setSubmitBusy(true);
    const via = viaStops.map((s) => s.trim()).filter(Boolean);
    const r = await publicFetch<CreateOk>(`/public/book/${encodeURIComponent(slug)}/reservations`, {
      method: "POST",
      json: {
        startLocal: selectedSlot,
        durationMinutes,
        customerName: customerName.trim(),
        phone: phone.trim(),
        pickup: pickup.trim(),
        viaStops: via,
        dropoff: dropoff.trim(),
        website,
      },
    });
    setSubmitBusy(false);
    if (!r.ok) {
      setSubmitErr(r.error);
      if (r.status === 409) {
        void loadAvailability();
      }
      return;
    }
    setDone({ id: r.data.id });
  }

  if (initLoading) {
    return (
      <GuestShell title="読み込み中…">
        <p style={{ color: "var(--color-muted)" }}>少々お待ちください</p>
      </GuestShell>
    );
  }

  if (initErr || !init) {
    return (
      <GuestShell title="ご予約ページ">
        <p className="err">{initErr ?? "お店が見つかりませんでした"}</p>
      </GuestShell>
    );
  }

  if (!obInfo.enabled) {
    return (
      <GuestShell title={init.tenant.name}>
        <p style={{ lineHeight: 1.7, color: "var(--color-muted)", textAlign: "center", padding: "1.5rem 0" }}>
          現在ネット予約は受け付けていません。<br />
          お電話でお問い合わせください。
        </p>
        {obInfo.message ? (
          <p style={{ lineHeight: 1.7, whiteSpace: "pre-wrap", color: "var(--color-text)" }}>{obInfo.message}</p>
        ) : null}
      </GuestShell>
    );
  }

  if (done) {
    return (
      <GuestShell title={init.tenant.name}>
        <div style={{ textAlign: "center", padding: "2rem 0" }}>
          <h2 style={{ margin: "0 0 0.75rem", fontSize: "1.25rem" }}>ご予約を承りました</h2>
          <p style={{ color: "var(--color-muted)", lineHeight: 1.7 }}>
            ご予約番号: <code>{done.id}</code>
            <br />
            お店からのご連絡をお待ちください。
          </p>
          <button
            type="button"
            className="settings-secondary"
            style={{ marginTop: "1.25rem" }}
            onClick={() => {
              setDone(null);
              setSelectedSlot("");
              setCustomerName("");
              setPhone("");
              setPickup("");
              setViaStops([""]);
              setDropoff("");
              setSubmitErr(null);
              void loadAvailability();
            }}
          >
            もう一件予約する
          </button>
        </div>
      </GuestShell>
    );
  }

  return (
    <GuestShell title={init.tenant.name}>
      {obInfo.message ? (
        <p style={{ margin: "0 0 1rem", lineHeight: 1.7, whiteSpace: "pre-wrap", borderLeft: "3px solid var(--color-accent)", paddingLeft: "0.75rem" }}>
          {obInfo.message}
        </p>
      ) : null}
      <p style={{ margin: "0 0 1rem", color: "var(--color-muted)", fontSize: "0.95rem" }}>
        ご希望日と時間を選んで、必要事項をご入力ください。
      </p>

      <div style={{ display: "grid", gap: "0.5rem", marginBottom: "1rem" }}>
        <label htmlFor="gb-date" style={{ fontWeight: 600 }}>
          ご希望日
        </label>
        <input
          id="gb-date"
          type="date"
          value={date}
          min={tokyoTodayYmd()}
          max={
            obInfo.daysAhead > 0
              ? (() => {
                  const d = new Date();
                  d.setDate(d.getDate() + obInfo.daysAhead);
                  return d.toISOString().slice(0, 10);
                })()
              : undefined
          }
          onChange={(e) => setDate(e.target.value)}
        />
        <p style={{ margin: 0, color: "var(--color-muted)", fontSize: "0.85rem" }}>{formatDayTitleJa(date)}</p>

        <label htmlFor="gb-dur" style={{ fontWeight: 600, marginTop: "0.5rem" }}>
          ご利用時間（目安）
        </label>
        <select
          id="gb-dur"
          value={durationMinutes}
          onChange={(e) => setDurationMinutes(Number(e.target.value))}
        >
          {obInfo.durationOptions.map((m) => (
            <option key={m} value={m}>
              {m} 分
            </option>
          ))}
        </select>
      </div>

      <h3 style={{ margin: "1rem 0 0.5rem", fontSize: "1rem" }}>空き時間を選ぶ</h3>
      {availLoading ? (
        <p className="settings-hint">空き時間を確認しています…</p>
      ) : availErr ? (
        <p className="err">{availErr}</p>
      ) : availability?.isClosed ? (
        <p className="settings-hint">この日は休業日のためご予約いただけません。別の日をお選びください。</p>
      ) : availableSlots.length === 0 ? (
        <p className="settings-hint">この日のこの時間枠には空きがありません。日付やご利用時間を変えてお試しください。</p>
      ) : (
        <div
          role="radiogroup"
          aria-label="ご希望のお時間"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(5.5rem, 1fr))",
            gap: "0.4rem",
            marginBottom: "1rem",
          }}
        >
          {availableSlots.map((s) => {
            const active = selectedSlot === s.startLocal;
            return (
              <button
                key={s.startLocal}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSelectedSlot(s.startLocal)}
                style={{
                  padding: "0.5rem 0.25rem",
                  borderRadius: "var(--radius-sm)",
                  border: active
                    ? "2px solid var(--color-accent)"
                    : "1px solid var(--color-border)",
                  background: active ? "var(--color-accent-muted)" : "var(--color-surface)",
                  color: "var(--color-text)",
                  fontWeight: active ? 600 : 400,
                  cursor: "pointer",
                }}
              >
                {formatHm(s.startLocal)}
              </button>
            );
          })}
        </div>
      )}

      <div className="settings-form" style={{ marginTop: "0.5rem" }}>
        <label htmlFor="gb-name">お名前</label>
        <input
          id="gb-name"
          type="text"
          autoComplete="name"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
        />
        <label htmlFor="gb-phone">電話番号</label>
        <input
          id="gb-phone"
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <label htmlFor="gb-pickup">迎え先</label>
        <input
          id="gb-pickup"
          type="text"
          value={pickup}
          onChange={(e) => setPickup(e.target.value)}
          placeholder="例: ○○店"
        />
        <label>経由地（必要な場合）</label>
        {viaStops.map((v, idx) => (
          <div key={idx} className="settings-toolbar" style={{ gap: "0.35rem" }}>
            <input
              type="text"
              style={{ flex: 1, minWidth: 0 }}
              value={v}
              onChange={(e) =>
                setViaStops((prev) => prev.map((x, i) => (i === idx ? e.target.value : x)))
              }
              placeholder={`経由 ${idx + 1}`}
            />
            <button
              type="button"
              className="settings-secondary"
              onClick={() => setViaStops((prev) => prev.filter((_, i) => i !== idx))}
              disabled={viaStops.length <= 1}
            >
              削除
            </button>
          </div>
        ))}
        <button
          type="button"
          className="settings-secondary"
          onClick={() => setViaStops((prev) => [...prev, ""])}
        >
          経由地を追加
        </button>
        <label htmlFor="gb-drop">送り先</label>
        <input
          id="gb-drop"
          type="text"
          value={dropoff}
          onChange={(e) => setDropoff(e.target.value)}
          placeholder="例: ○○町○○番地"
        />

        <div
          aria-hidden="true"
          style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}
        >
          <label htmlFor="gb-website">website (空欄のままにしてください)</label>
          <input
            id="gb-website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>
      </div>

      {submitErr ? <p className="err" style={{ marginTop: "1rem" }}>{submitErr}</p> : null}

      <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
        <button
          type="button"
          className="settings-primary"
          disabled={submitBusy || !selectedSlot}
          onClick={() => void submit()}
        >
          {submitBusy ? "送信中…" : "この内容で予約する"}
        </button>
      </div>
    </GuestShell>
  );
}

function GuestShell({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ minHeight: "100vh", padding: "1rem", maxWidth: "640px", margin: "0 auto" }}>
      <header
        style={{
          padding: "1rem 0",
          marginBottom: "0.75rem",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 700 }}>{title}</h1>
        <p style={{ margin: "0.25rem 0 0", color: "var(--color-muted)", fontSize: "0.85rem" }}>
          ネット予約
        </p>
      </header>
      <main className="card" style={{ position: "relative" }}>
        {children}
      </main>
    </div>
  );
}

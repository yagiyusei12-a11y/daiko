import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { Err } from "../../ui";

const BILLING_STATUS_OPTIONS = [
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "CANCELED",
  "EXPIRED",
  "LICENSE_ONLY",
] as const;

type BillingStatus = (typeof BILLING_STATUS_OPTIONS)[number];

type TenantBillingFields = {
  billingStatus: BillingStatus;
  paidThroughAt: string | null;
  trialEndsAt: string | null;
  billingUpdatedAt?: string;
  stripeCustomerId?: string | null;
};

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  createdAt: string;
  legalTradeName: string | null;
  legalPhone: string | null;
  planTier: string;
  userCount: number;
  employeeCount: number;
  dailyReportCount: number;
} & TenantBillingFields;

type TenantDetail = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  settings: {
    legalTradeName: string | null;
    legalPrefecture: string | null;
    legalStreetAddress: string | null;
    legalPhone: string | null;
    businessDayRollHour: number;
  } | null;
  subscriptions: { planTier: string; validFrom: string }[];
  users: { id: string; email: string; displayName: string | null }[];
  counts: { employees: number; vehicles: number; dailyReports: number };
} & TenantBillingFields;

function formatDt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalValue(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export default function PlatformTenantsPage(): JSX.Element {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [items, setItems] = useState<TenantRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TenantDetail | null>(null);
  const [editName, setEditName] = useState("");
  const [editTradeName, setEditTradeName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editPlan, setEditPlan] = useState("FREE");
  const [editBillingStatus, setEditBillingStatus] = useState<BillingStatus>("TRIALING");
  const [editPaidThrough, setEditPaidThrough] = useState("");
  const [editTrialEnds, setEditTrialEnds] = useState("");
  const [billingBusy, setBillingBusy] = useState(false);

  const loadList = useCallback(async () => {
    setErr(null);
    const params = new URLSearchParams({ page: String(page), limit: "50" });
    if (search) params.set("q", search);
    const r = await apiFetch<{ items: TenantRow[]; totalPages: number }>(`/platform/tenants?${params}`);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setItems(r.data.items);
    setTotalPages(r.data.totalPages);
  }, [page, search]);

  const loadDetail = useCallback(async (id: string) => {
    const r = await apiFetch<{ tenant: TenantDetail }>(`/platform/tenants/${id}`);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    const t = r.data.tenant;
    setDetail(t);
    setEditName(t.name);
    setEditTradeName(t.settings?.legalTradeName ?? t.name);
    setEditPhone(t.settings?.legalPhone ?? "");
    setEditPlan(t.subscriptions[0]?.planTier ?? "FREE");
    setEditBillingStatus(t.billingStatus ?? "TRIALING");
    setEditPaidThrough(toDatetimeLocalValue(t.paidThroughAt));
    setEditTrialEnds(toDatetimeLocalValue(t.trialEndsAt));
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  async function saveTenant(): Promise<void> {
    if (!selectedId) return;
    setBusy(true);
    setErr(null);
    const r = await apiFetch(`/platform/tenants/${selectedId}`, {
      method: "PATCH",
      json: {
        name: editName,
        legalTradeName: editTradeName,
        legalPhone: editPhone,
        planTier: editPlan,
      },
    });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    await loadList();
    await loadDetail(selectedId);
  }

  async function saveBilling(): Promise<void> {
    if (!selectedId) return;
    setBillingBusy(true);
    setErr(null);
    const r = await apiFetch<{ tenant: TenantBillingFields }>(`/platform/tenants/${selectedId}/billing`, {
      method: "PUT",
      json: {
        billingStatus: editBillingStatus,
        paidThroughAt: fromDatetimeLocalValue(editPaidThrough),
        trialEndsAt: fromDatetimeLocalValue(editTrialEnds),
      },
    });
    setBillingBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    await loadList();
    await loadDetail(selectedId);
  }

  return (
    <div>
      <header className="platform-page-head">
        <h1>テナント管理</h1>
        <p>登録店舗の一覧・課金状態・プラン・基本情報の確認と更新（スラッグは変更できません）</p>
      </header>

      {err ? <Err msg={err} /> : null}

      <div className="platform-toolbar">
        <input
          type="search"
          placeholder="店舗名・スラッグで検索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setSearch(q.trim());
              setPage(1);
            }
          }}
        />
        <button
          type="button"
          className="platform-btn platform-btn--ghost"
          onClick={() => {
            setSearch(q.trim());
            setPage(1);
          }}
        >
          検索
        </button>
      </div>

      <div className="platform-table-wrap">
        <table className="platform-table">
          <thead>
            <tr>
              <th>店舗名</th>
              <th>スラッグ</th>
              <th>課金</th>
              <th>利用期限</th>
              <th>プラン</th>
              <th>ユーザー</th>
              <th>従業員</th>
              <th>日報</th>
              <th>登録日</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr
                key={row.id}
                className={row.id === selectedId ? "is-selected" : undefined}
                style={{ cursor: "pointer" }}
                onClick={() => setSelectedId(row.id)}
              >
                <td>{row.legalTradeName || row.name}</td>
                <td>
                  <code>{row.slug}</code>
                </td>
                <td>
                  <span className={`platform-billing-badge platform-billing-badge--${row.billingStatus.toLowerCase()}`}>
                    {row.billingStatus}
                  </span>
                </td>
                <td>{formatDt(row.paidThroughAt)}</td>
                <td>{row.planTier}</td>
                <td>{row.userCount}</td>
                <td>{row.employeeCount}</td>
                <td>{row.dailyReportCount}</td>
                <td>{formatDt(row.createdAt)}</td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={9}>テナントがありません</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="platform-pagination">
        <button
          type="button"
          className="platform-btn platform-btn--ghost"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          前へ
        </button>
        <span>
          {page} / {totalPages}
        </span>
        <button
          type="button"
          className="platform-btn platform-btn--ghost"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => p + 1)}
        >
          次へ
        </button>
      </div>

      {detail ? (
        <section className="platform-detail">
          <h2>{detail.name}</h2>
          <p>
            スラッグ: <code>{detail.slug}</code> · タイムゾーン: {detail.timezone}
          </p>

          <h3 className="platform-detail-subhead">課金・利用期限</h3>
          <p className="platform-detail-hint">
            現在: {detail.billingStatus} · 利用期限 {formatDt(detail.paidThroughAt)} · トライアル終了{" "}
            {formatDt(detail.trialEndsAt)}
            {detail.billingUpdatedAt ? ` · 更新 ${formatDt(detail.billingUpdatedAt)}` : ""}
          </p>
          <div className="platform-grid-2">
            <div className="platform-field">
              <label>課金ステータス（billingStatus）</label>
              <select
                value={editBillingStatus}
                onChange={(e) => setEditBillingStatus(e.target.value as BillingStatus)}
              >
                {BILLING_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="platform-field">
              <label>利用期限（paidThroughAt）</label>
              <input
                type="datetime-local"
                value={editPaidThrough}
                onChange={(e) => setEditPaidThrough(e.target.value)}
              />
              <button
                type="button"
                className="platform-btn platform-btn--ghost platform-btn--xs"
                onClick={() => setEditPaidThrough("")}
              >
                クリア
              </button>
            </div>
            <div className="platform-field">
              <label>トライアル終了（trialEndsAt）</label>
              <input
                type="datetime-local"
                value={editTrialEnds}
                onChange={(e) => setEditTrialEnds(e.target.value)}
              />
              <button
                type="button"
                className="platform-btn platform-btn--ghost platform-btn--xs"
                onClick={() => setEditTrialEnds("")}
              >
                クリア
              </button>
            </div>
          </div>
          <div className="platform-actions platform-actions--compact">
            <button
              type="button"
              className="platform-btn platform-btn--primary"
              disabled={billingBusy}
              onClick={() => void saveBilling()}
            >
              {billingBusy ? "保存中…" : "課金情報を保存"}
            </button>
            <button
              type="button"
              className="platform-btn platform-btn--ghost"
              disabled={billingBusy}
              onClick={() => {
                setEditBillingStatus("EXPIRED");
                setEditPaidThrough("");
              }}
            >
              期限切れにする
            </button>
            <button
              type="button"
              className="platform-btn platform-btn--ghost"
              disabled={billingBusy}
              onClick={() => {
                const d = new Date();
                d.setFullYear(d.getFullYear() + 1);
                setEditBillingStatus("ACTIVE");
                setEditPaidThrough(toDatetimeLocalValue(d.toISOString()));
              }}
            >
              有料化（1年）
            </button>
          </div>

          <h3 className="platform-detail-subhead">基本情報</h3>
          <div className="platform-grid-2">
            <div className="platform-field">
              <label>表示名（テナント名）</label>
              <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="platform-field">
              <label>屋号・商号</label>
              <input type="text" value={editTradeName} onChange={(e) => setEditTradeName(e.target.value)} />
            </div>
            <div className="platform-field">
              <label>電話</label>
              <input type="tel" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
            </div>
            <div className="platform-field">
              <label>プラン（保存で新規サブスクリプションを追加）</label>
              <select value={editPlan} onChange={(e) => setEditPlan(e.target.value)}>
                <option value="FREE">FREE</option>
                <option value="STANDARD">STANDARD</option>
                <option value="PREMIUM">PREMIUM</option>
              </select>
            </div>
          </div>
          <div className="platform-field">
            <label>ログインユーザー</label>
            <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
              {detail.users.map((u) => (
                <li key={u.id}>
                  {u.email}
                  {u.displayName ? `（${u.displayName}）` : ""}
                </li>
              ))}
            </ul>
          </div>
          <div className="platform-actions">
            <button type="button" className="platform-btn platform-btn--primary" disabled={busy} onClick={() => void saveTenant()}>
              保存
            </button>
            <a className="platform-btn platform-btn--ghost" href={`/app/login`}>
              ログイン画面へ
            </a>
          </div>
        </section>
      ) : null}
    </div>
  );
}

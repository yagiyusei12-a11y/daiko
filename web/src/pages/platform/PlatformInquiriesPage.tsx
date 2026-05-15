import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { Err } from "../../ui";

type InquiryRow = {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string | null;
  message: string;
  status: string;
  adminNotes: string | null;
  emailNotifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function statusBadge(status: string): string {
  if (status === "IN_PROGRESS") return "platform-badge platform-badge--progress";
  if (status === "CLOSED") return "platform-badge platform-badge--closed";
  return "platform-badge platform-badge--open";
}

function statusLabel(status: string): string {
  if (status === "IN_PROGRESS") return "対応中";
  if (status === "CLOSED") return "完了";
  return "未対応";
}

function formatDt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export default function PlatformInquiriesPage(): JSX.Element {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<InquiryRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState("OPEN");
  const [editNotes, setEditNotes] = useState("");

  const load = useCallback(async () => {
    setErr(null);
    const q = new URLSearchParams({ page: String(page), limit: "30" });
    if (statusFilter) q.set("status", statusFilter);
    const r = await apiFetch<{
      items: InquiryRow[];
      totalPages: number;
    }>(`/platform/inquiries?${q}`);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setItems(r.data.items);
    setTotalPages(r.data.totalPages);
  }, [page, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = items.find((x) => x.id === selectedId) ?? null;

  useEffect(() => {
    if (selected) {
      setEditStatus(selected.status);
      setEditNotes(selected.adminNotes ?? "");
    }
  }, [selected]);

  async function saveDetail(): Promise<void> {
    if (!selectedId) return;
    setBusy(true);
    setErr(null);
    const r = await apiFetch<{ inquiry: { id: string } }>(`/platform/inquiries/${selectedId}`, {
      method: "PATCH",
      json: { status: editStatus, adminNotes: editNotes },
    });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    await load();
  }

  return (
    <div>
      <header className="platform-page-head">
        <h1>お問い合わせ（LP）</h1>
        <p>紹介サイトから届いた問い合わせの確認・ステータス管理</p>
      </header>

      {err ? <Err msg={err} /> : null}

      <div className="platform-toolbar">
        <label>
          ステータス{" "}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">すべて</option>
            <option value="OPEN">未対応</option>
            <option value="IN_PROGRESS">対応中</option>
            <option value="CLOSED">完了</option>
          </select>
        </label>
        <button type="button" className="platform-btn platform-btn--ghost" onClick={() => void load()}>
          再読み込み
        </button>
      </div>

      <div className="platform-table-wrap">
        <table className="platform-table">
          <thead>
            <tr>
              <th>日時</th>
              <th>店舗・会社</th>
              <th>担当者</th>
              <th>メール</th>
              <th>状態</th>
              <th>通知</th>
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
                <td>{formatDt(row.createdAt)}</td>
                <td>{row.companyName}</td>
                <td>{row.contactName}</td>
                <td>
                  <a href={`mailto:${row.email}`} onClick={(e) => e.stopPropagation()}>
                    {row.email}
                  </a>
                </td>
                <td>
                  <span className={statusBadge(row.status)}>{statusLabel(row.status)}</span>
                </td>
                <td>{row.emailNotifiedAt ? "送信済" : "—"}</td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={6}>問い合わせはありません</td>
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

      {selected ? (
        <section className="platform-detail" aria-label="問い合わせ詳細">
          <h2>{selected.companyName}</h2>
          <div className="platform-grid-2">
            <div className="platform-field">
              <label>お名前</label>
              <p>{selected.contactName}</p>
            </div>
            <div className="platform-field">
              <label>電話</label>
              <p>{selected.phone || "—"}</p>
            </div>
          </div>
          <div className="platform-field">
            <label>お問い合わせ内容</label>
            <p style={{ whiteSpace: "pre-wrap" }}>{selected.message}</p>
          </div>
          <div className="platform-grid-2">
            <div className="platform-field">
              <label>ステータス</label>
              <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                <option value="OPEN">未対応</option>
                <option value="IN_PROGRESS">対応中</option>
                <option value="CLOSED">完了</option>
              </select>
            </div>
            <div className="platform-field">
              <label>メール通知</label>
              <p>{selected.emailNotifiedAt ? formatDt(selected.emailNotifiedAt) : "未送信（SMTP未設定など）"}</p>
            </div>
          </div>
          <div className="platform-field">
            <label>管理者メモ</label>
            <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
          </div>
          <div className="platform-actions">
            <button type="button" className="platform-btn platform-btn--primary" disabled={busy} onClick={() => void saveDetail()}>
              保存
            </button>
            <a className="platform-btn platform-btn--ghost" href={`mailto:${selected.email}`}>
              メールで返信
            </a>
          </div>
        </section>
      ) : null}
    </div>
  );
}

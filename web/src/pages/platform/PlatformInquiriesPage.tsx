import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../../api";
import { Err } from "../../ui";

type InquiryReply = {
  id: string;
  subject: string;
  bodyText: string;
  sentAt: string;
  sentByEmail: string;
};

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
  lastRepliedAt: string | null;
  createdAt: string;
  updatedAt: string;
  replies?: InquiryReply[];
};

function statusBadge(status: string): string {
  if (status === "IN_PROGRESS") return "platform-badge platform-badge--progress";
  if (status === "CLOSED") return "platform-badge platform-badge--closed";
  return "platform-badge platform-badge--open";
}

function statusLabel(status: string): string {
  if (status === "IN_PROGRESS") return "対応中";
  if (status === "CLOSED") return "対応済";
  return "未対応";
}

function formatDt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

function defaultReplySubject(companyName: string): string {
  return `Re: 【Daiko】お問い合わせ: ${companyName}`;
}

export default function PlatformInquiriesPage(): JSX.Element {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<InquiryRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InquiryRow | null>(null);
  const [editStatus, setEditStatus] = useState("OPEN");
  const [editNotes, setEditNotes] = useState("");
  const [replyOpen, setReplyOpen] = useState(false);
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const detailRef = useRef<HTMLElement | null>(null);

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

  const loadDetail = useCallback(async (id: string) => {
    setErr(null);
    const r = await apiFetch<{ inquiry: InquiryRow }>(`/platform/inquiries/${id}`);
    if (!r.ok) {
      setErr(r.error);
      setDetail(null);
      return;
    }
    setDetail(r.data.inquiry);
    setEditStatus(r.data.inquiry.status);
    setEditNotes(r.data.inquiry.adminNotes ?? "");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else {
      setDetail(null);
    }
  }, [selectedId, loadDetail]);

  function selectInquiry(id: string): void {
    setSelectedId(id);
  }

  function beginReply(row: InquiryRow, e?: React.MouseEvent): void {
    e?.stopPropagation();
    setSelectedId(row.id);
    setReplySubject(defaultReplySubject(row.companyName));
    setReplyBody("");
    setReplyOpen(true);
    void loadDetail(row.id);
  }

  function openReplyModal(): void {
    if (!detail) return;
    setReplySubject(defaultReplySubject(detail.companyName));
    setReplyBody("");
    setReplyOpen(true);
  }

  async function saveDetail(): Promise<void> {
    if (!selectedId) return;
    setBusy(true);
    setErr(null);
    const r = await apiFetch<{ inquiry: InquiryRow }>(`/platform/inquiries/${selectedId}`, {
      method: "PATCH",
      json: { status: editStatus, adminNotes: editNotes },
    });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    await load();
    await loadDetail(selectedId);
  }

  async function sendReply(): Promise<void> {
    if (!selectedId || !replyBody.trim()) return;
    setBusy(true);
    setErr(null);
    const r = await apiFetch<{ inquiry: InquiryRow }>(`/platform/inquiries/${selectedId}/reply`, {
      method: "POST",
      json: { subject: replySubject.trim(), bodyText: replyBody.trim() },
    });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setReplyOpen(false);
    setDetail(r.data.inquiry);
    setEditStatus(r.data.inquiry.status);
    await load();
  }

  async function deleteInquiry(): Promise<void> {
    if (!selectedId || !detail) return;
    const ok = window.confirm(
      `「${detail.companyName}」の問い合わせを削除します。この操作は取り消せません。よろしいですか？`,
    );
    if (!ok) return;
    setBusy(true);
    setErr(null);
    const r = await apiFetch<{ ok: boolean }>(`/platform/inquiries/${selectedId}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setSelectedId(null);
    setDetail(null);
    await load();
  }

  return (
    <div>
      <header className="platform-page-head">
        <h1>お問い合わせ（LP）</h1>
        <p>
          一覧の「返信」または行をクリックして詳細を開き、<strong>メール返信</strong>
          からお客様へ送信できます（メールアプリではなくこの画面から送れます）。
        </p>
      </header>

      {err ? <Err msg={err} /> : null}

      <div className="platform-inquiry-layout">
      <div>
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
            <option value="CLOSED">対応済</option>
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
              <th>最終返信</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr
                key={row.id}
                className={row.id === selectedId ? "is-selected" : undefined}
                style={{ cursor: "pointer" }}
                onClick={() => selectInquiry(row.id)}
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
                <td>{row.lastRepliedAt ? formatDt(row.lastRepliedAt) : "—"}</td>
                <td>
                  <button
                    type="button"
                    className="platform-btn platform-btn--primary"
                    onClick={(e) => beginReply(row, e)}
                  >
                    返信
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={7}>問い合わせはありません</td>
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

      {!detail ? (
        <p className="platform-callout">問い合わせを選択するか、一覧の「返信」を押してメール送信を開始してください。</p>
      ) : null}
      </div>

      {detail ? (
        <section ref={detailRef} className="platform-detail" aria-label="問い合わせ詳細">
          <h2>{detail.companyName}</h2>
          <div className="platform-grid-2">
            <div className="platform-field">
              <label>お名前</label>
              <p>{detail.contactName}</p>
            </div>
            <div className="platform-field">
              <label>電話</label>
              <p>{detail.phone || "—"}</p>
            </div>
          </div>
          <div className="platform-field">
            <label>メール</label>
            <p>
              <a href={`mailto:${detail.email}`}>{detail.email}</a>
            </p>
          </div>
          <div className="platform-field">
            <label>お問い合わせ内容</label>
            <p style={{ whiteSpace: "pre-wrap" }}>{detail.message}</p>
          </div>
          <div className="platform-grid-2">
            <div className="platform-field">
              <label>ステータス</label>
              <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                <option value="OPEN">未対応</option>
                <option value="IN_PROGRESS">対応中</option>
                <option value="CLOSED">対応済</option>
              </select>
            </div>
            <div className="platform-field">
              <label>管理者への通知メール</label>
              <p>{detail.emailNotifiedAt ? formatDt(detail.emailNotifiedAt) : "未送信（SMTP未設定など）"}</p>
            </div>
          </div>
          <div className="platform-field">
            <label>管理者メモ</label>
            <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
          </div>

          {detail.replies && detail.replies.length > 0 ? (
            <div className="platform-replies">
              <h3>返信履歴</h3>
              <ul>
                {detail.replies.map((rep) => (
                  <li key={rep.id} className="platform-reply-item">
                    <div className="platform-reply-meta">
                      <strong>{formatDt(rep.sentAt)}</strong>
                      <span>{rep.sentByEmail}</span>
                    </div>
                    <p className="platform-reply-subject">{rep.subject}</p>
                    <pre className="platform-reply-body">{rep.bodyText}</pre>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="platform-actions platform-actions--sticky">
            <button type="button" className="platform-btn platform-btn--primary" disabled={busy} onClick={openReplyModal}>
              メール返信
            </button>
            <button type="button" className="platform-btn platform-btn--ghost" disabled={busy} onClick={() => void saveDetail()}>
              ステータス・メモを保存
            </button>
            <button type="button" className="platform-btn platform-btn--danger" disabled={busy} onClick={() => void deleteInquiry()}>
              削除
            </button>
          </div>
        </section>
      ) : (
        <section className="platform-detail platform-detail--empty" aria-label="問い合わせ詳細">
          <h2>詳細</h2>
          <p className="platform-hint">左の一覧から問い合わせを選ぶか、「返信」を押すと内容の確認とメール送信ができます。</p>
        </section>
      )}
      </div>

      {replyOpen && (detail ?? items.find((x) => x.id === selectedId)) ? (
        <div className="platform-modal-backdrop" role="presentation" onClick={() => !busy && setReplyOpen(false)}>
          <div
            className="platform-modal"
            role="dialog"
            aria-labelledby="reply-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="reply-modal-title">
              メール返信 — {(detail ?? items.find((x) => x.id === selectedId))!.contactName} 様
            </h2>
            <p className="platform-hint">
              送信先: {(detail ?? items.find((x) => x.id === selectedId))!.email}
              （送信後、ステータスは「対応済」になります）
            </p>
            <div className="platform-field">
              <label htmlFor="reply-subject">件名</label>
              <input
                id="reply-subject"
                type="text"
                value={replySubject}
                onChange={(e) => setReplySubject(e.target.value)}
              />
            </div>
            <div className="platform-field">
              <label htmlFor="reply-body">本文</label>
              <textarea id="reply-body" rows={10} value={replyBody} onChange={(e) => setReplyBody(e.target.value)} />
            </div>
            <div className="platform-actions">
              <button type="button" className="platform-btn platform-btn--primary" disabled={busy || !replyBody.trim()} onClick={() => void sendReply()}>
                送信
              </button>
              <button type="button" className="platform-btn platform-btn--ghost" disabled={busy} onClick={() => setReplyOpen(false)}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

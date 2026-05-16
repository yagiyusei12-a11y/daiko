import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { Err } from "../../ui";

export default function PlatformSettingsPage(): JSX.Element {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const load = useCallback(async () => {
    setErr(null);
    const r = await apiFetch<{ subject: string; body: string }>("/platform/settings/inquiry-auto-reply");
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setSubject(r.data.subject);
    setBody(r.data.body);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(): Promise<void> {
    setBusy(true);
    setErr(null);
    setSaved(false);
    const r = await apiFetch<{ subject: string; body: string }>("/platform/settings/inquiry-auto-reply", {
      method: "PUT",
      json: { subject, body },
    });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setSubject(r.data.subject);
    setBody(r.data.body);
    setSaved(true);
  }

  return (
    <div>
      <header className="platform-page-head">
        <h1>システム設定</h1>
        <p>LP お問い合わせ受付時に送信される自動返信メールのテンプレート</p>
      </header>

      {err ? <Err msg={err} /> : null}
      {saved ? <p className="platform-hint platform-hint--ok">保存しました</p> : null}

      <section className="platform-detail">
        <div className="platform-field">
          <label htmlFor="auto-reply-subject">件名</label>
          <input
            id="auto-reply-subject"
            type="text"
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              setSaved(false);
            }}
          />
        </div>
        <div className="platform-field">
          <label htmlFor="auto-reply-body">本文（プレーンテキスト）</label>
          <textarea
            id="auto-reply-body"
            value={body}
            rows={14}
            onChange={(e) => {
              setBody(e.target.value);
              setSaved(false);
            }}
          />
        </div>
        <p className="platform-hint">
          利用可能なプレースホルダ: <code>{"{{contactName}}"}</code>（お名前）、{" "}
          <code>{"{{companyName}}"}</code>（店舗・会社名）
        </p>
        <div className="platform-actions">
          <button type="button" className="platform-btn platform-btn--primary" disabled={busy} onClick={() => void save()}>
            保存
          </button>
          <button type="button" className="platform-btn platform-btn--ghost" disabled={busy} onClick={() => void load()}>
            再読み込み
          </button>
        </div>
      </section>
    </div>
  );
}

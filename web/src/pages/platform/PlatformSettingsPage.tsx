import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { Err } from "../../ui";

type PlaceholderInfo = {
  tag: string;
  label: string;
  description: string;
};

function SettingsActions({
  busy,
  onSave,
  onReload,
}: {
  busy: boolean;
  onSave: () => void;
  onReload: () => void;
}): JSX.Element {
  return (
    <>
      <button type="button" className="platform-btn platform-btn--primary" disabled={busy} onClick={onSave}>
        保存
      </button>
      <button type="button" className="platform-btn platform-btn--ghost" disabled={busy} onClick={onReload}>
        再読み込み
      </button>
    </>
  );
}

export default function PlatformSettingsPage(): JSX.Element {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [placeholders, setPlaceholders] = useState<PlaceholderInfo[]>([]);

  const load = useCallback(async () => {
    setErr(null);
    const r = await apiFetch<{
      subject: string;
      body: string;
      placeholders?: PlaceholderInfo[];
    }>("/platform/settings/inquiry-auto-reply");
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setSubject(r.data.subject);
    setBody(r.data.body);
    setPlaceholders(r.data.placeholders ?? []);
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

  const actionProps = {
    busy,
    onSave: () => void save(),
    onReload: () => void load(),
  };

  return (
    <div>
      <header className="platform-page-head">
        <h1>システム設定</h1>
        <p>LP お問い合わせ受付時に送信される自動返信メールのテンプレート</p>
      </header>

      {err ? <Err msg={err} /> : null}
      {saved ? <p className="platform-hint platform-hint--ok">保存しました</p> : null}

      <section className="platform-detail">
        <div className="platform-actions platform-actions--top">
          <SettingsActions {...actionProps} />
        </div>

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
        <div className="platform-placeholders">
          <p className="platform-placeholders-title">利用可能なプレースホルダ（件名・本文のどちらでも利用可）</p>
          <ul>
            {placeholders.map((p) => (
              <li key={p.tag}>
                <code>{p.tag}</code>
                <span className="platform-placeholders-label">{p.label}</span>
                <span className="platform-placeholders-desc">{p.description}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="platform-actions platform-actions--sticky">
          <SettingsActions {...actionProps} />
        </div>
      </section>
    </div>
  );
}

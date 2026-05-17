import { useState } from "react";
import { apiFetch } from "../../api";
import { Card, Err } from "../../ui";

type GenerateResponse = {
  keys: string[];
  validDays: number;
  quantity: number;
  batchLabel: string | null;
  note: string | null;
};

export default function PlatformLicensesPage(): JSX.Element {
  const [validDays, setValidDays] = useState("30");
  const [quantity, setQuantity] = useState("5");
  const [batchLabel, setBatchLabel] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [generated, setGenerated] = useState<GenerateResponse | null>(null);
  const [copied, setCopied] = useState(false);

  async function onGenerate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    setCopied(false);
    setBusy(true);
    const r = await apiFetch<GenerateResponse>("/platform/license/generate", {
      method: "POST",
      json: {
        validDays: Number(validDays),
        quantity: Number(quantity),
        batchLabel: batchLabel.trim() || undefined,
        note: note.trim() || undefined,
      },
    });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      setGenerated(null);
      return;
    }
    setGenerated(r.data);
  }

  async function copyAllKeys(): Promise<void> {
    if (!generated?.keys.length) return;
    const text = generated.keys.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErr("クリップボードへのコピーに失敗しました");
    }
  }

  return (
    <div>
      <header className="platform-page-head">
        <h1>ライセンスキー発行</h1>
        <p>
          有効日数と発行枚数を指定してシリアルコードを生成します。平文キーはこの画面でのみ表示されます（再表示できません）。
        </p>
      </header>

      <Card title="新規発行">
        <form className="platform-license-form" onSubmit={(e) => void onGenerate(e)}>
          <label htmlFor="lic-valid-days">有効日数（利用延長日数）</label>
          <input
            id="lic-valid-days"
            type="number"
            min={1}
            max={3650}
            value={validDays}
            onChange={(e) => setValidDays(e.target.value)}
            required
          />
          <label htmlFor="lic-quantity">発行枚数</label>
          <input
            id="lic-quantity"
            type="number"
            min={1}
            max={100}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
          <label htmlFor="lic-batch">バッチラベル（任意）</label>
          <input
            id="lic-batch"
            type="text"
            value={batchLabel}
            onChange={(e) => setBatchLabel(e.target.value)}
            placeholder="例: 2026-05-campaign"
          />
          <label htmlFor="lic-note">メモ（任意）</label>
          <input id="lic-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} />
          <Err msg={err} />
          <button type="submit" disabled={busy}>
            {busy ? "発行中…" : "ライセンスキーを生成"}
          </button>
        </form>
      </Card>

      {generated ? (
        <Card title={`発行結果（${generated.keys.length} 件）`}>
          <p className="platform-license-meta">
            有効日数: {generated.validDays} 日
            {generated.batchLabel ? ` · バッチ: ${generated.batchLabel}` : ""}
          </p>
          <div className="platform-license-actions">
            <button type="button" onClick={() => void copyAllKeys()}>
              {copied ? "コピーしました" : "一覧をクリップボードにコピー"}
            </button>
          </div>
          <textarea
            className="platform-license-keys"
            readOnly
            rows={Math.min(16, Math.max(4, generated.keys.length + 1))}
            value={generated.keys.join("\n")}
            aria-label="発行されたライセンスキー"
          />
        </Card>
      ) : null}
    </div>
  );
}

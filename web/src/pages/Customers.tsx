import { useEffect, useState } from "react";
import { apiFetch, getAccessToken } from "../api";
import { Card, Err, FieldWithHint, Tabs } from "../ui";
import { ReqMark } from "../lib/reqLabel";

type Customer = {
  id: string;
  displayName: string;
  phone: string | null;
  defaultOrigin: string;
  defaultDestination: string;
  defaultTariffVersionId: string | null;
  specialFareYen: number | null;
  notes: string | null;
};
type Ver = { id: string; version: number; planId: string };
type PlansRes = { plans: { id: string; versions: Ver[] }[] };

export default function Customers(): JSX.Element {
  const [rows, setRows] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [versions, setVersions] = useState<Ver[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [defaultOrigin, setDefaultOrigin] = useState("");
  const [defaultDestination, setDefaultDestination] = useState("");
  const [defaultTariffVersionId, setDefaultTariffVersionId] = useState("");
  const [specialFareYen, setSpecialFareYen] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [custTab, setCustTab] = useState<"register" | "search" | "list">("register");

  async function load(): Promise<void> {
    const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
    const r = await apiFetch<{ customers: Customer[] }>(`/customers${qs}`);
    if (r.ok) setRows(r.data.customers);
    else setErr(r.error);
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    void (async () => {
      const rp = await apiFetch<PlansRes>("/tariff-plans?versionsLimit=50");
      if (rp.ok) setVersions(rp.data.plans.flatMap((p) => p.versions));
    })();
  }, []);

  async function openPrint(): Promise<void> {
    const token = getAccessToken();
    const res = await fetch("/api/v1/customers/render-print", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const html = await res.text();
    const w = window.open("");
    if (w) {
      w.document.write(html);
      w.document.close();
      w.focus();
    }
  }

  async function addCustomer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      const json: Record<string, unknown> = {
        displayName: displayName.trim(),
        phone: phone.trim() || null,
        defaultOrigin: defaultOrigin.trim(),
        defaultDestination: defaultDestination.trim(),
        notes: notes.trim() || null,
      };
      if (defaultTariffVersionId) json.defaultTariffVersionId = defaultTariffVersionId;
      if (specialFareYen.trim() !== "") {
        const n = Math.floor(Number(specialFareYen));
        if (Number.isFinite(n) && n >= 0) json.specialFareYen = n;
      }
      const r = await apiFetch<Customer>("/customers", { method: "POST", json });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setDisplayName("");
      setPhone("");
      setDefaultOrigin("");
      setDefaultDestination("");
      setDefaultTariffVersionId("");
      setSpecialFareYen("");
      setNotes("");
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title="お客様リスト（送迎の相手）">
      <Err msg={err} />
      <p style={{ fontSize: "0.82rem", marginTop: 0 }}>
        よく乗るお客様を登録しておくと、日報や配車で同じ設定を繰り返し使えます。料金の「版」は料金ルール画面で作ったものから選びます。
      </p>
      <p style={{ marginTop: "0.35rem" }}>
        <button type="button" onClick={() => void openPrint()}>
          名簿の印刷用ページを開く
        </button>
      </p>
      <Tabs
        aria-label="お客様リストの操作"
        activeId={custTab}
        onActiveChange={(id) => setCustTab(id as "register" | "search" | "list")}
        items={[
          {
            id: "register",
            label: "新しく登録",
            children: (
              <form onSubmit={addCustomer} className="stack-form" style={{ marginTop: "0.35rem" }}>
                <FieldWithHint label={<><ReqMark />呼び名・表示名</>} hint="一覧や日報に出る名前です（屋号でも個人名でも構いません）。">
                  <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
                </FieldWithHint>
                <FieldWithHint label="電話番号" optional hint="連絡が取りやすい番号を入れておくと便利です。">
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} />
                </FieldWithHint>
                <FieldWithHint label="いつもの出発地" optional hint="よく迎えに行く場所のメモです。空欄でも登録できます。">
                  <input value={defaultOrigin} onChange={(e) => setDefaultOrigin(e.target.value)} />
                </FieldWithHint>
                <FieldWithHint label="いつもの到着地" optional hint="よくお送りする場所のメモです。">
                  <input value={defaultDestination} onChange={(e) => setDefaultDestination(e.target.value)} />
                </FieldWithHint>
                <FieldWithHint label="いつも使う料金セットの版" optional hint="料金ルールで作った「何番目の内容」かを選びます。空欄なら会社の標準に従います。">
                  <select value={defaultTariffVersionId} onChange={(e) => setDefaultTariffVersionId(e.target.value)}>
                    <option value="">指定なし</option>
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        版 {v.version}
                      </option>
                    ))}
                  </select>
                </FieldWithHint>
                <FieldWithHint label="特別に決めた運賃（円）" optional hint="このお客様だけ固定の金額にしたいときに数字を入れます。空欄なら通常どおり計算します。">
                  <input value={specialFareYen} onChange={(e) => setSpecialFareYen(e.target.value)} inputMode="numeric" />
                </FieldWithHint>
                <FieldWithHint label="備考・メモ" optional hint="社内共有用のメモです。お客様には見えません。">
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
                </FieldWithHint>
                <button type="submit" disabled={submitting || !displayName.trim()}>
                  この内容で追加
                </button>
              </form>
            ),
          },
          {
            id: "search",
            label: "さがす",
            children: (
              <div style={{ marginTop: "0.35rem" }} className="stack-form">
                <FieldWithHint label="キーワード" hint="お名前や電話の一部でも検索できます。">
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="名前・電話" />
                </FieldWithHint>
                <button type="button" onClick={() => void load()}>
                  いまの条件でもう一度読み込む
                </button>
              </div>
            ),
          },
          {
            id: "list",
            label: "一覧",
            children: (
              <div className="table-wrap" style={{ marginTop: "0.35rem" }}>
                <table>
                  <thead>
                    <tr>
                      <th>表示名</th>
                      <th>電話</th>
                      <th>いつもの区間</th>
                      <th>特別運賃（円）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.id}>
                        <td>{c.displayName}</td>
                        <td>{c.phone ?? "—"}</td>
                        <td>
                          {c.defaultOrigin || "—"} → {c.defaultDestination || "—"}
                        </td>
                        <td>{c.specialFareYen ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ),
          },
        ]}
      />
    </Card>
  );
}

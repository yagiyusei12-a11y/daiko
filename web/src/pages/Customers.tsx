import { useEffect, useState } from "react";
import { apiFetch, getAccessToken } from "../api";
import { Card, Err } from "../ui";
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
    <>
      <Card title="顧客名簿">
        <Err msg={err} />
        <p style={{ marginTop: 0 }}>
          <button type="button" onClick={() => void openPrint()}>
            印刷用HTMLを開く
          </button>
        </p>
        <form onSubmit={addCustomer} className="stack-form">
          <label>
            表示名 <ReqMark />
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </label>
          <label>
            電話
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label>
            既定出発地
            <input value={defaultOrigin} onChange={(e) => setDefaultOrigin(e.target.value)} />
          </label>
          <label>
            既定到着地
            <input value={defaultDestination} onChange={(e) => setDefaultDestination(e.target.value)} />
          </label>
          <label>
            既定料金版
            <select value={defaultTariffVersionId} onChange={(e) => setDefaultTariffVersionId(e.target.value)}>
              <option value="">なし</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version}
                </option>
              ))}
            </select>
          </label>
          <label>
            特別運賃（円・空でなし）
            <input value={specialFareYen} onChange={(e) => setSpecialFareYen(e.target.value)} inputMode="numeric" />
          </label>
          <label>
            備考
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </label>
          <button type="submit" disabled={submitting || !displayName.trim()}>
            追加
          </button>
        </form>
      </Card>
      <Card title="検索">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="名前・電話" />
        <button type="button" onClick={() => void load()}>
          再検索
        </button>
      </Card>
      <Card title="一覧">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>表示名</th>
                <th>電話</th>
                <th>既定区間</th>
                <th>特別運賃</th>
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
      </Card>
    </>
  );
}

import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { Card, Err } from "../ui";
import { ReqMark } from "../lib/reqLabel";

type Row = { id: string; name: string; memo: string | null };

export default function ReferralSources(): JSX.Element {
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [memo, setMemo] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load(): Promise<void> {
    const r = await apiFetch<{ referralSources: Row[] }>("/referral-sources");
    if (r.ok) setRows(r.data.referralSources);
    else setErr(r.error);
  }

  useEffect(() => {
    void load();
  }, []);

  async function add(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      const r = await apiFetch<Row>("/referral-sources", {
        method: "POST",
        json: { name: name.trim(), memo: memo.trim() || null },
      });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setName("");
      setMemo("");
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Card title="紹介元（飲食店など）">
        <Err msg={err} />
        <form onSubmit={add} className="stack-form">
          <label>
            店名 <ReqMark />
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            メモ
            <input value={memo} onChange={(e) => setMemo(e.target.value)} />
          </label>
          <button type="submit" disabled={submitting || !name.trim()}>
            追加
          </button>
        </form>
      </Card>
      <Card title="一覧">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>名前</th>
                <th>メモ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.id}>
                  <td>{x.name}</td>
                  <td>{x.memo ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

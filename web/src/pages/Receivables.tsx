import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { Card, Err, FieldWithHint } from "../ui";
import { ReqMark } from "../lib/reqLabel";

type Entry = {
  id: string;
  partyName: string;
  amountYen: number;
  status: string;
  collectedAt: string | null;
  referenceNote: string | null;
};

export default function Receivables(): JSX.Element {
  const [rows, setRows] = useState<Entry[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [partyName, setPartyName] = useState("");
  const [amountYen, setAmountYen] = useState("");
  const [referenceNote, setReferenceNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load(): Promise<void> {
    const r = await apiFetch<{ entries: Entry[] }>("/accounts-receivable");
    if (r.ok) setRows(r.data.entries);
    else setErr(r.error);
  }

  useEffect(() => {
    void load();
  }, []);

  async function add(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    const n = Math.floor(Number(amountYen));
    if (!Number.isFinite(n) || n <= 0) {
      setErr("金額は正の整数で入力してください");
      return;
    }
    setSubmitting(true);
    try {
      const r = await apiFetch<Entry>("/accounts-receivable", {
        method: "POST",
        json: { partyName: partyName.trim(), amountYen: n, referenceNote: referenceNote.trim() || null },
      });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setPartyName("");
      setAmountYen("");
      setReferenceNote("");
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  async function markCollected(id: string): Promise<void> {
    setErr(null);
    const r = await apiFetch<Entry>(`/accounts-receivable/${id}`, {
      method: "PATCH",
      json: { status: "COLLECTED" },
    });
    if (!r.ok) setErr(r.error);
    else await load();
  }

  return (
    <>
      <Card title="まだもらっていないお金（売掛のメモ）">
        <Err msg={err} />
        <p style={{ fontSize: "0.82rem", marginTop: 0 }}>後から集金する予定の金額をメモしておきます。入金が済んだら「回収済み」に変えてください。</p>
        <form onSubmit={add} className="stack-form">
          <FieldWithHint label={<><ReqMark />相手先（名前）</>} hint="お店名や担当者名など、あとから見てわかる呼び方で構いません。">
            <input value={partyName} onChange={(e) => setPartyName(e.target.value)} required />
          </FieldWithHint>
          <FieldWithHint label={<><ReqMark />金額（円・税込みの目安）</>} hint="半角数字のまるめた円で入力します。">
            <input value={amountYen} onChange={(e) => setAmountYen(e.target.value)} inputMode="numeric" required />
          </FieldWithHint>
          <FieldWithHint label="参照メモ" optional hint="請求書番号や送迎の日付など、照合に使うメモです。">
            <input value={referenceNote} onChange={(e) => setReferenceNote(e.target.value)} />
          </FieldWithHint>
          <button type="submit" disabled={submitting || !partyName.trim()}>
            登録する
          </button>
        </form>
      </Card>
      <Card title="一覧（状態）">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>相手先</th>
                <th>金額</th>
                <th>状態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.id}>
                  <td>{x.partyName}</td>
                  <td>{x.amountYen}</td>
                  <td>{x.status}</td>
                  <td>
                    {x.status === "OPEN" ? (
                      <button type="button" onClick={() => void markCollected(x.id)}>
                        入金済みにする
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

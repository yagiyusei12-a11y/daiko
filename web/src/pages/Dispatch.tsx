import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { Card, Err, FieldWithHint } from "../ui";
import { ReqMark } from "../lib/reqLabel";

type V = { id: string; label: string };
type Resv = {
  id: string;
  title: string;
  note: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  vehicle: V | null;
};

function defaultFromIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function defaultToIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

export default function Dispatch(): JSX.Element {
  const [from, setFrom] = useState(defaultFromIso);
  const [to, setTo] = useState(defaultToIso);
  const [rows, setRows] = useState<Resv[]>([]);
  const [vehicles, setVehicles] = useState<V[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load(): Promise<void> {
    const r = await apiFetch<{ reservations: Resv[] }>(
      `/dispatch-reservations?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    if (r.ok) setRows(r.data.reservations);
    else setErr(r.error);
  }

  useEffect(() => {
    void (async () => {
      const v = await apiFetch<{ vehicles: V[] }>("/vehicles");
      if (v.ok) setVehicles(v.data.vehicles);
    })();
  }, []);

  useEffect(() => {
    void load();
  }, [from, to]);

  async function add(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    if (!startsAt || !endsAt) {
      setErr("開始・終了を入力してください");
      return;
    }
    setSubmitting(true);
    try {
      const r = await apiFetch<Resv>("/dispatch-reservations", {
        method: "POST",
        json: {
          title: title.trim(),
          note: note.trim() || null,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          vehicleId: vehicleId || null,
        },
      });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setTitle("");
      setNote("");
      setStartsAt("");
      setEndsAt("");
      setVehicleId("");
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Card title="配車の予定を一覧する">
        <Err msg={err} />
        <p style={{ opacity: 0.9, fontSize: "0.9rem" }}>この期間に入っている予約をまとめて見ます。下のフォームから予約を足せます。</p>
        <div className="stack-form">
          <FieldWithHint label="表示を始める日時" hint="内部的な形式（ISO）です。変更不要ならそのままで問題ありません。">
            <input value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: "100%", maxWidth: 420 }} />
          </FieldWithHint>
          <FieldWithHint label="表示を終える日時" hint="ここまでの予約が一覧に出ます。">
            <input value={to} onChange={(e) => setTo(e.target.value)} style={{ width: "100%", maxWidth: 420 }} />
          </FieldWithHint>
        </div>
        <button type="button" onClick={() => void load()}>
          いまの期間でもう一度読み込む
        </button>
      </Card>
      <Card title="予約を追加する">
        <form onSubmit={add} className="stack-form">
          <FieldWithHint label={<><ReqMark />件名・タイトル</>} hint="社内でわかる短い名前（例: 〇〇様 迎え）を付けます。">
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </FieldWithHint>
          <FieldWithHint label="メモ" optional hint="担当者への引き継ぎや注意事項があれば書きます。">
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </FieldWithHint>
          <FieldWithHint label="割り当てる車" optional hint="まだ決まっていなければ「未割当」のままで登録できます。">
            <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">未割当</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </FieldWithHint>
          <FieldWithHint label={<><ReqMark />始まる日時</>} hint="カレンダーと時刻から選びます。">
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
          </FieldWithHint>
          <FieldWithHint label={<><ReqMark />終わる日時</>} hint="迎えの予定なら、おおよその終了予定で構いません。">
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required />
          </FieldWithHint>
          <button type="submit" disabled={submitting || !title.trim()}>
            この内容で登録
          </button>
        </form>
      </Card>
      <Card title="一覧">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>開始</th>
                <th>終了</th>
                <th>件名</th>
                <th>車両</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.id}>
                  <td>{new Date(x.startsAt).toLocaleString()}</td>
                  <td>{new Date(x.endsAt).toLocaleString()}</td>
                  <td>{x.title}</td>
                  <td>{x.vehicle?.label ?? "—"}</td>
                  <td>{x.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

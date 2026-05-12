import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { Card, Err } from "../ui";
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
      <Card title="配車・予約（一覧）">
        <Err msg={err} />
        <p style={{ opacity: 0.85, fontSize: "0.95rem" }}>ガント前段として、期間内の予約を一覧表示・登録します。</p>
        <label>
          期間 from（ISO）
          <input value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: "100%", maxWidth: 420 }} />
        </label>
        <label>
          期間 to（ISO）
          <input value={to} onChange={(e) => setTo(e.target.value)} style={{ width: "100%", maxWidth: 420 }} />
        </label>
        <button type="button" onClick={() => void load()}>
          再読込
        </button>
      </Card>
      <Card title="予約を追加">
        <form onSubmit={add} className="stack-form">
          <label>
            件名 <ReqMark />
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label>
            メモ
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <label>
            車両
            <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">未割当</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            開始 <ReqMark />
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
          </label>
          <label>
            終了 <ReqMark />
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required />
          </label>
          <button type="submit" disabled={submitting || !title.trim()}>
            登録
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

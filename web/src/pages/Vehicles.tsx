import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { Card, Err, StepWizard, type StepWizardStep } from "../ui";

type V = {
  id: string;
  label: string;
  plate: string | null;
  active: boolean;
  legalCoverageStartOn: string | null;
};

function toYmd(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export default function Vehicles(): JSX.Element {
  const [rows, setRows] = useState<V[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [label, setLabel] = useState("");
  const [newPlate, setNewPlate] = useState("");
  const [newLegalStart, setNewLegalStart] = useState("");

  async function load(): Promise<void> {
    const r = await apiFetch<{ vehicles: V[] }>("/vehicles?active=0");
    if (r.ok) setRows(r.data.vehicles);
    else setErr(r.error);
  }

  useEffect(() => {
    void load();
  }, []);

  function resetAdd(): void {
    setLabel("");
    setNewPlate("");
    setNewLegalStart("");
  }

  function closeWizard(): void {
    setWizardOpen(false);
    resetAdd();
  }

  async function submitVehicle(): Promise<void> {
    setErr(null);
    setSubmitting(true);
    try {
      const json: Record<string, unknown> = { label: label.trim() };
      if (newPlate.trim()) json.plate = newPlate.trim();
      if (newLegalStart.trim()) json.legalCoverageStartOn = `${newLegalStart.trim()}T00:00:00.000Z`;
      const r = await apiFetch<V>("/vehicles", { method: "POST", json });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      resetAdd();
      setWizardOpen(false);
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  const labelOk = label.trim().length > 0;

  const steps: StepWizardStep[] = [
    {
      id: "label",
      title: "表示名を入力してください",
      description: "一覧や日報で表示される車両名です（必須）。",
      canProceed: labelOk,
      children: (
        <>
          <label>表示名</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
        </>
      ),
    },
    {
      id: "extra",
      title: "ナンバーと補償開始日（任意）",
      description: "わかる範囲で入力してください。後から編集できます。",
      children: (
        <>
          <label>ナンバー（任意）</label>
          <input value={newPlate} onChange={(e) => setNewPlate(e.target.value)} />
          <label>補償開始日（任意・YYYY-MM-DD）</label>
          <input type="date" value={newLegalStart} onChange={(e) => setNewLegalStart(e.target.value)} />
        </>
      ),
    },
    {
      id: "confirm",
      title: "内容を確認してください",
      canProceed: labelOk,
      children: (
        <dl className="step-wizard-summary">
          <dt>表示名</dt>
          <dd>{label.trim()}</dd>
          <dt>ナンバー</dt>
          <dd>{newPlate.trim() || "—"}</dd>
          <dt>補償開始日</dt>
          <dd>{newLegalStart.trim() || "—"}</dd>
        </dl>
      ),
    },
  ];

  async function toggleActive(v: V): Promise<void> {
    setErr(null);
    const r = await apiFetch(`/vehicles/${v.id}`, { method: "PATCH", json: { active: !v.active } });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else await load();
  }

  async function saveVehicle(v: V, plate: string, legalYmd: string): Promise<void> {
    setErr(null);
    const json: Record<string, unknown> = {
      plate: plate.trim() || null,
      legalCoverageStartOn: legalYmd.trim() ? `${legalYmd.trim()}T00:00:00.000Z` : null,
    };
    const r = await apiFetch(`/vehicles/${v.id}`, { method: "PATCH", json });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else await load();
  }

  return (
    <Card title="車両">
      <Err msg={err} />
      <p style={{ marginTop: 0 }}>
        <button type="button" onClick={() => setWizardOpen(true)}>
          車両を追加
        </button>
      </p>
      <StepWizard
        open={wizardOpen}
        onClose={closeWizard}
        title="車両を追加"
        steps={steps}
        finishLabel="登録する"
        onFinish={submitVehicle}
        isSubmitting={submitting}
      />
      <div className="table-wrap">
        <table style={{ fontSize: "0.88rem", borderCollapse: "collapse", minWidth: 560 }}>
          <thead>
            <tr>
              <th style={{ border: "1px solid #ccc", padding: 6, textAlign: "left" }}>名称</th>
              <th style={{ border: "1px solid #ccc", padding: 6, textAlign: "left" }}>ナンバー</th>
              <th style={{ border: "1px solid #ccc", padding: 6 }}>補償開始日</th>
              <th style={{ border: "1px solid #ccc", padding: 6 }}>有効</th>
              <th style={{ border: "1px solid #ccc", padding: 6 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <VehicleRow key={x.id} v={x} onSave={saveVehicle} onToggle={() => void toggleActive(x)} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function VehicleRow({
  v,
  onSave,
  onToggle,
}: {
  v: V;
  onSave: (v: V, plate: string, legalYmd: string) => void;
  onToggle: () => void;
}): JSX.Element {
  const [plate, setPlate] = useState(v.plate ?? "");
  const [legalYmd, setLegalYmd] = useState(toYmd(v.legalCoverageStartOn));

  useEffect(() => {
    setPlate(v.plate ?? "");
    setLegalYmd(toYmd(v.legalCoverageStartOn));
  }, [v.id, v.plate, v.legalCoverageStartOn]);

  return (
    <tr>
      <td style={{ border: "1px solid #ccc", padding: 6 }}>{v.label}</td>
      <td style={{ border: "1px solid #ccc", padding: 6 }}>
        <input value={plate} onChange={(e) => setPlate(e.target.value)} style={{ width: "100%", minWidth: 100 }} />
      </td>
      <td style={{ border: "1px solid #ccc", padding: 6 }}>
        <input type="date" value={legalYmd} onChange={(e) => setLegalYmd(e.target.value)} />
      </td>
      <td style={{ border: "1px solid #ccc", padding: 6 }}>{v.active ? "はい" : "いいえ"}</td>
      <td style={{ border: "1px solid #ccc", padding: 6 }}>
        <button type="button" onClick={() => onSave(v, plate, legalYmd)}>
          保存
        </button>{" "}
        <button type="button" onClick={onToggle}>
          {v.active ? "無効化" : "有効化"}
        </button>
      </td>
    </tr>
  );
}

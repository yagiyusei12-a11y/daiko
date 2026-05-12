import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { ReqMark } from "../lib/reqLabel";
import { Card, Err, FieldWithHint, StepWizard, type StepWizardStep } from "../ui";

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

function ymdOk(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
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
      const json = {
        label: label.trim(),
        plate: newPlate.trim(),
        legalCoverageStartOn: `${newLegalStart.trim()}T00:00:00.000Z`,
      };
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
  const plateAndLegalOk = newPlate.trim().length > 0 && ymdOk(newLegalStart);
  const allOk = labelOk && plateAndLegalOk;

  const steps: StepWizardStep[] = [
    {
      id: "label",
      title: "車の呼び名",
      description: "一覧や業務の記録に出る名前です。同乗の車（随伴車）として法令の届出にも使う社内の呼び方で構いません。",
      canProceed: labelOk,
      children: (
        <>
          <FieldWithHint label={<><ReqMark />表示名</>} hint="例: ハイエース1号。現場で通じる名前を付けてください。">
            <input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus required aria-required />
          </FieldWithHint>
        </>
      ),
    },
    {
      id: "plate_legal",
      title: "ナンバーと保険の始まり",
      description:
        "ナンバープレートの表記と、保険（自賠責など）がいつから有効かを記録します。乗務記録や届出書類の「同乗の車」欄に対応します。",
      canProceed: plateAndLegalOk,
      children: (
        <>
          <FieldWithHint label={<><ReqMark />ナンバー（登録番号）</>} hint="例: 品川300あ1234。届出や記録簿にそのまま使います。">
            <input
              value={newPlate}
              onChange={(e) => setNewPlate(e.target.value)}
              placeholder="例: 品川300あ1234"
              required
              aria-required
            />
          </FieldWithHint>
          <FieldWithHint label={<><ReqMark />補償が始まった日</>} hint="自賠責など、裏面や証券で確認できる「始まりの日」を選びます。">
            <input type="date" value={newLegalStart} onChange={(e) => setNewLegalStart(e.target.value)} required aria-required />
          </FieldWithHint>
        </>
      ),
    },
    {
      id: "confirm",
      title: "入力内容の確認",
      canProceed: allOk,
      children: (
        <dl className="step-wizard-summary">
          <dt>表示名</dt>
          <dd>{label.trim()}</dd>
          <dt>ナンバー（登録番号等）</dt>
          <dd>{newPlate.trim()}</dd>
          <dt>補償が始まった日</dt>
          <dd>{newLegalStart.trim()}</dd>
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
    if (!plate.trim()) {
      setErr("ナンバー（登録番号等）を入力してください。");
      return;
    }
    if (!legalYmd.trim() || !ymdOk(legalYmd)) {
      setErr("補償開始日を正しく入力してください。");
      return;
    }
    const json: Record<string, unknown> = {
      plate: plate.trim(),
      legalCoverageStartOn: `${legalYmd.trim()}T00:00:00.000Z`,
    };
    const r = await apiFetch(`/vehicles/${v.id}`, { method: "PATCH", json });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else await load();
  }

  async function removeVehicle(id: string, displayName: string): Promise<void> {
    if (!window.confirm(`「${displayName}」を削除します。取り消せません。よろしいですか？`)) return;
    setErr(null);
    const r = await apiFetch<unknown>(`/vehicles/${id}`, { method: "DELETE" });
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    await load();
  }

  return (
    <Card title="送迎で使う車">
      <Err msg={err} />
      <p style={{ fontSize: "0.82rem", marginTop: 0 }}>
        お客様の送迎に使う車を登録します。新規では「呼び名・ナンバー・保険の始まりの日」が必要です。お客様の送迎の記録に載せた車は削除できません。同乗の車として届出に使う情報とそろえてください。
      </p>
      <p style={{ marginTop: "0.5rem" }}>
        <button type="button" onClick={() => setWizardOpen(true)}>
          車を追加（ガイド付き）
        </button>
      </p>
      <StepWizard
        open={wizardOpen}
        onClose={closeWizard}
        title="車を登録する"
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
              <th style={{ border: "1px solid #ccc", padding: 6, textAlign: "left" }}>
                <ReqMark />
                ナンバー（登録番号等）
              </th>
              <th style={{ border: "1px solid #ccc", padding: 6 }}>
                <ReqMark />
                補償開始日
              </th>
              <th style={{ border: "1px solid #ccc", padding: 6 }}>有効</th>
              <th style={{ border: "1px solid #ccc", padding: 6 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <VehicleRow
                key={x.id}
                v={x}
                onSave={saveVehicle}
                onToggle={() => void toggleActive(x)}
                onDelete={() => void removeVehicle(x.id, x.label)}
              />
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
  onDelete,
}: {
  v: V;
  onSave: (v: V, plate: string, legalYmd: string) => void;
  onToggle: () => void;
  onDelete: () => void;
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
        </button>{" "}
        <button type="button" onClick={onDelete} style={{ color: "#b00020" }}>
          削除
        </button>
      </td>
    </tr>
  );
}

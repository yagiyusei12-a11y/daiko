import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { Card, Err, FieldWithHint, StepWizard, type StepWizardStep } from "../ui";

type Emp = { id: string; familyName: string; givenName: string };
type Check = {
  id: string;
  businessDate: string;
  phase: string;
  checkedAt: string;
  detectorUsed: boolean;
  resultPositive: boolean;
  employee: Emp;
};

export default function Alcohol(): JSX.Element {
  const [checks, setChecks] = useState<Check[]>([]);
  const [emps, setEmps] = useState<Emp[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [businessDate, setBusinessDate] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [phase, setPhase] = useState("出勤前");

  async function load(): Promise<void> {
    const qs = businessDate ? `?businessDate=${encodeURIComponent(businessDate)}` : "";
    const r = await apiFetch<{ checks: Check[] }>(`/alcohol-checks${qs}`);
    if (r.ok) setChecks(r.data.checks);
    else setErr(r.error);
  }

  useEffect(() => {
    void (async () => {
      const r = await apiFetch<{ employees: Emp[] }>("/employees");
      if (r.ok) {
        setEmps(r.data.employees);
        if (r.data.employees[0]) setEmployeeId(r.data.employees[0].id);
      }
    })();
  }, []);

  useEffect(() => {
    void load();
  }, [businessDate]);

  function closeWizard(): void {
    setWizardOpen(false);
    setPhase("出勤前");
    if (emps[0]) setEmployeeId(emps[0].id);
  }

  async function submitCheck(): Promise<void> {
    setErr(null);
    setSubmitting(true);
    try {
      const r = await apiFetch<Check>("/alcohol-checks", {
        method: "POST",
        json: { employeeId, phase, detectorUsed: true, resultPositive: false },
      });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      closeWizard();
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  const empLabel = emps.find((e) => e.id === employeeId);
  const empOk = Boolean(employeeId);
  const phaseOk = phase.trim().length > 0;

  const steps: StepWizardStep[] = [
    {
      id: "emp",
      title: "スタッフを選ぶ",
      description: "アルコール検査の記録を残す人を選びます。",
      canProceed: empOk,
      children: (
        <>
          <FieldWithHint label="スタッフ" hint="名簿に登録されている人から選びます。">
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} autoFocus>
              {emps.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.familyName} {x.givenName}
                </option>
              ))}
            </select>
          </FieldWithHint>
        </>
      ),
    },
    {
      id: "phase",
      title: "いつの検査か（出勤前など）",
      description: "例: 出勤前・中間・帰庫前。現場のルールに合わせて短く書きます。",
      canProceed: phaseOk,
      children: (
        <>
          <FieldWithHint label="タイミング（段階）" hint="法令で求められる「いつ検査したか」があとから分かるように書きます。">
            <input value={phase} onChange={(e) => setPhase(e.target.value)} />
          </FieldWithHint>
        </>
      ),
    },
    {
      id: "confirm",
      title: "内容を確認してください",
      canProceed: empOk && phaseOk,
      children: (
        <dl className="step-wizard-summary">
          <dt>スタッフ</dt>
          <dd>{empLabel ? `${empLabel.familyName} ${empLabel.givenName}` : "—"}</dd>
          <dt>検査のタイミング</dt>
          <dd>{phase}</dd>
          <dt>アルコール検査器を使った</dt>
          <dd>はい（固定）</dd>
          <dt>検査でひっかかった（陽性）</dt>
          <dd>いいえ（固定）</dd>
        </dl>
      ),
    },
  ];

  return (
    <Card title="アルコール検査の記録">
      <Err msg={err} />
      <div className="stack-form" style={{ marginTop: "0.25rem" }}>
        <FieldWithHint label="事業日で絞り込む" optional hint="空欄ならすべての期間を対象に読み込みます。">
          <input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
        </FieldWithHint>
      </div>
      <button type="button" onClick={() => setBusinessDate("")}>
        日付の絞り込みをクリア
      </button>
      <p style={{ marginTop: "0.75rem" }}>
        <button type="button" onClick={() => setWizardOpen(true)}>
          検査結果を記録する
        </button>
      </p>
      <StepWizard
        open={wizardOpen}
        onClose={closeWizard}
        title="アルコール検査を記録する"
        steps={steps}
        finishLabel="記録する"
        onFinish={submitCheck}
        isSubmitting={submitting}
      />
      <div className="table-wrap" style={{ marginTop: "0.75rem" }}>
        <table>
          <thead>
            <tr>
              <th>日付</th>
              <th>氏名</th>
              <th>段階</th>
              <th>アルコール検査器</th>
              <th>陽性（違反）</th>
              <th>日時</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.id}>
                <td>{c.businessDate}</td>
                <td>
                  {c.employee.familyName} {c.employee.givenName}
                </td>
                <td>{c.phase}</td>
                <td>{c.detectorUsed ? "はい" : "いいえ"}</td>
                <td>{c.resultPositive ? "はい" : "いいえ"}</td>
                <td>{new Date(c.checkedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

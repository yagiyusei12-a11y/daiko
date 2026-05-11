import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { Card, Err, StepWizard, type StepWizardStep } from "../ui";

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
      title: "従業員を選んでください",
      description: "酒気確認を記録する対象者です。",
      canProceed: empOk,
      children: (
        <>
          <label>従業員</label>
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} autoFocus>
            {emps.map((x) => (
              <option key={x.id} value={x.id}>
                {x.familyName} {x.givenName}
              </option>
            ))}
          </select>
        </>
      ),
    },
    {
      id: "phase",
      title: "段階を入力してください",
      description: "例: 出勤前 / 中間 / 帰庫前",
      canProceed: phaseOk,
      children: (
        <>
          <label>段階</label>
          <input value={phase} onChange={(e) => setPhase(e.target.value)} />
        </>
      ),
    },
    {
      id: "confirm",
      title: "内容を確認してください",
      canProceed: empOk && phaseOk,
      children: (
        <dl className="step-wizard-summary">
          <dt>従業員</dt>
          <dd>{empLabel ? `${empLabel.familyName} ${empLabel.givenName}` : "—"}</dd>
          <dt>段階</dt>
          <dd>{phase}</dd>
          <dt>検知器使用</dt>
          <dd>はい（固定）</dd>
          <dt>陽性</dt>
          <dd>いいえ（固定）</dd>
        </dl>
      ),
    },
  ];

  return (
    <Card title="酒気確認">
      <Err msg={err} />
      <label>事業日で絞り込み（任意）</label>
      <input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
      <button type="button" onClick={() => setBusinessDate("")}>
        クリア
      </button>
      <p style={{ marginTop: "0.75rem" }}>
        <button type="button" onClick={() => setWizardOpen(true)}>
          記録を追加
        </button>
      </p>
      <StepWizard
        open={wizardOpen}
        onClose={closeWizard}
        title="酒気確認を記録"
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
              <th>検知器</th>
              <th>陽性</th>
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

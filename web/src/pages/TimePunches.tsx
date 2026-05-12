import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { Card, Err, FieldWithHint, StepWizard, type StepWizardStep } from "../ui";

type Emp = { id: string; familyName: string; givenName: string };
type Punch = {
  id: string;
  businessDate: string;
  clockInAt: string;
  clockOutAt: string | null;
  employee: Emp;
};

export default function TimePunches(): JSX.Element {
  const [punches, setPunches] = useState<Punch[]>([]);
  const [emps, setEmps] = useState<Emp[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [businessDate, setBusinessDate] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [employeeId, setEmployeeId] = useState("");

  async function load(): Promise<void> {
    const qs = businessDate ? `?businessDate=${encodeURIComponent(businessDate)}` : "";
    const r = await apiFetch<{ punches: Punch[] }>(`/time-punches${qs}`);
    if (r.ok) setPunches(r.data.punches);
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
    if (emps[0]) setEmployeeId(emps[0].id);
  }

  async function submitClockIn(): Promise<void> {
    setErr(null);
    setSubmitting(true);
    try {
      const r = await apiFetch<Punch>("/time-punches/clock-in", { method: "POST", json: { employeeId } });
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

  const steps: StepWizardStep[] = [
    {
      id: "emp",
      title: "出勤するスタッフ",
      description: "このあと「打刻する」で、いまの時刻が出勤として記録されます。",
      canProceed: empOk,
      children: (
        <>
          <FieldWithHint label="スタッフ" hint="本人の名前を選んでください。代わりに打刻しないでください。">
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
      id: "confirm",
      title: "出勤打刻の確認",
      canProceed: empOk,
      children: (
        <dl className="step-wizard-summary">
          <dt>スタッフ</dt>
          <dd>{empLabel ? `${empLabel.familyName} ${empLabel.givenName}` : "—"}</dd>
          <dt>操作</dt>
          <dd>出勤として記録（いまの時刻）</dd>
        </dl>
      ),
    },
  ];

  async function clockOut(id: string): Promise<void> {
    setErr(null);
    const r = await apiFetch<Punch>(`/time-punches/${id}/clock-out`, { method: "POST", json: {} });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else await load();
  }

  return (
    <Card title="出退勤の記録（打刻）">
      <Err msg={err} />
      <div className="stack-form" style={{ marginTop: "0.25rem" }}>
        <FieldWithHint label="事業日で絞り込む" optional hint="特定の日の一覧だけ見たいときに使います。">
          <input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
        </FieldWithHint>
      </div>
      <button type="button" onClick={() => setBusinessDate("")}>
        絞り込みをクリア
      </button>
      <p style={{ marginTop: "0.75rem" }}>
        <button type="button" onClick={() => setWizardOpen(true)}>
          出勤を記録する
        </button>
      </p>
      <StepWizard
        open={wizardOpen}
        onClose={closeWizard}
        title="出勤を記録する"
        steps={steps}
        finishLabel="打刻する"
        onFinish={submitClockIn}
        isSubmitting={submitting}
      />
      <div className="table-wrap" style={{ marginTop: "0.75rem" }}>
        <table>
          <thead>
            <tr>
              <th>日付</th>
              <th>氏名</th>
              <th>出勤</th>
              <th>退勤</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {punches.map((p) => (
              <tr key={p.id}>
                <td>{p.businessDate}</td>
                <td>
                  {p.employee.familyName} {p.employee.givenName}
                </td>
                <td>{new Date(p.clockInAt).toLocaleString()}</td>
                <td>{p.clockOutAt ? new Date(p.clockOutAt).toLocaleString() : "—"}</td>
                <td>
                  {!p.clockOutAt ? (
                    <button type="button" onClick={() => void clockOut(p.id)}>
                      退勤を記録
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

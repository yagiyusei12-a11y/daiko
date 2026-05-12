import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { useAuth, isStaffShiftOnlyMe } from "../auth";
import { Card, Err, StepWizard, type StepWizardStep } from "../ui";

type Emp = { id: string; familyName: string; givenName: string };
type Check = {
  id: string;
  businessDate: string;
  phase: string;
  checkedAt: string;
  detectorUsed: boolean;
  resultPositive: boolean;
  checkerName: string | null;
  checkMethod: string | null;
  checkMethodOther: string | null;
  methodNote: string | null;
  instructionNote: string | null;
  otherNote: string | null;
  supervisorNote: string | null;
  employee: Emp;
};

function datetimeLocalToIso(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  const d = new Date(t);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export default function Alcohol(): JSX.Element {
  const { me } = useAuth();
  const staffOnly = Boolean(me && isStaffShiftOnlyMe(me.permissions));
  const [checks, setChecks] = useState<Check[]>([]);
  const [emps, setEmps] = useState<Emp[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [businessDate, setBusinessDate] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [phase, setPhase] = useState("運転前");
  const [checkerName, setCheckerName] = useState("");
  const [checkMethod, setCheckMethod] = useState("対面");
  const [checkMethodOther, setCheckMethodOther] = useState("");
  const [methodNote, setMethodNote] = useState("");
  const [detectorUsed, setDetectorUsed] = useState(true);
  const [resultPositive, setResultPositive] = useState(false);
  const [instructionNote, setInstructionNote] = useState("");
  const [otherNote, setOtherNote] = useState("");
  const [checkedAtLocal, setCheckedAtLocal] = useState("");

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
        if (staffOnly && me?.employeeId) {
          setEmployeeId(me.employeeId);
        } else if (r.data.employees[0]) setEmployeeId(r.data.employees[0].id);
      }
    })();
  }, [staffOnly, me?.employeeId]);

  useEffect(() => {
    void load();
  }, [businessDate]);

  function closeWizard(): void {
    setWizardOpen(false);
    setPhase("運転前");
    setCheckerName("");
    setCheckMethod("対面");
    setCheckMethodOther("");
    setMethodNote("");
    setDetectorUsed(true);
    setResultPositive(false);
    setInstructionNote("");
    setOtherNote("");
    setCheckedAtLocal("");
    if (staffOnly && me?.employeeId) setEmployeeId(me.employeeId);
    else if (emps[0]) setEmployeeId(emps[0].id);
  }

  async function submitCheck(): Promise<void> {
    setErr(null);
    setSubmitting(true);
    try {
      const json: Record<string, unknown> = {
        employeeId,
        phase: phase.trim() || "確認",
        checkerName: checkerName.trim() || undefined,
        checkMethod: checkMethod.trim() || undefined,
        checkMethodOther: checkMethod === "その他" ? checkMethodOther.trim() || undefined : undefined,
        methodNote: methodNote.trim() || undefined,
        detectorUsed,
        resultPositive,
        instructionNote: instructionNote.trim() || undefined,
        otherNote: otherNote.trim() || undefined,
      };
      const iso = datetimeLocalToIso(checkedAtLocal);
      if (iso) json.checkedAt = iso;
      const r = await apiFetch<Check>("/alcohol-checks", {
        method: "POST",
        json,
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
  const methodOtherOk = checkMethod !== "その他" || checkMethodOther.trim().length > 0;

  const steps: StepWizardStep[] = [
    {
      id: "emp",
      title: staffOnly ? "対象者（本人）" : "従業員を選んでください",
      description: "酒気確認を記録する対象者です。",
      canProceed: empOk,
      children: staffOnly && me?.employeeId ? (
        <p style={{ marginTop: 0 }}>
          紐づけ従業員: <strong>{emps.find((e) => e.id === me.employeeId)?.familyName ?? ""}</strong>{" "}
          {emps.find((e) => e.id === me.employeeId)?.givenName ?? ""}
        </p>
      ) : (
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
      title: "確認状況（段階）",
      description: "乗務記録様式に合わせて運転前・運転後などを選べます。",
      canProceed: phaseOk,
      children: (
        <>
          <p style={{ marginTop: 0 }}>
            <button type="button" onClick={() => setPhase("運転前")}>
              運転前
            </button>{" "}
            <button type="button" onClick={() => setPhase("運転後")}>
              運転後
            </button>{" "}
            <button type="button" onClick={() => setPhase("出勤前")}>
              出勤前
            </button>{" "}
            <button type="button" onClick={() => setPhase("帰庫前")}>
              帰庫前
            </button>
          </p>
          <label>段階（自由入力可）</label>
          <input value={phase} onChange={(e) => setPhase(e.target.value)} />
        </>
      ),
    },
    {
      id: "checker",
      title: "確認者・確認方法",
      description: "様式の確認者氏名・対面／電話／その他を記録します。",
      canProceed: methodOtherOk,
      children: (
        <>
          <label>確認者氏名（任意）</label>
          <input value={checkerName} onChange={(e) => setCheckerName(e.target.value)} />
          <label>確認の方法</label>
          <select value={checkMethod} onChange={(e) => setCheckMethod(e.target.value)}>
            <option value="対面">対面</option>
            <option value="電話">電話</option>
            <option value="その他">その他</option>
          </select>
          {checkMethod === "その他" ? (
            <>
              <label>その他の内容</label>
              <input value={checkMethodOther} onChange={(e) => setCheckMethodOther(e.target.value)} />
            </>
          ) : null}
          <label>方法に関するメモ（任意）</label>
          <input value={methodNote} onChange={(e) => setMethodNote(e.target.value)} />
        </>
      ),
    },
    {
      id: "result",
      title: "検知器・結果・指示",
      description: "検知器の使用の有無、酒気帯びの有無、指示事項を入力します。",
      canProceed: true,
      children: (
        <>
          <label>
            <input type="checkbox" checked={detectorUsed} onChange={(e) => setDetectorUsed(e.target.checked)} /> アルコール検知器を使用した
          </label>
          <label>
            <input type="checkbox" checked={resultPositive} onChange={(e) => setResultPositive(e.target.checked)} /> 酒気帯び（陽性）
          </label>
          <label>指示事項（任意）</label>
          <textarea value={instructionNote} onChange={(e) => setInstructionNote(e.target.value)} rows={2} style={{ width: "100%" }} />
          <label>その他必要な事項（任意）</label>
          <textarea value={otherNote} onChange={(e) => setOtherNote(e.target.value)} rows={2} style={{ width: "100%" }} />
          <label>確認日時（空なら記録時の現在時刻）</label>
          <input type="datetime-local" value={checkedAtLocal} onChange={(e) => setCheckedAtLocal(e.target.value)} />
        </>
      ),
    },
    {
      id: "confirm",
      title: "内容を確認してください",
      canProceed: empOk && phaseOk && methodOtherOk,
      children: (
        <dl className="step-wizard-summary">
          <dt>従業員</dt>
          <dd>{empLabel ? `${empLabel.familyName} ${empLabel.givenName}` : "—"}</dd>
          <dt>段階</dt>
          <dd>{phase}</dd>
          <dt>確認者</dt>
          <dd>{checkerName.trim() || "—"}</dd>
          <dt>方法</dt>
          <dd>
            {checkMethod}
            {checkMethod === "その他" && checkMethodOther.trim() ? `（${checkMethodOther.trim()}）` : ""}
          </dd>
          <dt>検知器</dt>
          <dd>{detectorUsed ? "使用した" : "使用しなかった"}</dd>
          <dt>酒気帯び</dt>
          <dd>{resultPositive ? "あり（陽性）" : "なし"}</dd>
          <dt>指示／その他</dt>
          <dd>
            {[instructionNote.trim() || "—", otherNote.trim() || "—"].join(" ／ ")}
          </dd>
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
              <th>確認者</th>
              <th>方法</th>
              <th>検知器</th>
              <th>酒気</th>
              <th>指示</th>
              <th>その他</th>
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
                <td>{c.checkerName ?? "—"}</td>
                <td>
                  {[c.checkMethod, c.checkMethod === "その他" ? c.checkMethodOther : null].filter(Boolean).join(" ") || "—"}
                </td>
                <td>{c.detectorUsed ? "有" : "無"}</td>
                <td>{c.resultPositive ? "有" : "無"}</td>
                <td style={{ maxWidth: "8rem", fontSize: "0.85rem" }}>{c.instructionNote ?? "—"}</td>
                <td style={{ maxWidth: "8rem", fontSize: "0.85rem" }}>{c.otherNote ?? "—"}</td>
                <td style={{ whiteSpace: "nowrap", fontSize: "0.85rem" }}>{new Date(c.checkedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

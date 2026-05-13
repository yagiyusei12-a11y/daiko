import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, apiFetchText } from "../api";
import { Card, Tabs, type TabDef } from "../ui";

function PanelHint({ children }: { children: React.ReactNode }): JSX.Element {
  return <p className="settings-hint" style={{ marginTop: 0 }}>{children}</p>;
}

function tokyoYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function firstOfMonthTokyoYmd(): string {
  const ymd = tokyoYmd(new Date());
  return `${ymd.slice(0, 8)}01`;
}

type EmpPick = { id: string; familyName: string; givenName: string; status: string };

function DailyReportJommuPrintBlock(): JSX.Element {
  const [dateFrom, setDateFrom] = useState(firstOfMonthTokyoYmd);
  const [dateTo, setDateTo] = useState(() => tokyoYmd(new Date()));
  const [crewScope, setCrewScope] = useState<"all" | "second">("all");
  const [employees, setEmployees] = useState<EmpPick[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [printErr, setPrintErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoadErr(null);
    const path =
      crewScope === "second" ? "/settings/employees?forPassengerDriver=1" : "/settings/employees";
    const r = await apiFetch<{ employees: EmpPick[] }>(path);
    if (!r.ok) {
      setLoadErr(r.error);
      setEmployees([]);
      setSelected({});
      return;
    }
    const list = (r.data.employees ?? []).filter((e) => e.status === "ACTIVE");
    setEmployees(list);
    const next: Record<string, boolean> = {};
    for (const e of list) next[e.id] = true;
    setSelected(next);
  }, [crewScope]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function toggle(id: string): void {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function setAll(on: boolean): void {
    setSelected((prev) => {
      const next = { ...prev };
      for (const e of employees) next[e.id] = on;
      return next;
    });
  }

  async function print(): Promise<void> {
    setPrintErr(null);
    if (dateFrom > dateTo) {
      setPrintErr("開始日は終了日以前にしてください");
      return;
    }
    const crewIds = employees.filter((e) => selected[e.id]).map((e) => e.id);
    if (crewIds.length === 0) {
      setPrintErr("印刷する従業員を 1 人以上選んでください");
      return;
    }
    // 非同期のあとに window.open すると空タブのままになるブラウザがあるため、同期で先に開く。
    // noopener 付きだと参照が null になり document.write できず about:blank のまま残ることがあるため付けない。
    const w = window.open("", "_blank");
    if (!w) {
      setPrintErr("ポップアップがブロックされました。ブラウザの設定から許可してください。");
      return;
    }
    w.document.open();
    w.document.write(
      '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"/><title>取得中</title></head><body><p>取得中…</p></body></html>',
    );
    w.document.close();

    setBusy(true);
    const r = await apiFetchText("/documents/daily-reports-jommu-print", {
      method: "POST",
      json: { from: dateFrom, to: dateTo, crewScope, crewIds },
    });
    setBusy(false);
    if (!r.ok) {
      const msg = r.error.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
      w.document.open();
      w.document.write(
        `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"/><title>エラー</title><style>body{font-family:sans-serif;padding:1rem}</style></head><body><p>${msg}</p><p><button type="button" onclick="window.close()">閉じる</button></p></body></html>`,
      );
      w.document.close();
      setPrintErr(r.error);
      return;
    }
    w.document.open();
    w.document.write(r.text);
    w.document.close();
  }

  return (
    <div className="settings-section-panel" style={{ marginTop: "0.75rem" }}>
      <PanelHint>
        指定期間・対象従業員（客車担当の日報）に基づき、乗務記録簿形式の HTML をまとめて開きます。出勤・退勤打刻と随伴車の ODO ログが揃っていると、各日報のフッター距離が埋まりやすくなります。
      </PanelHint>
      <div className="settings-form" style={{ marginTop: "0.75rem", maxWidth: "36rem" }}>
        <label>期間（開始）</label>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <label>期間（終了）</label>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <fieldset style={{ marginTop: "0.5rem", border: "none", padding: 0 }}>
          <legend className="settings-hint" style={{ marginBottom: "0.35rem" }}>
            対象従業員（客車担当）
          </legend>
          <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
            <input
              type="radio"
              name="crewScope"
              checked={crewScope === "all"}
              onChange={() => setCrewScope("all")}
            />
            在籍の全従業員から選ぶ
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer", marginTop: "0.25rem" }}>
            <input
              type="radio"
              name="crewScope"
              checked={crewScope === "second"}
              onChange={() => setCrewScope("second")}
            />
            第二種免許を登録した従業員のみから選ぶ
          </label>
        </fieldset>
        {loadErr ? (
          <p className="settings-hint" style={{ color: "var(--danger, #b00020)", marginTop: "0.5rem" }}>
            {loadErr}
          </p>
        ) : null}
        <div style={{ marginTop: "0.75rem" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.35rem" }}>
            <button type="button" className="settings-secondary" onClick={() => setAll(true)}>
              全員チェック
            </button>
            <button type="button" className="settings-secondary" onClick={() => setAll(false)}>
              全員解除
            </button>
          </div>
          <div
            style={{
              maxHeight: "220px",
              overflowY: "auto",
              border: "1px solid var(--border, #ccc)",
              borderRadius: "4px",
              padding: "0.5rem",
            }}
          >
            {employees.length === 0 && !loadErr ? (
              <span className="settings-hint">対象となる従業員がありません</span>
            ) : (
              employees.map((e) => (
                <label
                  key={e.id}
                  style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.25rem", cursor: "pointer" }}
                >
                  <input type="checkbox" checked={Boolean(selected[e.id])} onChange={() => toggle(e.id)} />
                  {e.familyName}　{e.givenName}
                </label>
              ))
            )}
          </div>
        </div>
        <p style={{ marginTop: "0.75rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
          <button type="button" className="settings-primary" disabled={busy} onClick={() => void print()}>
            {busy ? "取得中…" : "乗務記録簿を印刷（まとめて）"}
          </button>
          <Link to="/daily-reports">日報一覧へ</Link>
        </p>
        {printErr ? (
          <p className="settings-hint" style={{ color: "var(--danger, #b00020)", marginTop: "0.5rem" }}>
            {printErr}
          </p>
        ) : null}
      </div>
    </div>
  );
}

type EmpRosterRow = { id: string; familyName: string; givenName: string; furigana?: string | null; status: string };

function EmployeeRosterPrintBlock(): JSX.Element {
  const [allEmployees, setAllEmployees] = useState<EmpRosterRow[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [includeRetired, setIncludeRetired] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [printErr, setPrintErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const visibleEmployees = useMemo(() => {
    if (includeRetired) {
      return allEmployees.filter((e) => e.status === "ACTIVE" || e.status === "RETIRED");
    }
    return allEmployees.filter((e) => e.status === "ACTIVE");
  }, [allEmployees, includeRetired]);

  const reload = useCallback(async () => {
    setLoadErr(null);
    const r = await apiFetch<{ employees: EmpRosterRow[] }>("/settings/employees");
    if (!r.ok) {
      setLoadErr(r.error);
      setAllEmployees([]);
      setSelected({});
      return;
    }
    setAllEmployees(r.data.employees ?? []);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    setSelected((prev) => {
      const next: Record<string, boolean> = { ...prev };
      for (const e of visibleEmployees) {
        if (next[e.id] === undefined) next[e.id] = true;
      }
      for (const id of Object.keys(next)) {
        if (!visibleEmployees.some((e) => e.id === id)) delete next[id];
      }
      return next;
    });
  }, [visibleEmployees]);

  function toggle(id: string): void {
    setSelected((p) => ({ ...p, [id]: !p[id] }));
  }

  function setAll(on: boolean): void {
    setSelected(() => {
      const next: Record<string, boolean> = {};
      for (const e of visibleEmployees) next[e.id] = on;
      return next;
    });
  }

  async function print(): Promise<void> {
    setPrintErr(null);
    const employeeIds = visibleEmployees.filter((e) => selected[e.id]).map((e) => e.id);
    if (employeeIds.length === 0) {
      setPrintErr("印刷する従業員を 1 人以上選んでください");
      return;
    }
    const w = window.open("", "_blank");
    if (!w) {
      setPrintErr("ポップアップがブロックされました。ブラウザの設定から許可してください。");
      return;
    }
    w.document.open();
    w.document.write(
      '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"/><title>取得中</title></head><body><p>取得中…</p></body></html>',
    );
    w.document.close();

    setBusy(true);
    const r = await apiFetchText("/documents/employee-roster-print", {
      method: "POST",
      json: { includeRetired, employeeIds },
    });
    setBusy(false);
    if (!r.ok) {
      const msg = r.error.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
      w.document.open();
      w.document.write(
        `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"/><title>エラー</title><style>body{font-family:sans-serif;padding:1rem}</style></head><body><p>${msg}</p><p><button type="button" onclick="window.close()">閉じる</button></p></body></html>`,
      );
      w.document.close();
      setPrintErr(r.error);
      return;
    }
    w.document.open();
    w.document.write(r.text);
    w.document.close();
  }

  return (
    <div className="settings-section-panel" style={{ marginTop: "0.75rem" }}>
      <PanelHint>
        従事者の氏名・ふりがな・住所・連絡先・免許・緊急連絡先などは「設定」の従業員登録に入力すると反映されます。一覧で複数人にチェックを入れてから印刷してください（免許証の表裏は写真アップロードがある場合のみ枠内に表示されます）。
      </PanelHint>
      <label style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", cursor: "pointer", marginTop: "0.75rem" }}>
        <input type="checkbox" checked={includeRetired} onChange={(e) => setIncludeRetired(e.target.checked)} />
        退職者も一覧に含める
      </label>
      {loadErr ? (
        <p className="settings-hint" style={{ color: "var(--danger, #b00020)", marginTop: "0.5rem" }}>
          {loadErr}
        </p>
      ) : null}
      <div className="settings-form" style={{ marginTop: "0.75rem", maxWidth: "36rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.35rem" }}>
          <button type="button" className="settings-secondary" onClick={() => setAll(true)}>
            全員チェック
          </button>
          <button type="button" className="settings-secondary" onClick={() => setAll(false)}>
            全員解除
          </button>
        </div>
        <div
          style={{
            maxHeight: "240px",
            overflowY: "auto",
            border: "1px solid var(--border, #ccc)",
            borderRadius: "4px",
            padding: "0.5rem",
          }}
        >
          {visibleEmployees.length === 0 && !loadErr ? (
            <span className="settings-hint">表示する従業員がありません</span>
          ) : (
            visibleEmployees.map((e) => (
              <label
                key={e.id}
                style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.25rem", cursor: "pointer" }}
              >
                <input type="checkbox" checked={Boolean(selected[e.id])} onChange={() => toggle(e.id)} />
                {e.familyName}　{e.givenName}
                {e.status === "RETIRED" ? (
                  <span className="settings-hint" style={{ marginLeft: "0.25rem" }}>
                    （退職）
                  </span>
                ) : null}
              </label>
            ))
          )}
        </div>
        <p style={{ marginTop: "0.75rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
          <button type="button" className="settings-primary" disabled={busy} onClick={() => void print()}>
            {busy ? "取得中…" : "従事者名簿を印刷"}
          </button>
          <Link to="/settings">設定（従業員・車両）へ</Link>
        </p>
        {printErr ? (
          <p className="settings-hint" style={{ color: "var(--danger, #b00020)", marginTop: "0.5rem" }}>
            {printErr}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default function DocumentsPage(): JSX.Element {
  const [tab, setTab] = useState("nippo");

  const tabItems: TabDef[] = [
    {
      id: "nippo",
      label: "日報",
      children: <DailyReportJommuPrintBlock />,
    },
    {
      id: "meibo",
      label: "従業員名簿",
      children: <EmployeeRosterPrintBlock />,
    },
    {
      id: "seiyaku",
      label: "誓約書",
      children: (
        <div className="settings-section-panel" style={{ marginTop: "0.75rem" }}>
          <PanelHint>重症患者等の運送に関する誓約書の様式出力は、今後このタブから行える予定です。</PanelHint>
        </div>
      ),
    },
    {
      id: "nintei",
      label: "認定証",
      children: (
        <div className="settings-section-panel" style={{ marginTop: "0.75rem" }}>
          <PanelHint>認定事項の記載イメージを出力する機能は、今後このタブから行える予定です。事業者情報は「設定」の事業者情報に入力してください。</PanelHint>
          <p style={{ marginTop: "0.75rem" }}>
            <Link to="/settings">設定へ</Link>
          </p>
        </div>
      ),
    },
    {
      id: "yakkan",
      label: "約款",
      children: (
        <div className="settings-section-panel" style={{ marginTop: "0.75rem" }}>
          <PanelHint>標準自動車運送約款の届出様式イメージなどの出力は、今後このタブから行える予定です。</PanelHint>
        </div>
      ),
    },
    {
      id: "shido",
      label: "指導記録簿",
      children: (
        <div className="settings-section-panel" style={{ marginTop: "0.75rem" }}>
          <PanelHint>指導記録の一覧様式の出力は、今後このタブから行える予定です。</PanelHint>
        </div>
      ),
    },
    {
      id: "kujo",
      label: "苦情処理簿",
      children: (
        <div className="settings-section-panel" style={{ marginTop: "0.75rem" }}>
          <PanelHint>苦情処理の登録一覧様式の出力は、今後このタブから行える予定です。</PanelHint>
        </div>
      ),
    },
    {
      id: "henko",
      label: "変更届出書",
      children: (
        <div className="settings-section-panel" style={{ marginTop: "0.75rem" }}>
          <PanelHint>変更届の記載例イメージの出力は、今後このタブから行える予定です。</PanelHint>
        </div>
      ),
    },
  ];

  return (
    <Card title="書類を作る">
      <p className="settings-hint" style={{ marginTop: 0 }}>
        帳票・様式は種類ごとのタブに分けています。出力・印刷の本体機能は順次追加します。
      </p>
      <Tabs items={tabItems} activeId={tab} onActiveChange={setTab} aria-label="書類の種類" />
    </Card>
  );
}

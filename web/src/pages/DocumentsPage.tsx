import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, apiFetchText } from "../api";
import { DAIKO_LAW14_DEFAULT_PLEDGE_BODY } from "../lib/daikoLaw14DefaultPledge";
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

type CompanyLegalRow = {
  legalTradeName: string | null;
  legalRepresentativeName: string | null;
};

type SeiyakuEmp = {
  id: string;
  familyName: string;
  givenName: string;
  address: string | null;
  status: string;
};

function DaikoLaw14SeiyakuPrintBlock(): JSX.Element {
  const [companyLine, setCompanyLine] = useState("〇〇〇　（会社名・屋号）");
  const [representativeLine, setRepresentativeLine] = useState("〇〇　〇〇　殿（代表者名）");
  const [pledgeYmd, setPledgeYmd] = useState(() => tokyoYmd(new Date()));
  const [pledgeBody, setPledgeBody] = useState(DAIKO_LAW14_DEFAULT_PLEDGE_BODY);
  const [allEmployees, setAllEmployees] = useState<SeiyakuEmp[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Record<string, { name: string; address: string }>>({});
  const [includeRetired, setIncludeRetired] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [printErr, setPrintErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const appliedCompanyDefaultsRef = useRef(false);

  const visibleEmployees = useMemo(() => {
    if (includeRetired) {
      return allEmployees.filter((e) => e.status === "ACTIVE" || e.status === "RETIRED");
    }
    return allEmployees.filter((e) => e.status === "ACTIVE");
  }, [allEmployees, includeRetired]);

  const reload = useCallback(async () => {
    setLoadErr(null);
    const [co, em] = await Promise.all([
      apiFetch<CompanyLegalRow>("/settings/company"),
      apiFetch<{ employees: SeiyakuEmp[] }>("/settings/employees"),
    ]);
    if (!co.ok) {
      setLoadErr(co.error);
      return;
    }
    if (!em.ok) {
      setLoadErr(em.error);
      return;
    }
    const trade = co.data.legalTradeName?.trim() ?? "";
    const rep = co.data.legalRepresentativeName?.trim() ?? "";
    if (!appliedCompanyDefaultsRef.current) {
      setCompanyLine(trade ? `${trade}　（会社名・屋号）` : "〇〇〇　（会社名・屋号）");
      const repLine = rep ? `${rep.replace(/\s+/g, "　")}　殿（代表者名）` : "〇〇　〇〇　殿（代表者名）";
      setRepresentativeLine(repLine);
      appliedCompanyDefaultsRef.current = true;
    }
    setAllEmployees(em.data.employees ?? []);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    setEdits((prev) => {
      const next = { ...prev };
      for (const e of allEmployees) {
        if (next[e.id] === undefined) {
          next[e.id] = {
            name: `${e.familyName}　${e.givenName}`,
            address: (e.address ?? "").trim(),
          };
        }
      }
      for (const id of Object.keys(next)) {
        if (!allEmployees.some((x) => x.id === id)) delete next[id];
      }
      return next;
    });
  }, [allEmployees]);

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

  function patchEdit(id: string, field: "name" | "address", value: string): void {
    setEdits((p) => {
      const cur = p[id];
      const emp = allEmployees.find((x) => x.id === id);
      const name0 = cur?.name ?? (emp ? `${emp.familyName}　${emp.givenName}` : "");
      const addr0 = cur?.address ?? (emp ? (emp.address ?? "").trim() : "");
      return {
        ...p,
        [id]: {
          name: field === "name" ? value : name0,
          address: field === "address" ? value : addr0,
        },
      };
    });
  }

  async function print(): Promise<void> {
    setPrintErr(null);
    const chosen = visibleEmployees.filter((e) => selected[e.id]);
    if (chosen.length === 0) {
      setPrintErr("印刷する従業員を 1 人以上選んでください");
      return;
    }
    if (!pledgeBody.trim()) {
      setPrintErr("誓約の本文を入力してください");
      return;
    }
    const sheets = chosen.map((e) => {
      const row = edits[e.id];
      return {
        employeeId: e.id,
        signerName: (row?.name ?? `${e.familyName}　${e.givenName}`).trim(),
        signerAddress: (row?.address ?? (e.address ?? "").trim()).trim(),
      };
    });
    for (const s of sheets) {
      if (!s.signerName) {
        setPrintErr("氏名が空の行があります。表で修正してください。");
        return;
      }
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
    const r = await apiFetchText("/documents/daiko-law14-seiyaku-print", {
      method: "POST",
      json: {
        companyLine,
        representativeLine,
        pledgeYmd,
        pledgeBody,
        includeRetired,
        sheets,
      },
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

  const selectedList = visibleEmployees.filter((e) => selected[e.id]);

  return (
    <div className="settings-section-panel" style={{ marginTop: "0.75rem" }}>
      <PanelHint>
        運転代行業法第１４条第１項各号の非該当を誓約する書面です。事業者情報は「設定」の事業者情報から、氏名・住所は従業員マスタから初期表示します。チェックした人数分、A4
        縦で各１枚ずつ開きます。
      </PanelHint>
      {loadErr ? (
        <p className="settings-hint" style={{ color: "var(--danger, #b00020)", marginTop: "0.5rem" }}>
          {loadErr}
        </p>
      ) : null}
      <div className="settings-form" style={{ marginTop: "0.75rem", maxWidth: "42rem" }}>
        <label>宛名（会社名・屋号の行）</label>
        <input type="text" value={companyLine} onChange={(e) => setCompanyLine(e.target.value)} />
        <label>宛名（代表者の行）</label>
        <input type="text" value={representativeLine} onChange={(e) => setRepresentativeLine(e.target.value)} />
        <label>誓約年月日</label>
        <input type="date" value={pledgeYmd} onChange={(e) => setPledgeYmd(e.target.value)} />
        <label>誓約の本文</label>
        <textarea
          value={pledgeBody}
          onChange={(e) => setPledgeBody(e.target.value)}
          rows={14}
          style={{ minHeight: "12rem", fontFamily: "inherit" }}
        />
        <label style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", cursor: "pointer", marginTop: "0.35rem" }}>
          <input type="checkbox" checked={includeRetired} onChange={(e) => setIncludeRetired(e.target.checked)} />
          退職者も一覧に含める
        </label>
        <p className="settings-hint" style={{ marginTop: "0.75rem", marginBottom: "0.35rem" }}>
          従業員名簿から印刷する人を選び、下の表で氏名・住所を必要に応じて直してから印刷してください。
        </p>
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
            maxHeight: "200px",
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
        {selectedList.length > 0 ? (
          <div style={{ marginTop: "0.85rem" }}>
            <div className="settings-hint" style={{ marginBottom: "0.35rem" }}>
              選択中の氏名・住所（印刷に反映）
            </div>
            <div style={{ overflowX: "auto", border: "1px solid var(--border, #ccc)", borderRadius: "4px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                <thead>
                  <tr style={{ background: "#eff6ff" }}>
                    <th style={{ textAlign: "left", padding: "0.35rem 0.5rem", borderBottom: "1px solid var(--border, #ccc)" }}>
                      氏名
                    </th>
                    <th style={{ textAlign: "left", padding: "0.35rem 0.5rem", borderBottom: "1px solid var(--border, #ccc)" }}>
                      住所
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {selectedList.map((e) => (
                    <tr key={e.id}>
                      <td style={{ padding: "0.35rem", borderBottom: "1px solid #eee", verticalAlign: "top", width: "38%" }}>
                        <input
                          type="text"
                          value={edits[e.id]?.name ?? `${e.familyName}　${e.givenName}`}
                          onChange={(ev) => patchEdit(e.id, "name", ev.target.value)}
                          style={{ width: "100%", boxSizing: "border-box" }}
                        />
                      </td>
                      <td style={{ padding: "0.35rem", borderBottom: "1px solid #eee", verticalAlign: "top" }}>
                        <input
                          type="text"
                          value={edits[e.id]?.address ?? (e.address ?? "")}
                          onChange={(ev) => patchEdit(e.id, "address", ev.target.value)}
                          style={{ width: "100%", boxSizing: "border-box" }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        <p style={{ marginTop: "0.85rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
          <button type="button" className="settings-primary" disabled={busy} onClick={() => void print()}>
            {busy ? "取得中…" : "誓約書を印刷（A4 縦）"}
          </button>
          <Link to="/settings">設定（事業者・従業員）へ</Link>
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

type NinteiCompanyRow = {
  tenantName: string;
  legalTradeName: string | null;
  legalPostalCode: string | null;
  legalPrefecture: string | null;
  legalStreetAddress: string | null;
  legalCertificationNumber: string | null;
  legalCertificationDate: string | null;
  legalPublicSafetyCommission: string | null;
};

function formatPostalForNintei(zip: string | null | undefined): string {
  const z = (zip ?? "").replace(/\D/g, "");
  if (z.length === 7) return `〒${z.slice(0, 3)}-${z.slice(3)}`;
  return (zip ?? "").trim();
}

function defaultIssuingAuthority(c: NinteiCompanyRow): string {
  const ps = c.legalPublicSafetyCommission?.trim();
  if (ps) return /公安委員会/u.test(ps) ? ps : `${ps}公安委員会`;
  const pref = c.legalPrefecture?.trim();
  return pref ? `${pref}公安委員会` : "";
}

function defaultLocationLine(c: NinteiCompanyRow): string {
  return [formatPostalForNintei(c.legalPostalCode), c.legalPrefecture?.trim(), c.legalStreetAddress?.trim()]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function NinteiCertificatePrintBlock(): JSX.Element {
  const [issuingAuthorityDisplay, setIssuingAuthorityDisplay] = useState("");
  const [certificationNumberMiddle, setCertificationNumberMiddle] = useState("");
  const [certificationDateYmd, setCertificationDateYmd] = useState("");
  const [nameOrTitle, setNameOrTitle] = useState("");
  const [location, setLocation] = useState("");
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [printErr, setPrintErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const appliedDefaultsRef = useRef(false);

  const reload = useCallback(async () => {
    setLoadErr(null);
    const r = await apiFetch<NinteiCompanyRow>("/settings/company");
    if (!r.ok) {
      setLoadErr(r.error);
      return;
    }
    const c = r.data;
    if (!appliedDefaultsRef.current) {
      setIssuingAuthorityDisplay(defaultIssuingAuthority(c));
      setCertificationNumberMiddle((c.legalCertificationNumber ?? "").trim());
      setCertificationDateYmd(c.legalCertificationDate ?? "");
      setNameOrTitle((c.legalTradeName?.trim() || c.tenantName || "").trim());
      setLocation(defaultLocationLine(c));
      appliedDefaultsRef.current = true;
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function print(): Promise<void> {
    setPrintErr(null);
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
    const r = await apiFetchText("/documents/daiko-nintei-certificate-print", {
      method: "POST",
      json: {
        issuingAuthorityDisplay,
        certificationNumberMiddle,
        certificationDateYmd,
        nameOrTitle,
        location,
      },
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
        事業者マスタ（設定の事業者情報）から初期表示します。この画面での修正は印刷にだけ使われ、保存されません。印刷ダイアログで A4
        縦を選んでください。
      </PanelHint>
      {loadErr ? (
        <p className="settings-hint" style={{ color: "var(--danger, #b00020)", marginTop: "0.5rem" }}>
          {loadErr}
        </p>
      ) : null}
      <div className="settings-form" style={{ marginTop: "0.75rem", maxWidth: "36rem" }}>
        <label>認定をした公安委員会</label>
        <input
          type="text"
          value={issuingAuthorityDisplay}
          onChange={(e) => setIssuingAuthorityDisplay(e.target.value)}
          placeholder="例: 兵庫県公安委員会"
        />
        <label>認定番号（「第」「号」のあいだの数字・記号）</label>
        <div className="settings-inline-cert">
          <span aria-hidden>第</span>
          <input
            className="settings-cert-core"
            value={certificationNumberMiddle}
            onChange={(e) => setCertificationNumberMiddle(e.target.value)}
            placeholder="1234"
          />
          <span aria-hidden>号</span>
        </div>
        <label>認定年月日</label>
        <input type="date" value={certificationDateYmd} onChange={(e) => setCertificationDateYmd(e.target.value)} />
        <label>氏名又は名称</label>
        <input type="text" value={nameOrTitle} onChange={(e) => setNameOrTitle(e.target.value)} />
        <label>所在地</label>
        <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} />
        <p style={{ marginTop: "0.85rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
          <button type="button" className="settings-primary" disabled={busy} onClick={() => void print()}>
            {busy ? "取得中…" : "認定証を印刷（A4 縦）"}
          </button>
          <Link to="/settings">設定（事業者情報）へ</Link>
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
      children: <DaikoLaw14SeiyakuPrintBlock />,
    },
    {
      id: "nintei",
      label: "認定証",
      children: <NinteiCertificatePrintBlock />,
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

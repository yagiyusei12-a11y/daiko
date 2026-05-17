import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, apiFetchBlob } from "../api";
import { downloadBrowserBlob } from "../lib/download-blob";
import { DAIKO_LAW14_DEFAULT_PLEDGE_BODY } from "../lib/daikoLaw14DefaultPledge";
import { DAIKO_STANDARD_YAKKAN_DEFAULT_BODY } from "../lib/daikoYakkanDefaultBody";
import ComplaintLedgerPrintBlock from "../components/ComplaintLedgerPrintBlock";
import InstructionRecordListPrintBlock from "../components/InstructionRecordListPrintBlock";
import { Card, Tabs, type TabDef } from "../ui";
import { useAuth, formatFlexDatetime } from "../auth";
import { filterSubTabsForMe } from "../lib/staff-menu-client";

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

  async function savePdf(): Promise<void> {
    setPrintErr(null);
    if (dateFrom > dateTo) {
      setPrintErr("開始日は終了日以前にしてください");
      return;
    }
    const crewIds = employees.filter((e) => selected[e.id]).map((e) => e.id);
    if (crewIds.length === 0) {
      setPrintErr("PDF に出力する従業員を 1 人以上選んでください");
      return;
    }
    setBusy(true);
    const r = await apiFetchBlob("/documents/daily-reports-jommu-print", {
      method: "POST",
      json: { from: dateFrom, to: dateTo, crewScope, crewIds, outputFormat: "pdf" },
    });
    setBusy(false);
    if (!r.ok) {
      setPrintErr(r.error);
      return;
    }
    downloadBrowserBlob(r.blob, r.filename ?? `daily-reports-jommu_${dateFrom}_${dateTo}.pdf`);
  }

  return (
    <div className="settings-section-panel" style={{ marginTop: "0.75rem" }}>
      <PanelHint>
        指定期間・対象従業員（客車担当の日報）に基づき、公的様式に近い乗務記録簿レイアウトの PDF を生成します。同伴乗務員は日報のペア設定、メーター欄は出勤・退勤打刻と随伴車の ODO ログが揃っていると埋まりやすくなります。
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
          <button type="button" className="settings-primary" disabled={busy} onClick={() => void savePdf()}>
            {busy ? "生成中…" : "PDFで保存"}
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

  async function savePdf(): Promise<void> {
    setPrintErr(null);
    const employeeIds = visibleEmployees.filter((e) => selected[e.id]).map((e) => e.id);
    if (employeeIds.length === 0) {
      setPrintErr("PDF に出力する従業員を 1 人以上選んでください");
      return;
    }
    setBusy(true);
    const r = await apiFetchBlob("/documents/employee-roster-print", {
      method: "POST",
      json: { includeRetired, employeeIds, outputFormat: "pdf" },
    });
    setBusy(false);
    if (!r.ok) {
      setPrintErr(r.error);
      return;
    }
    downloadBrowserBlob(r.blob, r.filename ?? "employee-roster.pdf");
  }

  return (
    <div className="settings-section-panel" style={{ marginTop: "0.75rem" }}>
      <PanelHint>
        従事者の氏名・ふりがな・住所・連絡先・免許・緊急連絡先などは「設定」の従業員登録に入力すると反映されます。一覧で複数人にチェックを入れてから PDF で保存してください（免許証の表裏は写真アップロードがある場合のみ枠内に表示されます）。
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
          <button type="button" className="settings-primary" disabled={busy} onClick={() => void savePdf()}>
            {busy ? "生成中…" : "PDFで保存"}
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

  async function savePdf(): Promise<void> {
    setPrintErr(null);
    const chosen = visibleEmployees.filter((e) => selected[e.id]);
    if (chosen.length === 0) {
      setPrintErr("PDF に出力する従業員を 1 人以上選んでください");
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
    setBusy(true);
    const r = await apiFetchBlob("/documents/daiko-law14-seiyaku-print", {
      method: "POST",
      json: {
        companyLine,
        representativeLine,
        pledgeYmd,
        pledgeBody,
        includeRetired,
        sheets,
        outputFormat: "pdf",
      },
    });
    setBusy(false);
    if (!r.ok) {
      setPrintErr(r.error);
      return;
    }
    downloadBrowserBlob(r.blob, r.filename ?? "daiko-law14-seiyaku.pdf");
  }

  const selectedList = visibleEmployees.filter((e) => selected[e.id]);

  return (
    <div className="settings-section-panel" style={{ marginTop: "0.75rem" }}>
      <PanelHint>
        運転代行業法第１４条第１項各号の非該当を誓約する書面です。事業者情報は「設定」の事業者情報から、氏名・住所は従業員マスタから初期表示します。チェックした人数分、A4
        縦で各１枚ずつ PDF にまとめます。
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
          従業員名簿から出力する人を選び、下の表で氏名・住所を必要に応じて直してから PDF で保存してください。
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
              選択中の氏名・住所（PDFに反映）
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
          <button type="button" className="settings-primary" disabled={busy} onClick={() => void savePdf()}>
            {busy ? "生成中…" : "PDFで保存"}
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

  async function savePdf(): Promise<void> {
    setPrintErr(null);
    setBusy(true);
    const r = await apiFetchBlob("/documents/daiko-nintei-certificate-print", {
      method: "POST",
      json: {
        issuingAuthorityDisplay,
        certificationNumberMiddle,
        certificationDateYmd,
        nameOrTitle,
        location,
        outputFormat: "pdf",
      },
    });
    setBusy(false);
    if (!r.ok) {
      setPrintErr(r.error);
      return;
    }
    downloadBrowserBlob(r.blob, r.filename ?? "daiko-nintei-certificate.pdf");
  }

  return (
    <div className="settings-section-panel" style={{ marginTop: "0.75rem" }}>
      <PanelHint>
        事業者マスタ（設定の事業者情報）から初期表示します。この画面での修正は PDF 出力にのみ使われ、保存されません。
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
          <button type="button" className="settings-primary" disabled={busy} onClick={() => void savePdf()}>
            {busy ? "生成中…" : "PDFで保存"}
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

function pricingRegimeLabel(regime: string): string {
  if (regime === "distance") return "距離制を主とする";
  if (regime === "time") return "時間制を主とする";
  if (regime === "both") return "距離・時間の併用";
  return "未設定";
}

function FareTablePrintBlock(): JSX.Element {
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [printErr, setPrintErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [regime, setRegime] = useState("");
  const [businessName, setBusinessName] = useState("");

  useEffect(() => {
    void (async () => {
      setLoadErr(null);
      const [pr, co] = await Promise.all([
        apiFetch<{ regime: string; pricingPrefs?: { regime?: string } }>("/settings/pricing"),
        apiFetch<{ tenantName: string; legalTradeName: string | null }>("/settings/company"),
      ]);
      if (!pr.ok) {
        setLoadErr(pr.error);
        return;
      }
      if (!co.ok) {
        setLoadErr(co.error);
        return;
      }
      const r = pr.data.regime || pr.data.pricingPrefs?.regime || "";
      setRegime(r);
      setBusinessName((co.data.legalTradeName?.trim() || co.data.tenantName || "").trim());
    })();
  }, []);

  async function savePdf(): Promise<void> {
    setPrintErr(null);
    setBusy(true);
    const r = await apiFetchBlob("/documents/daiko-ryokinhyo-print", {
      method: "POST",
      json: { outputFormat: "pdf" },
    });
    setBusy(false);
    if (!r.ok) {
      setPrintErr(r.error);
      return;
    }
    downloadBrowserBlob(r.blob, r.filename ?? "daiko-ryokinhyo.pdf");
  }

  return (
    <div className="settings-section-panel" style={{ marginTop: "0.75rem" }}>
      <PanelHint>
        設定の「料金」に登録した内容を、お客様向けの A4 縦・料金表として PDF 保存できます。料金の変更は設定画面で行ってください。
      </PanelHint>
      {loadErr ? (
        <p className="settings-hint" style={{ color: "var(--danger, #b00020)", marginTop: "0.5rem" }}>
          {loadErr}
        </p>
      ) : (
        <div className="settings-form" style={{ marginTop: "0.75rem", maxWidth: "36rem" }}>
          {businessName ? (
            <p className="settings-hint" style={{ margin: 0 }}>
              事業者名: {businessName}
            </p>
          ) : null}
          <p className="settings-hint" style={{ margin: businessName ? "0.35rem 0 0" : 0 }}>
            料金の算定方法: {pricingRegimeLabel(regime)}
            {!regime ? (
              <>
                {" "}
                — <Link to="/settings">設定 → 料金</Link> で料金体制を選択してください。
              </>
            ) : null}
          </p>
        </div>
      )}
      <p style={{ marginTop: "0.85rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
        <button type="button" className="settings-primary" disabled={busy || Boolean(loadErr)} onClick={() => void savePdf()}>
          {busy ? "生成中…" : "PDFで保存（A4縦）"}
        </button>
        <Link to="/settings">設定（料金）へ</Link>
      </p>
      {printErr ? (
        <p className="settings-hint" style={{ color: "var(--danger, #b00020)", marginTop: "0.5rem" }}>
          {printErr}
        </p>
      ) : null}
    </div>
  );
}

function YakkanPrintBlock(): JSX.Element {
  const [bodyText, setBodyText] = useState(DAIKO_STANDARD_YAKKAN_DEFAULT_BODY);
  const [printErr, setPrintErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function savePdf(): Promise<void> {
    setPrintErr(null);
    if (!bodyText.trim()) {
      setPrintErr("約款の本文が空です");
      return;
    }
    setBusy(true);
    const r = await apiFetchBlob("/documents/daiko-yakkan-print", {
      method: "POST",
      json: { bodyText, outputFormat: "pdf" },
    });
    setBusy(false);
    if (!r.ok) {
      setPrintErr(r.error);
      return;
    }
    downloadBrowserBlob(r.blob, r.filename ?? "daiko-yakkan.pdf");
  }

  return (
    <div className="settings-section-panel" style={{ marginTop: "0.75rem" }}>
      <PanelHint>
        標準自動車運転代行業約款（告示）の全文を初期表示しています。必要に応じて編集してから PDF で保存してください（この画面の内容はマスタに保存されません）。
      </PanelHint>
      <div className="settings-form" style={{ marginTop: "0.75rem", maxWidth: "48rem" }}>
        <label>約款本文</label>
        <textarea
          value={bodyText}
          onChange={(e) => setBodyText(e.target.value)}
          rows={28}
          spellCheck={false}
          style={{ width: "100%", minHeight: "22rem", fontFamily: "inherit", fontSize: "0.9rem", lineHeight: 1.55 }}
        />
        <p style={{ marginTop: "0.85rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
          <button type="button" className="settings-primary" disabled={busy} onClick={() => void savePdf()}>
            {busy ? "生成中…" : "PDFで保存"}
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

type HenkoKind = "mutual_aid_renewal" | "escort_swap" | "escort_add" | "trade_name_change";

type HenkoCompanyRow = {
  tenantName: string;
  legalTradeName: string | null;
  legalRepresentativeName: string | null;
  legalPostalCode: string | null;
  legalPrefecture: string | null;
  legalStreetAddress: string | null;
  legalCertificationNumber: string | null;
  legalPublicSafetyCommission: string | null;
  legalMainOfficeName: string | null;
  legalMainOfficeAddress: string | null;
  legalMutualAidContractFrom: string | null;
  legalMutualAidContractTo: string | null;
};

type HenkoVehicleRow = { id: string; label: string; plate: string | null; active: boolean };

function todayYmd(): string {
  return tokyoYmd(new Date());
}

function buildApplicantAddress(c: HenkoCompanyRow): string {
  const zip = (c.legalPostalCode ?? "").replace(/\D/g, "");
  const head = zip.length === 7 ? `〒${zip.slice(0, 3)}-${zip.slice(3)}　` : "";
  const body = [c.legalPrefecture?.trim(), c.legalStreetAddress?.trim()].filter(Boolean).join("");
  return `${head}${body}`.trim();
}

function buildApplicantName(c: HenkoCompanyRow): string {
  const t = c.legalTradeName?.trim() ?? "";
  const r = c.legalRepresentativeName?.trim() ?? "";
  if (t && r) return `${t}　${r}`;
  return t || r || c.tenantName;
}

function buildCommissionAddressee(c: HenkoCompanyRow): string {
  const p = c.legalPublicSafetyCommission?.trim();
  if (p) return /公安委員会/u.test(p) ? p : `${p}公安委員会`;
  const pref = c.legalPrefecture?.trim();
  return pref ? `${pref}公安委員会` : "";
}

function buildPlateText(v: HenkoVehicleRow): string {
  const p = (v.plate ?? "").trim();
  return p || v.label;
}

function HenkoKisaiPrintBlock(): JSX.Element {
  const [kind, setKind] = useState<HenkoKind>("mutual_aid_renewal");
  const [company, setCompany] = useState<HenkoCompanyRow | null>(null);
  const [vehicles, setVehicles] = useState<HenkoVehicleRow[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [printErr, setPrintErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [submittedOn, setSubmittedOn] = useState<string>(todayYmd);
  const [addresseeCommission, setAddresseeCommission] = useState("");
  const [applicantName, setApplicantName] = useState("");
  const [applicantAddress, setApplicantAddress] = useState("");
  const [mainOfficeName, setMainOfficeName] = useState("");
  const [mainOfficeAddress, setMainOfficeAddress] = useState("");
  const [certifiedCommission, setCertifiedCommission] = useState("");
  const [certificationNumber, setCertificationNumber] = useState("");
  const [changedOn, setChangedOn] = useState<string>(todayYmd);
  const [changeReason, setChangeReason] = useState("");

  const [newCoverageFrom, setNewCoverageFrom] = useState("");
  const [newCoverageTo, setNewCoverageTo] = useState("");
  const [oldCoverageFrom, setOldCoverageFrom] = useState("");
  const [oldCoverageTo, setOldCoverageTo] = useState("");

  const [newPlateText, setNewPlateText] = useState("");
  const [oldPlateText, setOldPlateText] = useState("");
  const [swapNewVid, setSwapNewVid] = useState<string>("");
  const [swapOldVid, setSwapOldVid] = useState<string>("");

  const [newTradeName, setNewTradeName] = useState("");
  const [oldTradeName, setOldTradeName] = useState("");

  const appliedDefaultsRef = useRef(false);

  const reload = useCallback(async () => {
    setLoadErr(null);
    const [c, v] = await Promise.all([
      apiFetch<HenkoCompanyRow>("/settings/company"),
      apiFetch<{ vehicles: HenkoVehicleRow[] }>("/settings/vehicles"),
    ]);
    if (!c.ok) {
      setLoadErr(c.error);
      return;
    }
    setCompany(c.data);
    if (v.ok) setVehicles(v.data.vehicles ?? []);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 会社情報がロードできたら共通欄を一度だけ自動投入
  useEffect(() => {
    if (!company || appliedDefaultsRef.current) return;
    appliedDefaultsRef.current = true;
    setAddresseeCommission(buildCommissionAddressee(company));
    setApplicantName(buildApplicantName(company));
    setApplicantAddress(buildApplicantAddress(company));
    setMainOfficeName((company.legalMainOfficeName?.trim() || company.legalTradeName?.trim() || "").trim());
    setMainOfficeAddress((company.legalMainOfficeAddress?.trim() || buildApplicantAddress(company)).trim());
    setCertifiedCommission(buildCommissionAddressee(company));
    setCertificationNumber((company.legalCertificationNumber ?? "").trim());
  }, [company]);

  // kind 切り替え時の自動入力
  useEffect(() => {
    if (!company) return;
    if (kind === "mutual_aid_renewal") {
      setOldCoverageFrom(company.legalMutualAidContractFrom ?? "");
      setOldCoverageTo(company.legalMutualAidContractTo ?? "");
      setChangeReason("受託自動車共済契約の更新のため");
    } else if (kind === "escort_swap") {
      setChangeReason("随伴用自動車１台の入替のため");
    } else if (kind === "escort_add") {
      setChangeReason("随伴用自動車１台増車のため");
      const allPlates = vehicles.filter((v) => v.active).map(buildPlateText).filter(Boolean).join("\n");
      setOldPlateText(allPlates);
    } else if (kind === "trade_name_change") {
      setOldTradeName(company.legalTradeName ?? "");
      setChangeReason("主たる営業所の名称を変更したため");
    }
  }, [kind, company, vehicles]);

  // 入替: 旧・新車両を選んだら自動でテキスト入力欄に反映
  useEffect(() => {
    if (kind !== "escort_swap") return;
    if (swapNewVid) {
      const v = vehicles.find((x) => x.id === swapNewVid);
      if (v) setNewPlateText(buildPlateText(v));
    }
  }, [swapNewVid, vehicles, kind]);
  useEffect(() => {
    if (kind !== "escort_swap") return;
    if (swapOldVid) {
      const v = vehicles.find((x) => x.id === swapOldVid);
      if (v) setOldPlateText(buildPlateText(v));
    }
  }, [swapOldVid, vehicles, kind]);

  async function savePdf(): Promise<void> {
    setPrintErr(null);
    if (!submittedOn || !changedOn) {
      setPrintErr("提出年月日・変更年月日を入力してください");
      return;
    }
    const body: Record<string, unknown> = {
      kind,
      submittedOn,
      addresseeCommission,
      applicantName,
      applicantAddress,
      mainOfficeName,
      mainOfficeAddress,
      certifiedCommission,
      certificationNumber,
      changedOn,
      changeReason,
      outputFormat: "pdf",
    };
    if (kind === "mutual_aid_renewal") {
      body.newCoverageFrom = newCoverageFrom;
      body.newCoverageTo = newCoverageTo;
      body.oldCoverageFrom = oldCoverageFrom;
      body.oldCoverageTo = oldCoverageTo;
    } else if (kind === "escort_swap" || kind === "escort_add") {
      body.newEscortPlates = newPlateText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      body.oldEscortPlates = oldPlateText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    } else if (kind === "trade_name_change") {
      body.newTradeName = newTradeName;
      body.oldTradeName = oldTradeName;
    }

    setBusy(true);
    const r = await apiFetchBlob("/documents/henko-kisai-print", { method: "POST", json: body });
    setBusy(false);
    if (!r.ok) {
      setPrintErr(r.error);
      return;
    }
    downloadBrowserBlob(r.blob, r.filename ?? "daiko-henko-kisai.pdf");
  }

  const showCoverage = kind === "mutual_aid_renewal";
  const showPlates = kind === "escort_swap" || kind === "escort_add";
  const showTrade = kind === "trade_name_change";

  return (
    <div className="settings-section-panel" style={{ marginTop: "0.75rem" }}>
      <PanelHint>
        変更事項を選ぶと必要な入力欄が表示されます。会社情報・随伴車一覧から自動入力した内容を必要に応じて編集し、「PDFで保存」してください。
      </PanelHint>
      {loadErr ? (
        <p className="settings-hint" style={{ color: "var(--danger, #b00020)" }}>
          {loadErr}
        </p>
      ) : null}
      <div className="settings-form" style={{ marginTop: "0.75rem", maxWidth: "48rem" }}>
        <fieldset style={{ border: "none", padding: 0 }}>
          <legend className="settings-hint" style={{ marginBottom: "0.35rem" }}>
            変更事項
          </legend>
          {(
            [
              ["mutual_aid_renewal", "受託自動車共済契約の更新"],
              ["escort_swap", "随伴車の入替"],
              ["escort_add", "随伴車の増車"],
              ["trade_name_change", "屋号の変更"],
            ] as Array<[HenkoKind, string]>
          ).map(([k, label]) => (
            <label
              key={k}
              style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginTop: "0.2rem", cursor: "pointer" }}
            >
              <input type="radio" name="henkoKind" checked={kind === k} onChange={() => setKind(k)} disabled={busy} />
              {label}
            </label>
          ))}
        </fieldset>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem 1rem", marginTop: "0.75rem" }}>
          <label>提出年月日
            <input type="date" value={submittedOn} onChange={(e) => setSubmittedOn(e.target.value)} disabled={busy} />
          </label>
          <label>変更年月日
            <input type="date" value={changedOn} onChange={(e) => setChangedOn(e.target.value)} disabled={busy} />
          </label>
        </div>

        <label>宛先（〇〇県公安委員会）
          <input value={addresseeCommission} onChange={(e) => setAddresseeCommission(e.target.value)} disabled={busy} />
        </label>
        <label>申請者の氏名又は名称
          <input value={applicantName} onChange={(e) => setApplicantName(e.target.value)} disabled={busy} />
        </label>
        <label>申請者の住所
          <input value={applicantAddress} onChange={(e) => setApplicantAddress(e.target.value)} disabled={busy} />
        </label>
        <label>主たる営業所　名称
          <input value={mainOfficeName} onChange={(e) => setMainOfficeName(e.target.value)} disabled={busy} />
        </label>
        <label>主たる営業所　所在地
          <input value={mainOfficeAddress} onChange={(e) => setMainOfficeAddress(e.target.value)} disabled={busy} />
        </label>
        <label>認定をした公安委員会の名称
          <input value={certifiedCommission} onChange={(e) => setCertifiedCommission(e.target.value)} disabled={busy} />
        </label>
        <label>認定番号
          <input value={certificationNumber} onChange={(e) => setCertificationNumber(e.target.value)} disabled={busy} />
        </label>

        {showCoverage ? (
          <>
            <div style={{ marginTop: "0.5rem", fontWeight: 600 }}>変更事項：受託自動車共済契約期間</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem 1rem" }}>
              <label>新（開始）
                <input type="date" value={newCoverageFrom} onChange={(e) => setNewCoverageFrom(e.target.value)} disabled={busy} />
              </label>
              <label>新（終了）
                <input type="date" value={newCoverageTo} onChange={(e) => setNewCoverageTo(e.target.value)} disabled={busy} />
              </label>
              <label>旧（開始）
                <input type="date" value={oldCoverageFrom} onChange={(e) => setOldCoverageFrom(e.target.value)} disabled={busy} />
              </label>
              <label>旧（終了）
                <input type="date" value={oldCoverageTo} onChange={(e) => setOldCoverageTo(e.target.value)} disabled={busy} />
              </label>
            </div>
          </>
        ) : null}

        {showPlates ? (
          <>
            <div style={{ marginTop: "0.5rem", fontWeight: 600 }}>
              変更事項：{kind === "escort_swap" ? "随伴用自動車（入替）" : "随伴用自動車（増車）"}
            </div>
            {kind === "escort_swap" ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem 1rem" }}>
                <label>新（入替後の車両）
                  <select value={swapNewVid} onChange={(e) => setSwapNewVid(e.target.value)} disabled={busy}>
                    <option value="">（車両を選択）</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>{`${v.label}${v.plate ? `（${v.plate}）` : ""}`}</option>
                    ))}
                  </select>
                </label>
                <label>旧（入替前の車両）
                  <select value={swapOldVid} onChange={(e) => setSwapOldVid(e.target.value)} disabled={busy}>
                    <option value="">（車両を選択）</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>{`${v.label}${v.plate ? `（${v.plate}）` : ""}`}</option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
            <label>新（PDF に印字する車両ナンバー・1行1台）
              <textarea
                rows={kind === "escort_add" ? 5 : 2}
                value={newPlateText}
                onChange={(e) => setNewPlateText(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>旧（PDF に印字する車両ナンバー・1行1台）
              <textarea
                rows={kind === "escort_add" ? 5 : 2}
                value={oldPlateText}
                onChange={(e) => setOldPlateText(e.target.value)}
                disabled={busy}
              />
            </label>
          </>
        ) : null}

        {showTrade ? (
          <>
            <div style={{ marginTop: "0.5rem", fontWeight: 600 }}>変更事項：主たる営業所の名称（屋号）</div>
            <label>新（変更後の屋号）
              <input value={newTradeName} onChange={(e) => setNewTradeName(e.target.value)} disabled={busy} />
            </label>
            <label>旧（変更前の屋号）
              <input value={oldTradeName} onChange={(e) => setOldTradeName(e.target.value)} disabled={busy} />
            </label>
          </>
        ) : null}

        <label>変更理由
          <textarea rows={3} value={changeReason} onChange={(e) => setChangeReason(e.target.value)} disabled={busy} />
        </label>

        <p style={{ marginTop: "0.85rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
          <button type="button" className="settings-primary" disabled={busy} onClick={() => void savePdf()}>
            {busy ? "生成中…" : "PDFで保存"}
          </button>
          <Link to="/settings">設定（事業者情報・随伴車）へ</Link>
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

type AlcoholCheckRow = {
  id: string;
  businessDate: string;
  phase: string;
  employeeId: string;
  familyName: string;
  givenName: string;
  punchedAt: string;
  breathalyzerName: string | null;
  verificationMethod: string | null;
  alcoholDetected: boolean;
  instructionsNote: string | null;
  verifierName: string | null;
};

function tokyoYm(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit" })
    .format(new Date())
    .slice(0, 7);
}

function AlcoholCheckPrintBlock(): JSX.Element {
  const { me } = useAuth();
  const [yearMonth, setYearMonth] = useState(tokyoYm);
  const [rows, setRows] = useState<AlcoholCheckRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfErr, setPdfErr] = useState<string | null>(null);

  const load = useCallback(async (ym: string) => {
    setLoading(true);
    setErr(null);
    const r = await apiFetch<{ rows: AlcoholCheckRow[] }>(`/attendance/timecard/alcohol-checks?yearMonth=${encodeURIComponent(ym)}`);
    setLoading(false);
    if (!r.ok) { setErr(r.error); return; }
    setRows(r.data.rows ?? []);
  }, []);

  useEffect(() => { void load(yearMonth); }, [yearMonth, load]);

  async function savePdf(): Promise<void> {
    setPdfBusy(true);
    setPdfErr(null);
    const r = await apiFetchBlob("/documents/alcohol-check-pdf", {
      method: "POST",
      json: { yearMonth, outputFormat: "pdf" },
    });
    setPdfBusy(false);
    if (!r.ok) { setPdfErr(r.error); return; }
    downloadBrowserBlob(r.blob, r.filename ?? `alcohol-check_${yearMonth}.pdf`);
  }

  const [y, m] = yearMonth.split("-");

  return (
    <div style={{ marginTop: "0.75rem" }}>
      <div className="settings-toolbar" style={{ marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 500 }}>
          年月
          <input
            type="month"
            value={yearMonth}
            onChange={(e) => setYearMonth(e.target.value)}
            style={{ padding: "0.3rem 0.5rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", fontSize: "0.85rem" }}
          />
        </label>
        <button type="button" className="settings-secondary" onClick={() => {
          const d = new Date(`${yearMonth}-01`);
          d.setMonth(d.getMonth() - 1);
          setYearMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
        }}>◀ 前月</button>
        <button type="button" className="settings-secondary" onClick={() => setYearMonth(tokyoYm())}>今月</button>
        <button type="button" className="settings-secondary" onClick={() => {
          const d = new Date(`${yearMonth}-01`);
          d.setMonth(d.getMonth() + 1);
          setYearMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
        }}>次月 ▶</button>
      </div>

      {err ? <p style={{ color: "var(--color-accent)" }}>{err}</p> : null}
      {loading ? <p className="settings-hint">読み込み中…</p> : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ background: "var(--color-section-bg)" }}>
                {["日付", "氏名", "区分", "検知器", "確認方法", "酒気帯び", "指示事項", "確認者"].map((h) => (
                  <th key={h} style={{ padding: "0.4rem 0.6rem", textAlign: "left", borderBottom: "2px solid var(--color-border)", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: "1rem", textAlign: "center", color: "var(--color-muted)" }}>記録なし</td></tr>
              ) : rows.map((row) => (
                <tr key={row.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td style={{ padding: "0.35rem 0.6rem", whiteSpace: "nowrap" }}>
                    {formatFlexDatetime(row.punchedAt, row.businessDate, me?.dayChangeHour ?? 28)}
                  </td>
                  <td style={{ padding: "0.35rem 0.6rem", whiteSpace: "nowrap" }}>{row.familyName} {row.givenName}</td>
                  <td style={{ padding: "0.35rem 0.6rem", whiteSpace: "nowrap" }}>{row.phase}</td>
                  <td style={{ padding: "0.35rem 0.6rem" }}>{row.breathalyzerName ?? "—"}</td>
                  <td style={{ padding: "0.35rem 0.6rem" }}>{row.verificationMethod ?? "—"}</td>
                  <td style={{ padding: "0.35rem 0.6rem", color: row.alcoholDetected ? "#dc2626" : undefined, fontWeight: row.alcoholDetected ? 700 : undefined }}>
                    {row.alcoholDetected ? "あり" : "なし"}
                  </td>
                  <td style={{ padding: "0.35rem 0.6rem", maxWidth: "160px", wordBreak: "break-all" }}>{row.instructionsNote || "—"}</td>
                  <td style={{ padding: "0.35rem 0.6rem", whiteSpace: "nowrap" }}>{row.verifierName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="settings-primary" disabled={pdfBusy || loading} onClick={() => void savePdf()}>
          {pdfBusy ? "生成中…" : `PDFで保存（${y}年${Number(m)}月）`}
        </button>
        {pdfErr ? <span style={{ color: "#dc2626", fontSize: "0.82rem" }}>{pdfErr}</span> : null}
      </div>
    </div>
  );
}

export default function DocumentsPage(): JSX.Element {
  const { me } = useAuth();
  const [tab, setTab] = useState("nippo");

  const tabItems: TabDef[] = [
    {
      id: "nippo",
      label: "日報",
      children: <DailyReportJommuPrintBlock />,
    },
    {
      id: "alcohol-check",
      label: "アルコール点検",
      children: <AlcoholCheckPrintBlock />,
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
      id: "ryokinhyo",
      label: "料金表",
      children: <FareTablePrintBlock />,
    },
    {
      id: "yakkan",
      label: "約款",
      children: <YakkanPrintBlock />,
    },
    {
      id: "shido",
      label: "指導記録簿",
      children: (
        <div className="settings-section-panel" style={{ marginTop: "0.75rem" }}>
          <InstructionRecordListPrintBlock />
        </div>
      ),
    },
    {
      id: "kujo",
      label: "苦情処理簿",
      children: (
        <div className="settings-section-panel" style={{ marginTop: "0.75rem" }}>
          <ComplaintLedgerPrintBlock />
        </div>
      ),
    },
    {
      id: "henko",
      label: "変更届出書",
      children: <HenkoKisaiPrintBlock />,
    },
  ];

  const visTabs = me ? filterSubTabsForMe("documents", tabItems, me) : tabItems;
  const visTabKey = visTabs.map((t) => t.id).join(",");

  useEffect(() => {
    if (!visTabs.some((t) => t.id === tab)) {
      setTab(visTabs[0]?.id ?? "nippo");
    }
  }, [tab, visTabKey]);

  return (
    <Card title="書類を作る">
      <p className="settings-hint" style={{ marginTop: 0 }}>
        帳票・様式は種類ごとのタブに分けています。出力機能は順次追加します。
      </p>
      <Tabs items={visTabs} activeId={tab} onActiveChange={setTab} aria-label="書類の種類" />
    </Card>
  );
}

import { useEffect, useState } from "react";
import { apiFetch, apiFetchBlob } from "../api";
import { Card, Err, FieldWithHint, Tabs } from "../ui";

type CatDoc = { kind: string; label: string; dataSources: string };

type MissingField = { key: string; labelJa: string };

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Documents(): JSX.Element {
  const [docTab, setDocTab] = useState("params");
  const [catalog, setCatalog] = useState<CatDoc[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ym, setYm] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [businessDate, setBusinessDate] = useState(todayYmd);
  const [employeeId, setEmployeeId] = useState("");
  const [employees, setEmployees] = useState<{ id: string; familyName: string; givenName: string; status: string }[]>(
    [],
  );
  const [activeKind, setActiveKind] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [dataPreview, setDataPreview] = useState<string | null>(null);
  const [missing, setMissing] = useState<MissingField[] | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await apiFetch<{ documents: CatDoc[] }>("/documents/legal-catalog");
      if (r.ok) setCatalog(r.data.documents);
      else setErr(r.error);
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const r = await apiFetch<{ employees: { id: string; familyName: string; givenName: string; status: string }[] }>(
        "/employees?status=active",
      );
      if (r.ok) setEmployees(r.data.employees);
    })();
  }, []);

  function previewBody(kind: string): Record<string, unknown> {
    const body: Record<string, unknown> = { kind, periodYm: ym };
    if (kind === "joroku_kensyu") body.businessDate = businessDate;
    if (kind === "seiyaku_jukyu") body.employeeId = employeeId || undefined;
    return body;
  }

  async function previewAuto(kind: string): Promise<void> {
    setErr(null);
    setActiveKind(kind);
    setDocTab("preview");
    const r = await apiFetch<{
      html: string;
      data?: Record<string, string>;
      missingRequired?: MissingField[];
    }>("/documents/preview-auto", {
      method: "POST",
      json: previewBody(kind),
    });
    if (!r.ok) setErr(r.error);
    else {
      setHtml(r.data.html);
      setDataPreview(r.data.data ? JSON.stringify(r.data.data, null, 2) : null);
      setMissing(r.data.missingRequired ?? []);
    }
  }

  async function pdfAuto(kind: string): Promise<void> {
    setErr(null);
    const r = await apiFetchBlob("/documents/render-pdf-auto", {
      method: "POST",
      json: previewBody(kind),
    });
    if (!r.ok) {
      setErr(
        r.status === 403
          ? `${r.error}（プランで PDF 無効のときはブラウザ印刷を利用してください）`
          : r.error,
      );
      return;
    }
    const url = URL.createObjectURL(r.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = r.filename || `${kind}-auto.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card title="法令の書類（自動で埋める）">
      <Err msg={err} />
      <Tabs
        aria-label="帳票ビュー"
        activeId={docTab}
        onActiveChange={setDocTab}
        items={[
          {
            id: "params",
            label: "条件",
            children: (
              <>
                <p style={{ fontSize: "0.85rem", marginTop: 0 }}>
                  テナント設定の届出プロフィールと、日報・苦情などのデータから、PDF に近い形で自動埋めします。印刷はプレビューのあとブラウザの印刷を使ってください。
                </p>
                <div className="stack-form">
                  <FieldWithHint label="表示に使う月" hint="集計や一覧の基準になる月です（YYYY-MM）。">
                    <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} />
                  </FieldWithHint>
                  <FieldWithHint label="乗務記録・アルコール検査用の運行日" hint="1日単位で選びます（YYYY-MM-DD）。">
                    <input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
                  </FieldWithHint>
                  <FieldWithHint label="誓約書に使うスタッフ" optional hint="未選択のままなら、誓約書以外は影響しません。">
                    <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} style={{ minWidth: 220 }}>
                      <option value="">（未選択）</option>
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.familyName} {e.givenName}
                        </option>
                      ))}
                    </select>
                  </FieldWithHint>
                </div>
              </>
            ),
          },
          {
            id: "list",
            label: "書類一覧",
            children: (
              <div style={{ display: "grid", gap: "0.75rem" }}>
                {catalog.map((d) => (
                  <section key={d.kind} className="card" style={{ marginBottom: 0 }}>
                    <h3 style={{ margin: "0 0 0.35rem", fontSize: "1rem" }}>{d.label}</h3>
                    <p style={{ fontSize: "0.75rem", margin: "0 0 0.5rem", color: "var(--color-muted)" }}>
                      <code>{d.kind}</code>
                    </p>
                    <p style={{ fontSize: "0.8rem", margin: "0 0 0.5rem" }}>{d.dataSources}</p>
                    <button type="button" onClick={() => void previewAuto(d.kind)}>
                      プレビュー（自動埋め）
                    </button>{" "}
                    <button type="button" onClick={() => void pdfAuto(d.kind)}>
                      PDF（自動埋め）
                    </button>
                  </section>
                ))}
              </div>
            ),
          },
          {
            id: "preview",
            label: "プレビュー",
            children: html ? (
              <section className="card" style={{ marginBottom: 0 }}>
                <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>{activeKind ? `プレビュー: ${activeKind}` : "プレビュー"}</h3>
                {missing && missing.length > 0 ? (
                  <div
                    style={{
                      marginBottom: "0.5rem",
                      padding: "0.5rem 0.65rem",
                      background: "#fff8e6",
                      border: "1px solid #e6c200",
                      fontSize: "0.85rem",
                    }}
                  >
                    <strong>未入力の必須項目</strong>
                    <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.2rem" }}>
                      {missing.map((m) => (
                        <li key={m.key}>
                          {m.labelJa} <code style={{ fontSize: "0.75rem" }}>{m.key}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {dataPreview ? (
                  <details style={{ marginBottom: "0.5rem" }}>
                    <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>埋め込みデータ（JSON）</summary>
                    <pre style={{ fontSize: "0.7rem", overflow: "auto", maxHeight: 160 }}>{dataPreview}</pre>
                  </details>
                ) : null}
                <iframe title="doc-preview" srcDoc={html} style={{ width: "100%", height: 520, border: "1px solid var(--color-border)" }} />
              </section>
            ) : (
              <p style={{ fontSize: "0.9rem", color: "var(--color-muted)", margin: 0 }}>
                「書類一覧」でプレビュー（自動埋め）を実行すると、ここに HTML プレビューが表示されます。
              </p>
            ),
          },
        ]}
      />
    </Card>
  );
}

import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { REGISTER_EXTENSION_UI_FIELDS } from "../lib/registerExtensionFields";
import { Card, Err, StepWizard, type StepWizardStep } from "../ui";

type RegisterExt = Record<string, string>;

type Emp = {
  id: string;
  familyName: string;
  givenName: string;
  furigana: string | null;
  address: string | null;
  registerExtension: unknown;
  status: string;
};

const GENDER_OPTIONS = ["男", "女", "その他"] as const;
const EMPLOYMENT_TYPE_OPTIONS = ["正規雇用", "非正規雇用（アルバイト・パート等）"] as const;

function ymdOk(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

function asExt(raw: unknown): RegisterExt {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: RegisterExt = {};
  for (const [k, v] of Object.entries(o)) {
    if (v == null) continue;
    out[k] = String(v);
  }
  return out;
}

function ext(e: Emp, key: string): string {
  return asExt(e.registerExtension)[key] ?? "";
}

function emptyCreateExt(): RegisterExt {
  return {
    gender: "",
    postalCode: "",
    dateOfBirthYmd: "",
    phoneHome: "",
    phoneMobile: "",
    emergencyContactName: "",
    emergencyPhone: "",
    hiredOnYmd: "",
    employmentType: "",
    interviewerName: "",
    licenseTypes: "",
    licenseNumber: "",
    licenseExpiresOnYmd: "",
    licenseConditionsNote: "",
    licenseOtherNotes: "",
  };
}

export default function Employees(): JSX.Element {
  const [rows, setRows] = useState<Emp[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [addWizardOpen, setAddWizardOpen] = useState(false);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [familyName, setFamilyName] = useState("");
  const [givenName, setGivenName] = useState("");
  const [newFurigana, setNewFurigana] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [createExt, setCreateExt] = useState<RegisterExt>(() => emptyCreateExt());
  const [editId, setEditId] = useState<string | null>(null);
  const [editFamily, setEditFamily] = useState("");
  const [editGiven, setEditGiven] = useState("");
  const [editFurigana, setEditFurigana] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editExt, setEditExt] = useState<RegisterExt>({});

  async function load(): Promise<void> {
    const r = await apiFetch<{ employees: Emp[] }>("/employees?status=all");
    if (r.ok) setRows(r.data.employees);
    else setErr(r.error);
  }

  useEffect(() => {
    void load();
  }, []);

  function setCreateField(key: string, v: string): void {
    setCreateExt((p) => ({ ...p, [key]: v }));
  }

  function resetAddFields(): void {
    setFamilyName("");
    setGivenName("");
    setNewFurigana("");
    setNewAddress("");
    setCreateExt(emptyCreateExt());
  }

  function closeAddWizard(): void {
    setAddWizardOpen(false);
    resetAddFields();
  }

  async function submitNewEmployee(): Promise<void> {
    setErr(null);
    setAddSubmitting(true);
    try {
      const registerExtension: Record<string, string> = {
        gender: createExt.gender.trim(),
        postalCode: createExt.postalCode.trim(),
        dateOfBirthYmd: createExt.dateOfBirthYmd.trim(),
        phoneHome: (createExt.phoneHome ?? "").trim(),
        phoneMobile: (createExt.phoneMobile ?? "").trim(),
        emergencyContactName: createExt.emergencyContactName.trim(),
        emergencyPhone: createExt.emergencyPhone.trim(),
        hiredOnYmd: createExt.hiredOnYmd.trim(),
        employmentType: createExt.employmentType.trim(),
        interviewerName: createExt.interviewerName.trim(),
        licenseTypes: createExt.licenseTypes.trim(),
        licenseNumber: createExt.licenseNumber.trim(),
        licenseExpiresOnYmd: createExt.licenseExpiresOnYmd.trim(),
      };
      if (createExt.licenseConditionsNote.trim()) {
        registerExtension.licenseConditionsNote = createExt.licenseConditionsNote.trim();
      }
      if (createExt.licenseOtherNotes.trim()) {
        registerExtension.licenseOtherNotes = createExt.licenseOtherNotes.trim();
      }

      const r = await apiFetch<Emp>("/employees", {
        method: "POST",
        json: {
          familyName: familyName.trim(),
          givenName: givenName.trim(),
          furigana: newFurigana.trim(),
          address: newAddress.trim(),
          registerExtension,
        },
      });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      resetAddFields();
      setAddWizardOpen(false);
      await load();
    } finally {
      setAddSubmitting(false);
    }
  }

  const nameOk = familyName.trim().length > 0 && givenName.trim().length > 0;
  const stepRosterPersonOk =
    newFurigana.trim().length > 0 && createExt.gender.trim().length > 0 && ymdOk(createExt.dateOfBirthYmd ?? "");
  const stepAddressOk = createExt.postalCode.trim().length > 0 && newAddress.trim().length > 0;
  const stepContactOk =
    ((createExt.phoneHome ?? "").trim().length > 0 || (createExt.phoneMobile ?? "").trim().length > 0) &&
    createExt.emergencyContactName.trim().length > 0 &&
    createExt.emergencyPhone.trim().length > 0;
  const stepEmploymentOk =
    ymdOk(createExt.hiredOnYmd ?? "") &&
    createExt.employmentType.trim().length > 0 &&
    createExt.interviewerName.trim().length > 0;
  const stepLicenseOk =
    createExt.licenseTypes.trim().length > 0 &&
    createExt.licenseNumber.trim().length > 0 &&
    ymdOk(createExt.licenseExpiresOnYmd ?? "");
  const allCreateOk =
    nameOk &&
    stepRosterPersonOk &&
    stepAddressOk &&
    stepContactOk &&
    stepEmploymentOk &&
    stepLicenseOk;

  const addSteps: StepWizardStep[] = [
    {
      id: "name",
      title: "氏名",
      description: "従事者名簿の「氏名」欄です。姓・名は必須です。",
      canProceed: nameOk,
      children: (
        <>
          <label>姓</label>
          <input value={familyName} onChange={(e) => setFamilyName(e.target.value)} autoFocus />
          <label>名</label>
          <input value={givenName} onChange={(e) => setGivenName(e.target.value)} />
        </>
      ),
    },
    {
      id: "roster_person",
      title: "フリガナ・性別・生年月日",
      description: "名簿の氏名行（フリガナ・男・女・生年月日）に相当します。生年月日はカレンダーで選択してください。",
      canProceed: stepRosterPersonOk,
      children: (
        <>
          <label>フリガナ（必須）</label>
          <input value={newFurigana} onChange={(e) => setNewFurigana(e.target.value)} placeholder="例: ヤマダ タロウ" />
          <label>性別</label>
          <select value={createExt.gender ?? ""} onChange={(e) => setCreateField("gender", e.target.value)}>
            <option value="">選択してください</option>
            {GENDER_OPTIONS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <label>生年月日</label>
          <input
            type="date"
            value={createExt.dateOfBirthYmd ?? ""}
            onChange={(e) => setCreateField("dateOfBirthYmd", e.target.value)}
          />
        </>
      ),
    },
    {
      id: "address",
      title: "住所（〒・住所）",
      description: "名簿の住所欄です。郵便番号と住所の両方が必要です。",
      canProceed: stepAddressOk,
      children: (
        <>
          <label>郵便番号（必須）</label>
          <input
            value={createExt.postalCode ?? ""}
            onChange={(e) => setCreateField("postalCode", e.target.value)}
            placeholder="例: 1234567"
          />
          <label>住所（必須）</label>
          <textarea rows={3} value={newAddress} onChange={(e) => setNewAddress(e.target.value)} style={{ width: "100%", maxWidth: 480 }} />
        </>
      ),
    },
    {
      id: "contact",
      title: "連絡先",
      description: "自宅または携帯のいずれかは必須です。緊急連絡先の氏名・電話も必須です。",
      canProceed: stepContactOk,
      children: (
        <>
          <label>電話（自宅）</label>
          <input value={createExt.phoneHome ?? ""} onChange={(e) => setCreateField("phoneHome", e.target.value)} />
          <label>電話（携帯）</label>
          <input value={createExt.phoneMobile ?? ""} onChange={(e) => setCreateField("phoneMobile", e.target.value)} />
          <p style={{ fontSize: "0.8rem", margin: "0.25rem 0 0.5rem", opacity: 0.85 }}>
            自宅・携帯のどちらか一方以上を入力してください。
          </p>
          <label>緊急連絡先 氏名（必須）</label>
          <input
            value={createExt.emergencyContactName ?? ""}
            onChange={(e) => setCreateField("emergencyContactName", e.target.value)}
          />
          <label>緊急連絡先 電話（必須）</label>
          <input value={createExt.emergencyPhone ?? ""} onChange={(e) => setCreateField("emergencyPhone", e.target.value)} />
        </>
      ),
    },
    {
      id: "employment",
      title: "採用・面接",
      description: "採用年月日・採用区分・面接担当者名は名簿の該当欄に相当します。",
      canProceed: stepEmploymentOk,
      children: (
        <>
          <label>採用年月日</label>
          <input type="date" value={createExt.hiredOnYmd ?? ""} onChange={(e) => setCreateField("hiredOnYmd", e.target.value)} />
          <label>採用区分</label>
          <select value={createExt.employmentType ?? ""} onChange={(e) => setCreateField("employmentType", e.target.value)}>
            <option value="">選択してください</option>
            {EMPLOYMENT_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <label>面接担当者名</label>
          <input value={createExt.interviewerName ?? ""} onChange={(e) => setCreateField("interviewerName", e.target.value)} />
        </>
      ),
    },
    {
      id: "license",
      title: "運転免許",
      description: "種類・番号・有効期限は必須です。条件・限定や「その他」は任意です（写し添付は紙で保管してください）。",
      canProceed: stepLicenseOk,
      children: (
        <>
          <label>免許の種類（必須）</label>
          <input
            value={createExt.licenseTypes ?? ""}
            onChange={(e) => setCreateField("licenseTypes", e.target.value)}
            placeholder="例: 普通一種"
          />
          <label>免許証の番号（必須）</label>
          <input value={createExt.licenseNumber ?? ""} onChange={(e) => setCreateField("licenseNumber", e.target.value)} />
          <label>有効期限</label>
          <input
            type="date"
            value={createExt.licenseExpiresOnYmd ?? ""}
            onChange={(e) => setCreateField("licenseExpiresOnYmd", e.target.value)}
          />
          <label>免許の条件等（任意）</label>
          <textarea
            rows={2}
            value={createExt.licenseConditionsNote ?? ""}
            onChange={(e) => setCreateField("licenseConditionsNote", e.target.value)}
            style={{ width: "100%", maxWidth: 480 }}
          />
          <label>その他・免許欄（任意）</label>
          <textarea
            rows={2}
            value={createExt.licenseOtherNotes ?? ""}
            onChange={(e) => setCreateField("licenseOtherNotes", e.target.value)}
            style={{ width: "100%", maxWidth: 480 }}
          />
        </>
      ),
    },
    {
      id: "confirm",
      title: "内容の確認",
      description: "問題なければ「登録する」で保存します。写真・免許写しは名簿様式どおり紙で保管してください。",
      canProceed: allCreateOk,
      children: (
        <dl className="step-wizard-summary">
          <dt>氏名</dt>
          <dd>
            {familyName.trim()} {givenName.trim()}
          </dd>
          <dt>フリガナ</dt>
          <dd>{newFurigana.trim()}</dd>
          <dt>性別 / 生年月日</dt>
          <dd>
            {createExt.gender} / {createExt.dateOfBirthYmd}
          </dd>
          <dt>郵便番号 / 住所</dt>
          <dd>
            〒{createExt.postalCode} {newAddress.trim()}
          </dd>
          <dt>電話</dt>
          <dd>
            自宅: {createExt.phoneHome || "—"} / 携帯: {createExt.phoneMobile || "—"}
          </dd>
          <dt>緊急連絡先</dt>
          <dd>
            {createExt.emergencyContactName}（{createExt.emergencyPhone}）
          </dd>
          <dt>採用 / 区分 / 面接担当</dt>
          <dd>
            {createExt.hiredOnYmd} / {createExt.employmentType} / {createExt.interviewerName}
          </dd>
          <dt>免許</dt>
          <dd>
            {createExt.licenseTypes} 第{createExt.licenseNumber}号 有効 {createExt.licenseExpiresOnYmd}
            {createExt.licenseConditionsNote.trim() ? ` / 条件: ${createExt.licenseConditionsNote.trim()}` : ""}
            {createExt.licenseOtherNotes.trim() ? ` / その他: ${createExt.licenseOtherNotes.trim()}` : ""}
          </dd>
        </dl>
      ),
    },
  ];

  function openEdit(e: Emp): void {
    setEditId(e.id);
    setEditFamily(e.familyName);
    setEditGiven(e.givenName);
    setEditFurigana(e.furigana ?? "");
    setEditAddress(e.address ?? "");
    setEditExt(asExt(e.registerExtension));
  }

  function setExtField(key: string, v: string): void {
    setEditExt((prev) => ({ ...prev, [key]: v }));
  }

  async function saveEdit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!editId) return;
    setErr(null);
    const r = await apiFetch(`/employees/${editId}`, {
      method: "PATCH",
      json: {
        familyName: editFamily.trim(),
        givenName: editGiven.trim(),
        furigana: editFurigana.trim() || null,
        address: editAddress.trim() || null,
        registerExtension: editExt,
      },
    });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else {
      setEditId(null);
      await load();
    }
  }

  async function retire(id: string): Promise<void> {
    setErr(null);
    const r = await apiFetch(`/employees/${id}`, { method: "PATCH", json: { status: "RETIRED" } });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else await load();
  }

  return (
    <Card title="従業員">
      <Err msg={err} />
      <p style={{ fontSize: "0.82rem", marginTop: 0 }}>
        新規追加は従事者名簿の項目（氏名・フリガナ・性別・生年月日・住所・連絡先・採用・免許など）をウィザードで入力します。一覧の免許・電話は参照のみです。退職日や続柄などは「名簿・基本情報」から追加入力できます。
      </p>
      <p style={{ marginTop: "0.5rem" }}>
        <button type="button" onClick={() => setAddWizardOpen(true)}>
          従業員を追加
        </button>
      </p>
      <StepWizard
        open={addWizardOpen}
        onClose={closeAddWizard}
        title="従業員を追加（従事者名簿項目）"
        steps={addSteps}
        finishLabel="登録する"
        onFinish={submitNewEmployee}
        isSubmitting={addSubmitting}
      />
      <div className="table-wrap">
        <table style={{ fontSize: "0.78rem", borderCollapse: "collapse", minWidth: 720 }}>
          <thead>
            <tr>
              <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>氏名</th>
              <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>ふりがな</th>
              <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>携帯</th>
              <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>免許種別</th>
              <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>免許番号</th>
              <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>有効期限</th>
              <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>状態</th>
              <th style={{ border: "1px solid #ccc", padding: "4px 6px" }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id}>
                <td style={{ border: "1px solid #ccc", padding: "4px 6px", whiteSpace: "nowrap" }}>
                  {x.familyName} {x.givenName}
                </td>
                <td style={{ border: "1px solid #ccc", padding: "4px 6px", maxWidth: 120 }}>{x.furigana ?? ""}</td>
                <td style={{ border: "1px solid #ccc", padding: "4px 6px" }}>{ext(x, "phoneMobile")}</td>
                <td style={{ border: "1px solid #ccc", padding: "4px 6px" }}>{ext(x, "licenseTypes")}</td>
                <td style={{ border: "1px solid #ccc", padding: "4px 6px" }}>{ext(x, "licenseNumber")}</td>
                <td style={{ border: "1px solid #ccc", padding: "4px 6px", whiteSpace: "nowrap" }}>{ext(x, "licenseExpiresOnYmd")}</td>
                <td style={{ border: "1px solid #ccc", padding: "4px 6px" }}>{x.status}</td>
                <td style={{ border: "1px solid #ccc", padding: "4px 6px", whiteSpace: "nowrap" }}>
                  <button type="button" onClick={() => openEdit(x)}>
                    名簿・基本情報
                  </button>{" "}
                  {x.status === "ACTIVE" ? (
                    <button type="button" onClick={() => void retire(x.id)}>
                      退職
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editId ? (
        <details open style={{ marginTop: "1rem" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>従事者名簿用・基本情報（編集中）</summary>
          <div style={{ marginTop: "0.5rem", padding: "0.75rem", border: "1px solid #ccc", borderRadius: 4 }}>
            <form onSubmit={(e) => void saveEdit(e)}>
              <label>姓</label>
              <input value={editFamily} onChange={(e) => setEditFamily(e.target.value)} required />
              <label>名</label>
              <input value={editGiven} onChange={(e) => setEditGiven(e.target.value)} required />
              <label>ふりがな</label>
              <input value={editFurigana} onChange={(e) => setEditFurigana(e.target.value)} />
              <label>住所</label>
              <textarea rows={2} value={editAddress} onChange={(e) => setEditAddress(e.target.value)} style={{ width: "100%" }} />
              {REGISTER_EXTENSION_UI_FIELDS.map((f) => (
                <div key={f.key} style={{ marginTop: "0.35rem" }}>
                  <label>{f.label}</label>
                  {f.key === "educationNotes" || f.key === "rosterNotes" || f.key === "licenseConditionsNote" || f.key === "licenseOtherNotes" ? (
                    <textarea
                      rows={2}
                      value={editExt[f.key] ?? ""}
                      onChange={(e) => setExtField(f.key, e.target.value)}
                      style={{ width: "100%", maxWidth: 420 }}
                    />
                  ) : (
                    <input
                      value={editExt[f.key] ?? ""}
                      onChange={(e) => setExtField(f.key, e.target.value)}
                      style={{ width: "100%", maxWidth: 420 }}
                    />
                  )}
                </div>
              ))}
              <div style={{ marginTop: "0.75rem" }}>
                <button type="submit">保存</button>{" "}
                <button type="button" onClick={() => setEditId(null)}>
                  閉じる
                </button>
              </div>
            </form>
          </div>
        </details>
      ) : null}
    </Card>
  );
}

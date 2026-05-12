import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { REGISTER_EXTENSION_UI_FIELDS } from "../lib/registerExtensionFields";
import { ReqMark } from "../lib/reqLabel";
import { Card, Err, FieldWithHint, StepWizard, Tabs, type StepWizardStep } from "../ui";

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

/** 名簿の追加項目の下に出す一言説明（表示のみ） */
const EXT_FIELD_HINTS: Record<string, string> = {
  gender: "名簿の「性別」欄に相当します。",
  postalCode: "ハイフンなしの数字でも構いません。",
  dateOfBirthYmd: "カレンダーから選ぶと間違いが減ります。",
  phoneHome: "日中つながりやすい番号があれば入力してください。",
  phoneMobile: "携帯が主連絡先のことが多いです。",
  emergencyContactName: "事故や急病のとき、まず連絡する方の氏名です。",
  emergencyPhone: "つながりやすい番号を入れてください。",
  emergencyAddress: "緊急連絡先の方の住所です（空欄可の場合もあります）。",
  emergencyRelation: "「配偶者」「父」など続柄を書きます。",
  hiredOnYmd: "雇用を始めた日です。",
  retiredOnYmd: "退職した日が分かる場合に記入します。",
  employmentType: "正社員かアルバイトかなど、名簿の区分に合わせて選びます。",
  interviewerName: "面接に参加した担当者名です。",
  jobCategory: "ドライバー・事務など、現場で分かる呼び方で構いません。",
  licenseTypes: "例: 普通一種。名簿の免許欄にそのまま載せます。",
  licenseNumber: "免許証に印刷されている番号です。",
  licenseExpiresOnYmd: "有効期限が切れる前に更新してください。",
  licenseConditionsNote: "眼鏡着用など、証に条件が書いてある場合のメモです。",
  licenseOtherNotes: "紙の写しとあわせて社内で共有したい補足があれば書きます。",
  pledgeSignedOnYmd: "誓約書に署名した日を記録します。",
  educationNotes: "講習の受講日や内容のメモです。",
  rosterNotes: "名簿に書ききれない社内向けの補足です。",
};

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
  const [empTab, setEmpTab] = useState<"list" | "guide">("list");

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
      title: "お名前",
      description: "従事者名簿の「氏名」です。姓と名の両方が必要です。",
      canProceed: nameOk,
      children: (
        <>
          <FieldWithHint label={<><ReqMark />姓</>} hint="戸籍や身分証と同じ漢字で書いてください。">
            <input value={familyName} onChange={(e) => setFamilyName(e.target.value)} autoFocus required aria-required />
          </FieldWithHint>
          <FieldWithHint label={<><ReqMark />名</>} hint="ミドルネームがある場合は名にまとめても構いません。">
            <input value={givenName} onChange={(e) => setGivenName(e.target.value)} required aria-required />
          </FieldWithHint>
        </>
      ),
    },
    {
      id: "roster_person",
      title: "ふりがな・性別・生まれた日",
      description: "名簿の氏名の行（ふりがな・性別・生年月日）にあたります。生まれた日はカレンダーから選べます。",
      canProceed: stepRosterPersonOk,
      children: (
        <>
          <FieldWithHint label={<><ReqMark />ふりがな（カタカナ）</>} hint="名簿や公的書類で使う読み方をカタカナで書きます。">
            <input value={newFurigana} onChange={(e) => setNewFurigana(e.target.value)} placeholder="例: ヤマダ タロウ" required aria-required />
          </FieldWithHint>
          <FieldWithHint label={<><ReqMark />性別</>} hint="名簿の区分に合わせて選びます。">
            <select value={createExt.gender ?? ""} onChange={(e) => setCreateField("gender", e.target.value)} required aria-required>
              <option value="">選んでください</option>
              {GENDER_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </FieldWithHint>
          <FieldWithHint label={<><ReqMark />生まれた日</>} hint="西暦で保存されます（YYYY-MM-DD）。">
            <input
              type="date"
              value={createExt.dateOfBirthYmd ?? ""}
              onChange={(e) => setCreateField("dateOfBirthYmd", e.target.value)}
              required
              aria-required
            />
          </FieldWithHint>
        </>
      ),
    },
    {
      id: "address",
      title: "住所（郵便番号と住所）",
      description: "名簿の住所欄です。郵便番号と住所の両方が必要です。",
      canProceed: stepAddressOk,
      children: (
        <>
          <FieldWithHint label={<><ReqMark />郵便番号</>} hint="7桁の数字です。ハイフンはあってもなくても構いません。">
            <input
              value={createExt.postalCode ?? ""}
              onChange={(e) => setCreateField("postalCode", e.target.value)}
              placeholder="例: 1234567"
              required
              aria-required
            />
          </FieldWithHint>
          <FieldWithHint label={<><ReqMark />住所</>} hint="番地・建物名まで書けるとあとから迷いません。">
            <textarea
              rows={3}
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              style={{ width: "100%", maxWidth: 480 }}
              required
              aria-required
            />
          </FieldWithHint>
        </>
      ),
    },
    {
      id: "contact",
      title: "連絡先",
      description: "自宅か携帯のどちらか一方は必須です。緊急の連絡先の氏名と電話も必要です。",
      canProceed: stepContactOk,
      children: (
        <>
          <FieldWithHint label="電話（自宅）" optional hint="日中つながる番号があれば入力してください。どちらか一方は必須のため、携帯だけでも構いません。">
            <input value={createExt.phoneHome ?? ""} onChange={(e) => setCreateField("phoneHome", e.target.value)} />
          </FieldWithHint>
          <FieldWithHint label="電話（携帯）" optional hint="よく使う携帯番号を入れてください。自宅と合わせてどちらかは必須です。">
            <input value={createExt.phoneMobile ?? ""} onChange={(e) => setCreateField("phoneMobile", e.target.value)} />
          </FieldWithHint>
          <p style={{ fontSize: "0.8rem", margin: "0.35rem 0 0.5rem", color: "var(--color-danger, #c62828)", fontWeight: 600 }}>
            <ReqMark />
            自宅または携帯の、どちらか一方以上が必須です。
          </p>
          <FieldWithHint label={<><ReqMark />緊急連絡先の氏名</>} hint="本人以外で、まず連絡したい方のお名前です。">
            <input
              value={createExt.emergencyContactName ?? ""}
              onChange={(e) => setCreateField("emergencyContactName", e.target.value)}
              required
              aria-required
            />
          </FieldWithHint>
          <FieldWithHint label={<><ReqMark />緊急連絡先の電話</>} hint="夜間でもつながりやすい番号を推奨します。">
            <input value={createExt.emergencyPhone ?? ""} onChange={(e) => setCreateField("emergencyPhone", e.target.value)} required aria-required />
          </FieldWithHint>
        </>
      ),
    },
    {
      id: "employment",
      title: "採用の記録",
      description: "いつから働き始めたか、正社員かパートか、面接した人の名前を名簿に残します。",
      canProceed: stepEmploymentOk,
      children: (
        <>
          <FieldWithHint label={<><ReqMark />採用した日</>} hint="雇用を開始した日付です。">
            <input
              type="date"
              value={createExt.hiredOnYmd ?? ""}
              onChange={(e) => setCreateField("hiredOnYmd", e.target.value)}
              required
              aria-required
            />
          </FieldWithHint>
          <FieldWithHint label={<><ReqMark />雇用の形</>} hint="名簿の区分に合わせて選びます。">
            <select value={createExt.employmentType ?? ""} onChange={(e) => setCreateField("employmentType", e.target.value)} required aria-required>
              <option value="">選んでください</option>
              {EMPLOYMENT_TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </FieldWithHint>
          <FieldWithHint label={<><ReqMark />面接をした人の名前</>} hint="名簿の「面接担当者」欄に相当します。">
            <input value={createExt.interviewerName ?? ""} onChange={(e) => setCreateField("interviewerName", e.target.value)} required aria-required />
          </FieldWithHint>
        </>
      ),
    },
    {
      id: "license",
      title: "運転免許",
      description: "種類・番号・有効期限は必須です。条件や補足は任意です（証の写しは紙で保管してください）。",
      canProceed: stepLicenseOk,
      children: (
        <>
          <FieldWithHint label={<><ReqMark />免許の種類</>} hint="例: 普通一種。表面に書かれている表記で構いません。">
            <input
              value={createExt.licenseTypes ?? ""}
              onChange={(e) => setCreateField("licenseTypes", e.target.value)}
              placeholder="例: 普通一種"
              required
              aria-required
            />
          </FieldWithHint>
          <FieldWithHint label={<><ReqMark />免許証の番号</>} hint="証に印刷されている番号をそのまま入力します。">
            <input value={createExt.licenseNumber ?? ""} onChange={(e) => setCreateField("licenseNumber", e.target.value)} required aria-required />
          </FieldWithHint>
          <FieldWithHint label={<><ReqMark />有効期限</>} hint="更新後はあらためてここを直してください。">
            <input
              type="date"
              value={createExt.licenseExpiresOnYmd ?? ""}
              onChange={(e) => setCreateField("licenseExpiresOnYmd", e.target.value)}
              required
              aria-required
            />
          </FieldWithHint>
          <FieldWithHint label="免許の条件など" optional hint="眼鏡着用など、証に条件が書いてある場合のメモです。">
            <textarea
              rows={2}
              value={createExt.licenseConditionsNote ?? ""}
              onChange={(e) => setCreateField("licenseConditionsNote", e.target.value)}
              style={{ width: "100%", maxWidth: 480 }}
            />
          </FieldWithHint>
          <FieldWithHint label="その他（免許の欄・メモ）" optional hint="名簿に載せたい補足があれば書きます。">
            <textarea
              rows={2}
              value={createExt.licenseOtherNotes ?? ""}
              onChange={(e) => setCreateField("licenseOtherNotes", e.target.value)}
              style={{ width: "100%", maxWidth: 480 }}
            />
          </FieldWithHint>
        </>
      ),
    },
    {
      id: "confirm",
      title: "入力内容の確認",
      description: "問題なければ「登録する」で保存します。写真や免許の写しは、名簿の紙に添付して保管してください。",
      canProceed: allCreateOk,
      children: (
        <dl className="step-wizard-summary">
          <dt>氏名</dt>
          <dd>
            {familyName.trim()} {givenName.trim()}
          </dd>
          <dt>フリガナ</dt>
          <dd>{newFurigana.trim()}</dd>
          <dt>性別 / 生まれた日</dt>
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
          <dt>採用した日 / 雇用の形 / 面接をした人</dt>
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

  async function removeEmployee(id: string, displayName: string): Promise<void> {
    if (!window.confirm(`「${displayName}」を削除します。取り消せません。よろしいですか？`)) return;
    setErr(null);
    const r = await apiFetch<unknown>(`/employees/${id}`, { method: "DELETE" });
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    if (editId === id) setEditId(null);
    await load();
  }

  return (
    <Card title="スタッフ（従事者名簿）">
      <Err msg={err} />
      <StepWizard
        open={addWizardOpen}
        onClose={closeAddWizard}
        title="スタッフを登録する（名簿の項目を順に入力）"
        steps={addSteps}
        finishLabel="登録する"
        onFinish={submitNewEmployee}
        isSubmitting={addSubmitting}
      />
      <Tabs
        aria-label="スタッフ画面の切り替え"
        activeId={empTab}
        onActiveChange={(id) => setEmpTab(id as "list" | "guide")}
        items={[
          {
            id: "list",
            label: "一覧と編集",
            children: (
              <>
                <p style={{ fontSize: "0.82rem", marginTop: 0 }}>
                  代行の運転手などを登録します。新しい人は「スタッフを追加」から、名簿に必要な項目をガイドに沿って入れます。一覧の免許・電話は参照用です。退職日や続柄などは「名簿の続きを編集」から足せます。お客様の送迎の記録で「主に運転した人」に選ばれている人は削除できません。
                </p>
                <p style={{ marginTop: "0.5rem" }}>
                  <button type="button" onClick={() => setAddWizardOpen(true)}>
                    スタッフを追加
                  </button>
                </p>
                <div className="table-wrap">
                  <table style={{ fontSize: "0.78rem", borderCollapse: "collapse", minWidth: 720 }}>
                    <thead>
                      <tr>
                        <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>氏名</th>
                        <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>ふりがな</th>
                        <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>電話（携帯）</th>
                        <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>免許の種類</th>
                        <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>免許の番号</th>
                        <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>免許の期限</th>
                        <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>在籍</th>
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
                          <td style={{ border: "1px solid #ccc", padding: "4px 6px" }}>{x.status === "ACTIVE" ? "在籍中" : x.status}</td>
                          <td style={{ border: "1px solid #ccc", padding: "4px 6px", whiteSpace: "nowrap" }}>
                            <button type="button" onClick={() => openEdit(x)}>
                              名簿の続きを編集
                            </button>{" "}
                            {x.status === "ACTIVE" ? (
                              <button type="button" onClick={() => void retire(x.id)}>
                                退職にする
                              </button>
                            ) : null}{" "}
                            <button
                              type="button"
                              onClick={() => void removeEmployee(x.id, `${x.familyName} ${x.givenName}`)}
                              style={{ color: "#b00020" }}
                            >
                              削除
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {editId ? (
                  <details open style={{ marginTop: "1rem" }}>
                    <summary style={{ cursor: "pointer", fontWeight: 600 }}>名簿の続きを編集（開いています）</summary>
                    <div style={{ marginTop: "0.5rem", padding: "0.75rem", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)" }}>
                      <form className="stack-form" onSubmit={(e) => void saveEdit(e)}>
                        <FieldWithHint label={<><ReqMark />姓</>} hint="一覧にすぐ出る表記です。">
                          <input value={editFamily} onChange={(e) => setEditFamily(e.target.value)} required />
                        </FieldWithHint>
                        <FieldWithHint label={<><ReqMark />名</>} hint="戸籍・身分証とそろえてください。">
                          <input value={editGiven} onChange={(e) => setEditGiven(e.target.value)} required />
                        </FieldWithHint>
                        <FieldWithHint label="ふりがな" optional hint="空欄のままでも保存できますが、名簿にはあると便利です。">
                          <input value={editFurigana} onChange={(e) => setEditFurigana(e.target.value)} />
                        </FieldWithHint>
                        <FieldWithHint label="住所" optional hint="転居したらあとから直せます。">
                          <textarea rows={2} value={editAddress} onChange={(e) => setEditAddress(e.target.value)} style={{ width: "100%" }} />
                        </FieldWithHint>
                        {REGISTER_EXTENSION_UI_FIELDS.map((f) => (
                          <FieldWithHint
                            key={f.key}
                            label={f.label}
                            optional
                            hint={EXT_FIELD_HINTS[f.key] ?? "名簿や社内記録用の欄です。"}
                          >
                            {f.key === "educationNotes" || f.key === "rosterNotes" || f.key === "licenseConditionsNote" || f.key === "licenseOtherNotes" ? (
                              <textarea
                                rows={2}
                                value={editExt[f.key] ?? ""}
                                onChange={(e) => setExtField(f.key, e.target.value)}
                                style={{ width: "100%", maxWidth: 420 }}
                              />
                            ) : (
                              <input value={editExt[f.key] ?? ""} onChange={(e) => setExtField(f.key, e.target.value)} style={{ width: "100%", maxWidth: 420 }} />
                            )}
                          </FieldWithHint>
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
              </>
            ),
          },
          {
            id: "guide",
            label: "この画面の説明",
            children: (
              <div style={{ fontSize: "0.9rem", lineHeight: 1.55, marginTop: "0.35rem" }}>
                <p>
                  <strong>一覧と編集</strong>タブでは、登録済みのスタッフを表で見たり、「名簿の続きを編集」で追加の欄（続柄・退職日・教育メモなど）を埋めたりできます。
                </p>
                <p>
                  <strong>スタッフを追加</strong>はウィザード形式です。お名前 → ふりがな・性別・生まれた日 → 住所 → 連絡先 → 採用の記録 → 免許の順です。各画面に、入力の意味が一言で書いてあります。
                </p>
                <p>
                  法令で決まっている「従事者名簿」と同じ観点で項目をそろえています。画面上の言葉だけやわらかくしており、保存されるデータの意味は変わりません。
                </p>
              </div>
            ),
          },
        ]}
      />
    </Card>
  );
}

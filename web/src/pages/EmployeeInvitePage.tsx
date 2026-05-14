import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { publicFetch } from "../lib/public-api";

type InviteInfo = {
  hiredOn: string;
  licenseClasses: string[];
  licenseConditionOptions: string[];
  licenseConditionOptionsByKind: Record<string, string[]>;
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export default function EmployeeInvitePage(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // form fields
  const [loginEmail, setLoginEmail] = useState("");
  const [password, setPassword] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [givenName, setGivenName] = useState("");
  const [furigana, setFurigana] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [mobile, setMobile] = useState("");
  const [usualWorkDays, setUsualWorkDays] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyTel, setEmergencyTel] = useState("");
  const [licenseKind, setLicenseKind] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseExpiresOn, setLicenseExpiresOn] = useState("");
  const [licenseConditions, setLicenseConditions] = useState<string[]>([]);
  const [licenseFrontDataUrl, setLicenseFrontDataUrl] = useState("");
  const [licenseBackDataUrl, setLicenseBackDataUrl] = useState("");

  useEffect(() => {
    if (!token) return;
    void (async () => {
      const r = await publicFetch<InviteInfo>(`/public/employee-invite/${encodeURIComponent(token)}`);
      if (!r.ok) {
        setLoadErr(r.error);
        return;
      }
      setInfo(r.data);
    })();
  }, [token]);

  const licenseConditionChoices = useCallback((): string[] => {
    if (!info) return [];
    if (licenseKind.trim() && info.licenseConditionOptionsByKind[licenseKind]) {
      return info.licenseConditionOptionsByKind[licenseKind];
    }
    return info.licenseConditionOptions;
  }, [info, licenseKind]);

  function toggleCondition(opt: string): void {
    setLicenseConditions((prev) =>
      prev.includes(opt) ? prev.filter((x) => x !== opt) : [...prev, opt],
    );
  }

  async function onPhotoFile(side: "front" | "back", file: File | null): Promise<void> {
    if (!file) return;
    const url = await fileToDataUrl(file);
    if (side === "front") setLicenseFrontDataUrl(url);
    else setLicenseBackDataUrl(url);
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!token) return;
    setErr(null);
    setBusy(true);
    const r = await publicFetch<{ ok: boolean }>(`/public/employee-invite/${encodeURIComponent(token)}`, {
      method: "POST",
      json: {
        loginEmail: loginEmail.trim() || undefined,
        password: password || undefined,
        familyName,
        givenName,
        furigana,
        birthDate,
        address,
        phone,
        mobile,
        usualWorkDays,
        emergencyName,
        emergencyTel,
        licenseKind,
        licenseNumber,
        licenseExpiresOn,
        licenseConditions,
        licensePhotoFrontDataUrl: licenseFrontDataUrl || undefined,
        licensePhotoBackDataUrl: licenseBackDataUrl || undefined,
      },
    });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setDone(true);
  }

  if (!token) {
    return <div className="invite-page"><p className="settings-hint">URLが無効です。</p></div>;
  }

  if (!info && !loadErr) {
    return <div className="invite-page"><p className="settings-hint">読み込み中…</p></div>;
  }

  if (loadErr) {
    return (
      <div className="invite-page">
        <div className="invite-card">
          <h1 className="invite-title">従業員情報の入力</h1>
          <p className="invite-error">{loadErr}</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="invite-page">
        <div className="invite-card">
          <h1 className="invite-title">登録完了</h1>
          <p style={{ marginTop: "1rem", lineHeight: 1.7 }}>
            情報の登録が完了しました。管理者に連絡してログイン情報を確認してください。
          </p>
        </div>
      </div>
    );
  }

  const choices = licenseConditionChoices();

  return (
    <div className="invite-page">
      <div className="invite-card">
        <h1 className="invite-title">従業員情報の入力</h1>
        <p className="settings-hint" style={{ marginBottom: "1.5rem" }}>
          採用年月日: <strong>{info!.hiredOn}</strong>（変更不可）
        </p>
        {err ? <p className="invite-error">{err}</p> : null}
        <form onSubmit={(e) => void handleSubmit(e)} className="settings-form">
          <h3 className="settings-subtitle">アカウント情報</h3>
          <label>ログインID（メール）</label>
          <input type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} autoComplete="email" />
          <label>パスワード（8文字以上）</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />

          <h3 className="settings-subtitle" style={{ marginTop: "1.25rem" }}>基本情報</h3>
          <label>氏名（姓）<span className="invite-required">*</span></label>
          <input required value={familyName} onChange={(e) => setFamilyName(e.target.value)} />
          <label>氏名（名）<span className="invite-required">*</span></label>
          <input required value={givenName} onChange={(e) => setGivenName(e.target.value)} />
          <label>ふりがな（カタカナ推奨）</label>
          <input value={furigana} onChange={(e) => setFurigana(e.target.value)} placeholder="例: ヤギ ユウセイ" autoComplete="off" />
          <label>生年月日</label>
          <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          <label>住所</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="street-address" />
          <label>電話番号</label>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
          <label>携帯電話</label>
          <input type="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} autoComplete="tel" />
          <label>採用年月日</label>
          <input value={info!.hiredOn} disabled style={{ background: "var(--color-border)", color: "var(--color-muted)" }} />
          <label>主な出勤日</label>
          <input value={usualWorkDays} onChange={(e) => setUsualWorkDays(e.target.value)} placeholder="例: 月〜金" />

          <h3 className="settings-subtitle" style={{ marginTop: "1.25rem" }}>緊急連絡先</h3>
          <label>氏名</label>
          <input value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)} />
          <label>電話番号</label>
          <input type="tel" value={emergencyTel} onChange={(e) => setEmergencyTel(e.target.value)} />

          <h3 className="settings-subtitle" style={{ marginTop: "1.25rem" }}>免許情報</h3>
          <label>免許種別（一番上位の種別を選択）</label>
          <select
            value={licenseKind}
            onChange={(e) => {
              setLicenseKind(e.target.value);
              setLicenseConditions([]);
            }}
          >
            <option value="">選択</option>
            {info!.licenseClasses.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <label>免許番号</label>
          <div className="settings-inline-cert">
            <span aria-hidden>第</span>
            <input
              className="settings-cert-core"
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.target.value)}
              placeholder="番号"
            />
            <span aria-hidden>号</span>
          </div>
          <label>有効期限</label>
          <input type="date" value={licenseExpiresOn} onChange={(e) => setLicenseExpiresOn(e.target.value)} />
          <label>免許の条件・限定等（複数選択）</label>
          {!licenseKind.trim() ? (
            <p className="settings-hint">先に免許種別を選ぶと、この免許であり得る条件・限定の候補だけが表示されます。</p>
          ) : null}
          <div className="settings-license-conditions">
            {choices.map((opt) => (
              <label key={opt} className="settings-check settings-check--block">
                <input
                  type="checkbox"
                  checked={licenseConditions.includes(opt)}
                  onChange={() => toggleCondition(opt)}
                />{" "}
                {opt}
              </label>
            ))}
          </div>
          <label>免許証の写真（表面）</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => void onPhotoFile("front", e.target.files?.[0] ?? null)}
          />
          {licenseFrontDataUrl ? (
            <img className="settings-photo-preview" src={licenseFrontDataUrl} alt="免許証表面" />
          ) : null}
          <label>免許証の写真（裏面）</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => void onPhotoFile("back", e.target.files?.[0] ?? null)}
          />
          {licenseBackDataUrl ? (
            <img className="settings-photo-preview" src={licenseBackDataUrl} alt="免許証裏面" />
          ) : null}

          <div className="settings-actions" style={{ marginTop: "1.5rem" }}>
            <button type="submit" className="settings-primary invite-submit-btn" disabled={busy}>
              {busy ? "送信中…" : "送信する"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

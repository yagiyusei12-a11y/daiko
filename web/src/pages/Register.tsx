import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Card, Err } from "../ui";

const SLUG_OK = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export default function Register(): JSX.Element {
  const { register } = useAuth();
  const nav = useNavigate();
  const [tenantName, setTenantName] = useState("");
  const [slug, setSlug] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [givenName, setGivenName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [representativeAdmin, setRepresentativeAdmin] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    const s = slug.trim().toLowerCase();
    if (!SLUG_OK.test(s)) {
      setErr("店舗IDは英小文字・数字・ハイフンのみ。先頭・末尾にハイフンは付けないでください。");
      return;
    }
    const er = await register({
      tenantName: tenantName.trim(),
      slug: s,
      email: email.trim(),
      password,
      familyName: familyName.trim(),
      givenName: givenName.trim(),
      representativeAdmin,
    });
    if (er) setErr(er);
    else nav("/", { replace: true });
  }

  return (
    <div className="auth-screen auth-screen--wide">
      <Card title="新規テナント登録">
        <p className="auth-lede">事業者・店舗ID・代表者（従業員マスタ登録）を一度に作成し、オーナーとしてログインします。</p>
        <form onSubmit={(e) => void onSubmit(e)}>
          <label>事業者名</label>
          <input value={tenantName} onChange={(e) => setTenantName(e.target.value)} required />
          <label>店舗ID（英小文字・数字・ハイフン）</label>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            autoComplete="off"
            spellCheck={false}
            required
          />
          <p className="settings-hint" style={{ marginTop: "-0.25rem" }}>
            ログイン時に「店舗ID」として使います。確定後に変更する場合は運用でお問い合わせください。
          </p>
          <label>代表者 姓</label>
          <input value={familyName} onChange={(e) => setFamilyName(e.target.value)} autoComplete="family-name" required />
          <label>代表者 名</label>
          <input value={givenName} onChange={(e) => setGivenName(e.target.value)} autoComplete="given-name" required />
          <label>
            <input
              type="checkbox"
              checked={representativeAdmin}
              onChange={(e) => setRepresentativeAdmin(e.target.checked)}
            />{" "}
            従業員マスタの管理者
          </label>
          <p className="settings-hint" style={{ marginTop: "-0.35rem" }}>
            チェックすると名簿の「管理者」に相当する権限が付きます（システムのオーナー権限とは別です）。
          </p>
          <label>ログイン用メールアドレス</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          <label>パスワード（8文字以上）</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <Err msg={err} />
          <button type="submit">登録してログイン</button>
        </form>
        <p className="auth-footer">
          <Link to="/login">ログインへ</Link>
        </p>
      </Card>
    </div>
  );
}

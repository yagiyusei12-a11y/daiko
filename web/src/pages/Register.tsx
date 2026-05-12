import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Card, Err, FieldWithHint } from "../ui";

export default function Register(): JSX.Element {
  const { register } = useAuth();
  const nav = useNavigate();
  const [tenantName, setTenantName] = useState("");
  const [slug, setSlug] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    const er = await register({
      tenantName: tenantName.trim(),
      slug: slug.trim(),
      email: email.trim(),
      password,
      displayName: displayName.trim() || undefined,
    });
    if (er) setErr(er);
    else nav("/", { replace: true });
  }

  return (
    <div className="auth-screen auth-screen--wide">
      <Card title="はじめての登録（お店を作る）">
        <p className="auth-lede">はじめて使うときに、お店の名前とログイン用アカウントをまとめて作ります。</p>
        <form onSubmit={(e) => void onSubmit(e)} className="stack-form">
          <FieldWithHint label="事業者名・屋号" hint="請求書や画面に出す正式な呼び方です。">
            <input value={tenantName} onChange={(e) => setTenantName(e.target.value)} required />
          </FieldWithHint>
          <FieldWithHint label="テナント ID（英小文字・数字・ハイフン）" hint="URL やログインで使う短い名前です。あとから変えにくいので慎重に。">
            <input value={slug} onChange={(e) => setSlug(e.target.value)} required />
          </FieldWithHint>
          <FieldWithHint label="オーナーのメール" hint="ログインと通知に使います。">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </FieldWithHint>
          <FieldWithHint label="画面上の表示名" optional hint="空欄ならメールの前の部分が使われます。">
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </FieldWithHint>
          <FieldWithHint label="パスワード（8文字以上）" hint="英字と数字を混ぜると安全です。">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </FieldWithHint>
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

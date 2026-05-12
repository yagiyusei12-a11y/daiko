import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Card, Err, FieldWithHint } from "../ui";

export default function Login(): JSX.Element {
  const { login } = useAuth();
  const nav = useNavigate();
  const [slug, setSlug] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    const er = await login(slug.trim(), email.trim(), password);
    if (er) setErr(er);
    else nav("/", { replace: true });
  }

  return (
    <div className="auth-screen">
      <Card title="ログイン">
        <p className="auth-lede">お店（テナント）の ID と、あなたのメール・パスワードで入ります。</p>
        <form onSubmit={(e) => void onSubmit(e)} className="stack-form">
          <FieldWithHint label="テナント ID（英字の短い名前）" hint="登録したときに決めた「URL 用の名前」です。分からない場合は管理者に確認してください。">
            <input value={slug} onChange={(e) => setSlug(e.target.value)} autoComplete="organization" required />
          </FieldWithHint>
          <FieldWithHint label="メールアドレス" hint="ログインに使うメールと同じです。">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </FieldWithHint>
          <FieldWithHint label="パスワード" hint="表示されません。他人に見えない場所で入力してください。">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </FieldWithHint>
          <Err msg={err} />
          <button type="submit">ログイン</button>
        </form>
        <p className="auth-footer">
          <Link to="/register">新規テナント登録</Link>
        </p>
      </Card>
    </div>
  );
}

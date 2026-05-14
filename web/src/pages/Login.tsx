import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Card, Err } from "../ui";

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
        <p className="auth-lede">店舗IDとログインID（メールアドレス）・パスワードでサインインします。</p>
        <form onSubmit={(e) => void onSubmit(e)}>
          <label>店舗ID</label>
          <input value={slug} onChange={(e) => setSlug(e.target.value)} autoComplete="organization" required />
          <label>ログインID（メールアドレス）</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          <label>パスワード</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          <Err msg={err} />
          <button type="submit">ログイン</button>
        </form>
        <div className="auth-footer-row">
          <Link to="/register">新規テナント登録</Link>
          <Link to="/demo">デモ画面</Link>
        </div>
      </Card>
    </div>
  );
}

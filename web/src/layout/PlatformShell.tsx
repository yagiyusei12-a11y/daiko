import { NavLink, Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../auth";
import "../platform.css";

export default function PlatformShell(): JSX.Element {
  const { me, loading, logout } = useAuth();

  if (loading) {
    return (
      <div className="platform-loading">
        <span>読み込み中…</span>
      </div>
    );
  }
  if (!me) return <Navigate to="/login" replace />;
  if (!me.platformAdmin) {
    return (
      <div className="platform-denied">
        <h1>アクセスできません</h1>
        <p>プラットフォーム管理者として登録されたアカウントでログインしてください。</p>
        <p>
          <a href="/">アプリに戻る</a>
        </p>
      </div>
    );
  }

  return (
    <div className="platform-shell">
      <header className="platform-header">
        <div className="platform-header-inner">
          <span className="platform-brand">Daiko プラットフォーム管理</span>
          <nav className="platform-nav" aria-label="プラットフォーム">
            <NavLink to="/platform/inquiries" end>
              お問い合わせ
            </NavLink>
            <NavLink to="/platform/settings">システム設定</NavLink>
            <NavLink to="/platform/tenants">テナント</NavLink>
          </nav>
          <div className="platform-header-actions">
            <span className="platform-user">{me.email}</span>
            <a href="/">店舗アプリ</a>
            <button type="button" onClick={logout}>
              ログアウト
            </button>
          </div>
        </div>
      </header>
      <main className="platform-main">
        <Outlet />
      </main>
    </div>
  );
}

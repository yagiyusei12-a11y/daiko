import { NavLink, Outlet, Navigate } from "react-router-dom";
import { useAuth } from "../auth";

const navLinks: { to: string; label: string }[] = [{ to: "/", label: "ホーム" }];

export default function Shell(): JSX.Element {
  const { me, loading, logout } = useAuth();
  if (loading) {
    return (
      <div className="app-loading">
        <div className="app-loading-spinner" aria-hidden />
        <span>読み込み中…</span>
      </div>
    );
  }
  if (!me) return <Navigate to="/login" replace />;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-bar">
          <span className="app-header-brand">Daiko</span>
          <span className="app-header-meta">
            {me.tenant.slug} / {me.email}
          </span>
          <button type="button" className="app-header-logout" onClick={logout}>
            ログアウト
          </button>
        </div>
        <nav className="app-nav-tabs" aria-label="メインメニュー">
          {navLinks.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.to === "/"} className={({ isActive }) => (isActive ? "active" : "")}>
              {l.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}

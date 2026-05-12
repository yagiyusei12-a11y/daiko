import { NavLink, Outlet, Navigate } from "react-router-dom";
import { useAuth } from "../auth";

type NavLinkItem = { to: string; label: string; perm?: string };

const navGroups: { label: string; links: NavLinkItem[] }[] = [
  {
    label: "いつもの業務",
    links: [
      { to: "/", label: "ホーム" },
      { to: "/daily-reports", label: "業務の記録" },
      { to: "/time-punches", label: "出退勤" },
      { to: "/alcohol", label: "アルコール検査" },
    ],
  },
  {
    label: "お客様・お店",
    links: [
      { to: "/customers", label: "お客様リスト" },
      { to: "/referral-sources", label: "紹介してくれたお店" },
      { to: "/receivables", label: "まだ入金前のお金" },
    ],
  },
  {
    label: "車と料金",
    links: [
      { to: "/vehicles", label: "車両" },
      { to: "/tariffs", label: "料金ルール" },
      { to: "/dispatch", label: "予約の予定" },
    ],
  },
  {
    label: "スタッフ・給与・書類",
    links: [
      { to: "/employees", label: "スタッフ" },
      { to: "/payroll", label: "給与" },
      { to: "/documents", label: "書類テンプレート" },
      { to: "/legal", label: "法令で決まっている記録" },
    ],
  },
  {
    label: "設定",
    links: [
      { to: "/settings", label: "事業所の設定", perm: "tenant.settings" },
      { to: "/rbac", label: "ログイン権限", perm: "rbac.manage" },
    ],
  },
];

export default function Shell(): JSX.Element {
  const { me, loading, logout, can } = useAuth();
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
          {navGroups.map((g) => (
            <div key={g.label} className="app-nav-group">
              <span className="app-nav-group-label">{g.label}</span>
              <div className="app-nav-group-links">
                {g.links
                  .filter((l) => !l.perm || can(l.perm))
                  .map((l) => (
                    <NavLink key={l.to} to={l.to} end={l.to === "/"} className={({ isActive }) => (isActive ? "active" : "")}>
                      {l.label}
                    </NavLink>
                  ))}
              </div>
            </div>
          ))}
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}

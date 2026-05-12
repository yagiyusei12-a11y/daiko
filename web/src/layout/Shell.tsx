import { NavLink, Outlet, Navigate } from "react-router-dom";
import { useAuth, isStaffShiftOnlyMe } from "../auth";

const fullNavLinks: { to: string; label: string; perm?: string }[] = [
  { to: "/", label: "ホーム" },
  { to: "/employees", label: "従業員" },
  { to: "/vehicles", label: "車両" },
  { to: "/tariffs", label: "料金" },
  { to: "/daily-reports", label: "日報" },
  { to: "/customers", label: "顧客名簿" },
  { to: "/referral-sources", label: "紹介元" },
  { to: "/receivables", label: "売掛" },
  { to: "/dispatch", label: "配車" },
  { to: "/time-punches", label: "勤怠" },
  { to: "/alcohol", label: "酒気" },
  { to: "/payroll", label: "給与" },
  { to: "/documents", label: "帳票" },
  { to: "/settings", label: "設定", perm: "tenant.settings" },
  { to: "/rbac", label: "権限", perm: "rbac.manage" },
  { to: "/legal", label: "法定" },
];

const staffNavLinks: { to: string; label: string }[] = [
  { to: "/", label: "ホーム" },
  { to: "/workflow", label: "勤務" },
  { to: "/time-punches", label: "勤怠" },
  { to: "/alcohol", label: "酒気" },
  { to: "/daily-reports", label: "日報" },
];

export default function Shell(): JSX.Element {
  const { me, loading, logout, can } = useAuth();
  const staffOnly = Boolean(me && isStaffShiftOnlyMe(me.permissions));
  const navLinks = staffOnly
    ? staffNavLinks
    : fullNavLinks.filter((l) => !l.perm || can(l.perm));
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

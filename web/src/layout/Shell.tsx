import { NavLink, Outlet, Navigate, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useAuth } from "../auth";
import { useDeviceKind } from "../hooks/useDeviceKind";
import { SavedToastProvider } from "../saved-toast";

const navItems: { to: string; label: string; match: "schedule" | "prefix" }[] = [
  { to: "/dashboard", label: "ダッシュボード", match: "prefix" },
  { to: "/daily-reports", label: "日報", match: "prefix" },
  { to: "/schedule", label: "スケジュール", match: "schedule" },
  { to: "/attendance", label: "勤怠", match: "prefix" },
  { to: "/documents", label: "書類", match: "prefix" },
  { to: "/instruction-records", label: "指導", match: "prefix" },
  { to: "/settings", label: "設定", match: "prefix" },
];

function navClass(pathname: string, item: (typeof navItems)[0]): string {
  if (item.match === "schedule") {
    return pathname === "/" || pathname.startsWith("/schedule") ? "active" : "";
  }
  return pathname === item.to || pathname.startsWith(`${item.to}/`) ? "active" : "";
}

export default function Shell(): JSX.Element {
  const { me, loading, logout } = useAuth();
  const device = useDeviceKind();
  const location = useLocation();
  const pathname = location.pathname;
  const touchNav = device === "phone" || device === "tablet";

  useEffect(() => {
    if (!me) {
      document.title = "Daiko";
      return;
    }
    const t = me.tradeName?.trim() || me.tenant.name;
    document.title = t ? `${t} · Daiko` : "Daiko";
  }, [me]);

  if (loading) {
    return (
      <div className="app-loading">
        <div className="app-loading-spinner" aria-hidden />
        <span>読み込み中…</span>
      </div>
    );
  }
  if (!me) return <Navigate to="/login" replace />;

  const nav = (
    <>
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={() => navClass(pathname, item)}
        >
          {item.label}
        </NavLink>
      ))}
    </>
  );

  return (
    <div className="app-shell" data-device={device}>
      <header className="app-header">
        <div className="app-header-bar">
          <span className="app-header-brand">{me.tradeName?.trim() || me.tenant.name}</span>
          <span className="app-header-meta">{me.employeeDisplayName}</span>
          <button type="button" className="app-header-logout" onClick={logout}>
            ログアウト
          </button>
        </div>
        {!touchNav ? (
          <nav className="app-nav-tabs app-nav-tabs--header" aria-label="メインメニュー">
            {nav}
          </nav>
        ) : null}
      </header>
      <main className={`app-main${touchNav ? " app-main--bottom-nav" : ""}`}>
        <SavedToastProvider>
          <Outlet />
        </SavedToastProvider>
      </main>
      {touchNav ? (
        <nav className="app-bottom-nav" aria-label="メインメニュー">
          {nav}
        </nav>
      ) : null}
    </div>
  );
}

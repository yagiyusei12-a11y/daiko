import { NavLink, Outlet, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo } from "react";
import { useAuth } from "../auth";
import { useDeviceKind } from "../hooks/useDeviceKind";
import { SavedToastProvider } from "../saved-toast";
import {
  filterHeaderNavMetaForMe,
  firstAllowedNavTo,
  isHeaderNavIdAllowed,
  navClassForMeta,
  pathnameToHeaderNavId,
  STAFF_HEADER_NAV_META,
} from "../lib/staff-menu-client";

export default function Shell(): JSX.Element {
  const { me, loading, logout } = useAuth();
  const device = useDeviceKind();
  const location = useLocation();
  const pathname = location.pathname;
  const navigate = useNavigate();
  const touchNav = device === "phone" || device === "tablet";

  const navMeta = useMemo(() => (me ? filterHeaderNavMetaForMe(me) : [...STAFF_HEADER_NAV_META]), [me]);

  useEffect(() => {
    if (!me) return;
    const cur = pathnameToHeaderNavId(pathname);
    if (!isHeaderNavIdAllowed(me, cur)) {
      navigate(firstAllowedNavTo(me), { replace: true });
    }
  }, [me, pathname, navigate]);

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
      {navMeta.map((item) => (
        <NavLink key={item.id} to={item.to} className={() => navClassForMeta(pathname, item)}>
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

import { NavLink, Outlet, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { getAccessToken } from "../api";
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
import LicenseExpiryNotice from "../components/LicenseExpiryNotice";

export default function Shell(): JSX.Element {
  const { me, loading, logout, enterDemo } = useAuth();
  const device = useDeviceKind();
  const location = useLocation();
  const pathname = location.pathname;
  const navigate = useNavigate();
  const touchNav = device === "phone" || device === "tablet";
  const demoBootStarted = useRef(false);
  const [demoBooting, setDemoBooting] = useState(false);

  useEffect(() => {
    if (loading || me || demoBootStarted.current || getAccessToken()) return;
    demoBootStarted.current = true;
    setDemoBooting(true);
    void (async () => {
      await enterDemo();
      setDemoBooting(false);
    })();
  }, [loading, me, enterDemo]);

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
    const suffix = me.demoSession ? "（デモ）" : "";
    document.title = t ? `${t}${suffix} · Daiko` : "Daiko";
  }, [me]);

  if (loading || demoBooting) {
    return (
      <div className="app-loading">
        <div className="app-loading-spinner" aria-hidden />
        <span>読み込み中…</span>
      </div>
    );
  }
  if (!me) return <Navigate to="/login" replace />;
  if (me.canAccessApp === false) return <Navigate to="/billing" replace />;

  const navLinks = (
    <>
      {navMeta.map((item) => (
        <NavLink key={item.id} to={item.to} className={() => navClassForMeta(pathname, item)}>
          {item.label}
        </NavLink>
      ))}
    </>
  );

  const topBanners = (
    <>
      <LicenseExpiryNotice />
      {me.demoSession ? (
        <div
          className="app-demo-banner"
          style={{
            padding: "0.35rem 0.75rem",
            fontSize: "0.85rem",
            background: "var(--color-warn-bg, #fff8e6)",
            borderBottom: "1px solid var(--color-border, #e0ddd8)",
            textAlign: "center",
          }}
        >
          デモ閲覧中（保存データはデモ用テナントに記録されます）
        </div>
      ) : null}
    </>
  );

  if (touchNav) {
    return (
      <div className="app-shell" data-device={device}>
        {topBanners}
        <header className="app-header">
          <div className="app-header-bar">
            <span className="app-header-brand">{me.tradeName?.trim() || me.tenant.name}</span>
            <span className="app-header-meta">{me.employeeDisplayName}</span>
            <button type="button" className="app-header-logout" onClick={logout}>
              ログアウト
            </button>
          </div>
        </header>
        <main className="app-main app-main--bottom-nav">
          <SavedToastProvider>
            <Outlet />
          </SavedToastProvider>
        </main>
        <nav className="app-bottom-nav" aria-label="メインメニュー">
          {navLinks}
        </nav>
      </div>
    );
  }

  return (
    <div className="app-shell app-shell--sidebar" data-device={device}>
      <nav className="app-sidebar" aria-label="メインメニュー">
        <div className="app-sidebar-brand">{me.tradeName?.trim() || me.tenant.name}</div>
        <div className="app-sidebar-nav">{navLinks}</div>
        <div className="app-sidebar-footer">
          {me.platformAdmin ? (
            <a className="app-sidebar-logout" href="/app/platform/inquiries" style={{ marginBottom: "0.5rem", display: "block" }}>
              プラットフォーム管理
            </a>
          ) : null}
          <button type="button" className="app-sidebar-logout" onClick={logout}>
            ログアウト
          </button>
        </div>
      </nav>
      <div className="app-content-area">
        {topBanners}
        <main className="app-main">
          <SavedToastProvider>
            <Outlet />
          </SavedToastProvider>
        </main>
      </div>
    </div>
  );
}

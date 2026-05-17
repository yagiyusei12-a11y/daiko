import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { apiFetch, getAccessToken } from "../api";
import { useAuth } from "../auth";
import {
  billingStatusDetail,
  billingStatusHeadline,
  STRIPE_PRICE_MONTHLY,
  STRIPE_PRICE_YEARLY,
  type BillingStatusResponse,
  type CheckoutSessionResponse,
  type RedeemLicenseResponse,
  type TenantBillingStatus,
} from "../lib/billing";
import { AuthLegalFooter } from "../components/AuthLegalFooter";
import { Card } from "../ui";

function useBillingToast(): { message: string | null; flash: (text: string) => void } {
  const [message, setMessage] = useState<string | null>(null);
  const tref = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((text: string) => {
    if (tref.current) clearTimeout(tref.current);
    setMessage(text);
    tref.current = setTimeout(() => {
      setMessage(null);
      tref.current = null;
    }, 2800);
  }, []);

  return { message, flash };
}

export default function BillingPage(): JSX.Element {
  const { me, loading, logout, refreshMe } = useAuth();
  const { message: toast, flash } = useBillingToast();
  const [status, setStatus] = useState<BillingStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [licenseKey, setLicenseKey] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [redeemLoading, setRedeemLoading] = useState(false);

  const reloadStatus = useCallback(async () => {
    if (!getAccessToken()) return;
    setStatusLoading(true);
    const r = await apiFetch<BillingStatusResponse>("/billing/status");
    if (r.ok) setStatus(r.data);
    setStatusLoading(false);
  }, []);

  useEffect(() => {
    void reloadStatus();
  }, [reloadStatus]);

  const billingStatus: TenantBillingStatus = useMemo(() => {
    const fromApi = status?.billingStatus;
    const fromMe = me?.billingStatus;
    const raw = fromApi ?? fromMe ?? "EXPIRED";
    return raw as TenantBillingStatus;
  }, [status, me]);

  const trialEndsAt = status?.trialEndsAt ?? me?.trialEndsAt ?? null;
  const paidThroughAt = status?.paidThroughAt ?? me?.paidThroughAt ?? null;
  const canAccessApp = status?.canAccessApp ?? me?.canAccessApp ?? false;

  const headline = billingStatusHeadline(billingStatus);
  const detail = billingStatusDetail(billingStatus, trialEndsAt, paidThroughAt);

  const startCheckout = useCallback(
    async (priceId: string, planLabel: string) => {
      if (!priceId) {
        flash("Stripe の Price ID が未設定です（VITE_STRIPE_PRICE_* を確認してください）");
        return;
      }
      setCheckoutLoading(priceId);
      const r = await apiFetch<CheckoutSessionResponse>("/billing/checkout-session", {
        method: "POST",
        json: { priceId },
      });
      setCheckoutLoading(null);
      if (!r.ok) {
        flash(r.error || `${planLabel}の決済セッション作成に失敗しました`);
        return;
      }
      window.location.assign(r.data.url);
    },
    [flash],
  );

  const redeemLicense = useCallback(async () => {
    const key = licenseKey.trim();
    if (!key) {
      flash("ライセンスキーを入力してください");
      return;
    }
    setRedeemLoading(true);
    const r = await apiFetch<RedeemLicenseResponse>("/billing/license/redeem", {
      method: "POST",
      json: { licenseKey: key },
    });
    setRedeemLoading(false);
    if (!r.ok) {
      flash(r.error || "ライセンスキーの適用に失敗しました");
      return;
    }
    setLicenseKey("");
    flash(`ライセンスキーを適用しました（${r.data.validDays}日間延長）`);
    await refreshMe();
    await reloadStatus();
  }, [licenseKey, flash, refreshMe, reloadStatus]);

  if (!loading && !me && !getAccessToken()) {
    return <Navigate to="/login" replace />;
  }

  if (loading || (getAccessToken() && !me)) {
    return (
      <div className="auth-screen">
        <div className="app-loading">
          <div className="app-loading-spinner" aria-hidden />
          <span>読み込み中…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen auth-screen--wide billing-page">
      <header className="billing-page-header">
        <div>
          <h1 className="billing-page-title">お支払い・ライセンス</h1>
          {me ? (
            <p className="billing-page-tenant">
              {me.tradeName?.trim() || me.tenant.name}
              <span className="billing-page-meta"> · {me.employeeDisplayName}</span>
            </p>
          ) : null}
        </div>
        <div className="billing-page-header-actions">
          {canAccessApp ? (
            <Link to="/" className="billing-page-link">
              アプリに戻る
            </Link>
          ) : null}
          <button type="button" className="billing-page-logout" onClick={logout}>
            ログアウト
          </button>
        </div>
      </header>

      <Card title="現在のステータス">
        {statusLoading ? <p className="billing-muted">ステータスを読み込み中…</p> : null}
        <p className={`billing-status-badge billing-status-badge--${billingStatus.toLowerCase()}`}>
          {billingStatus}
        </p>
        <h2 className="billing-headline">{headline}</h2>
        <p className="billing-detail">{detail}</p>
        {!canAccessApp ? (
          <p className="billing-muted billing-muted--warn">
            ダッシュボードや日報などの機能は、お支払いまたはライセンスキー登録後にご利用いただけます。
          </p>
        ) : null}
      </Card>

      <Card title="Stripe でお支払い">
        <p className="billing-lede">月額・年額プランからお選びください。ボタンを押すと Stripe の安全な決済画面へ移動します。</p>
        <div className="billing-plan-grid">
          <button
            type="button"
            className="billing-plan-card"
            disabled={Boolean(checkoutLoading)}
            onClick={() => void startCheckout(STRIPE_PRICE_MONTHLY, "月額プラン")}
          >
            <span className="billing-plan-name">月額プラン</span>
            <span className="billing-plan-price">
              ¥4,980<span className="billing-plan-unit">/月</span>
            </span>
            <span className="billing-plan-cta">
              {checkoutLoading === STRIPE_PRICE_MONTHLY ? "準備中…" : "このプランで申し込む"}
            </span>
          </button>
          <button
            type="button"
            className="billing-plan-card billing-plan-card--accent"
            disabled={Boolean(checkoutLoading)}
            onClick={() => void startCheckout(STRIPE_PRICE_YEARLY, "年額プラン")}
          >
            <span className="billing-plan-name">年額プラン</span>
            <span className="billing-plan-price">
              ¥49,800<span className="billing-plan-unit">/年</span>
            </span>
            <span className="billing-plan-note">2ヶ月分お得</span>
            <span className="billing-plan-cta">
              {checkoutLoading === STRIPE_PRICE_YEARLY ? "準備中…" : "このプランで申し込む"}
            </span>
          </button>
        </div>
      </Card>

      <Card title="ライセンスキー">
        <p className="billing-lede">お手持ちのライセンスキーを入力して適用してください。</p>
        <label htmlFor="license-key">ライセンスキー</label>
        <input
          id="license-key"
          type="text"
          value={licenseKey}
          onChange={(e) => setLicenseKey(e.target.value)}
          placeholder="DAIKO-XXXX-XXXX-XXXX"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="billing-apply-btn"
          disabled={!licenseKey.trim() || redeemLoading}
          onClick={() => void redeemLicense()}
        >
          {redeemLoading ? "適用中…" : "適用する"}
        </button>
      </Card>

      {toast ? (
        <div className="saved-toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}

      <AuthLegalFooter />
    </div>
  );
}

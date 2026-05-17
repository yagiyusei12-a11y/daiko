/** バックエンド `requireTenantBilling` と同じコード */
export const BILLING_REQUIRED_CODE = "BILLING_REQUIRED";

export type TenantBillingStatus =
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELED"
  | "EXPIRED"
  | "LICENSE_ONLY";

/** 本番（ライブ）Price ID（`web/.env` 未設定時のフォールバック。`sk_live_*` とセットで使用） */
const DEFAULT_STRIPE_PRICE_MONTHLY = "price_1TY5nV1DqBB8GAlPKCTbhQVw";
const DEFAULT_STRIPE_PRICE_YEARLY = "price_1TY5nV1DqBB8GAlPwmVUqVTU";

function stripePriceFromEnv(value: string | undefined, fallback: string): string {
  const v = value?.trim();
  return v || fallback;
}

/** 月額プラン Price ID（`web/.env` の VITE_STRIPE_PRICE_MONTHLY） */
export const STRIPE_PRICE_MONTHLY = stripePriceFromEnv(
  import.meta.env.VITE_STRIPE_PRICE_MONTHLY,
  DEFAULT_STRIPE_PRICE_MONTHLY,
);

/** 年額プラン Price ID（`web/.env` の VITE_STRIPE_PRICE_YEARLY） */
export const STRIPE_PRICE_YEARLY = stripePriceFromEnv(
  import.meta.env.VITE_STRIPE_PRICE_YEARLY,
  DEFAULT_STRIPE_PRICE_YEARLY,
);

export type CheckoutSessionResponse = {
  url: string;
  sessionId: string;
};

export type RedeemLicenseResponse = {
  ok: true;
  billingStatus: string;
  paidThroughAt: string;
  validDays: number;
  canAccessApp: boolean;
};

export type BillingStatusResponse = {
  billingStatus: TenantBillingStatus;
  trialEndsAt: string | null;
  paidThroughAt: string | null;
  billingUpdatedAt?: string;
  canAccessApp: boolean;
  stripeCustomerId: string | null;
  bypassReason?: string | null;
};

export function billingStatusHeadline(status: TenantBillingStatus): string {
  switch (status) {
    case "EXPIRED":
      return "無料トライアル期間が終了しました";
    case "PAST_DUE":
      return "お支払いの確認が必要です";
    case "CANCELED":
      return "サブスクリプションが終了しています";
    case "TRIALING":
      return "トライアル期間中です";
    case "ACTIVE":
      return "ご利用中のプラン";
    case "LICENSE_ONLY":
      return "ライセンスキーでご利用中";
    default:
      return "お支払いまたはライセンスキーの登録が必要です";
  }
}

export function billingStatusDetail(
  status: TenantBillingStatus,
  trialEndsAt: string | null,
  paidThroughAt: string | null,
): string {
  if (status === "EXPIRED") {
    return "引き続きご利用いただくには、Stripeでのお支払い、またはライセンスキーの登録が必要です。";
  }
  if (status === "PAST_DUE") {
    return "決済情報の更新、またはライセンスキーの登録をお願いします。";
  }
  if (status === "CANCELED") {
    return "再度お申し込みいただくか、ライセンスキーをご利用ください。";
  }
  if (status === "TRIALING" && trialEndsAt) {
    return `トライアル終了予定: ${formatBillingDate(trialEndsAt)}`;
  }
  if (paidThroughAt) {
    return `有効期限: ${formatBillingDate(paidThroughAt)}`;
  }
  return "下記よりお支払い方法をお選びください。";
}

function formatBillingDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

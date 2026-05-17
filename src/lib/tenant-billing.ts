import type { TenantBillingStatus } from "@prisma/client";
import { isPlatformAdminEmail } from "./platform-admin.js";
import { isDemoTenantSession } from "./demo-tenant.js";

export const TRIAL_PERIOD_DAYS = 14;

export type TenantBillingSnapshot = {
  billingStatus: TenantBillingStatus;
  paidThroughAt: Date | null;
  trialEndsAt: Date | null;
};

export type BillingAccessContext = {
  email: string;
  tenantSlug: string;
};

export type BillingAccessResult =
  | { allowed: true; reason: "paid_through" | "trialing" | "demo" | "platform_admin" }
  | { allowed: false; billingStatus: TenantBillingStatus };

export function trialEndsAtFrom(base: Date = new Date()): Date {
  return new Date(base.getTime() + TRIAL_PERIOD_DAYS * 24 * 60 * 60 * 1000);
}

/** テナントがアプリ主要機能を利用可能か */
export function evaluateTenantBillingAccess(
  tenant: TenantBillingSnapshot | null,
  ctx: BillingAccessContext,
  now: Date = new Date(),
): BillingAccessResult {
  if (isDemoTenantSession(ctx.tenantSlug, ctx.email)) {
    return { allowed: true, reason: "demo" };
  }
  if (isPlatformAdminEmail(ctx.email)) {
    return { allowed: true, reason: "platform_admin" };
  }
  if (!tenant) {
    return { allowed: false, billingStatus: "EXPIRED" };
  }

  if (tenant.paidThroughAt && tenant.paidThroughAt.getTime() > now.getTime()) {
    return { allowed: true, reason: "paid_through" };
  }

  if (
    tenant.billingStatus === "TRIALING" &&
    tenant.trialEndsAt &&
    tenant.trialEndsAt.getTime() > now.getTime()
  ) {
    return { allowed: true, reason: "trialing" };
  }

  return { allowed: false, billingStatus: tenant.billingStatus };
}

export function billingRequiredMessage(billingStatus: TenantBillingStatus): string {
  if (billingStatus === "EXPIRED") {
    return "無料トライアル期間が終了しました。お支払いまたはライセンスキーの登録が必要です。";
  }
  if (billingStatus === "PAST_DUE") {
    return "お支払いの確認が必要です。決済情報を更新してください。";
  }
  if (billingStatus === "CANCELED") {
    return "サブスクリプションが終了しています。再度お申し込みください。";
  }
  return "お支払いまたはライセンスキーの登録が必要です。";
}

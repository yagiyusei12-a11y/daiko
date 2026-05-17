-- Tenant billing, subscription extensions, license keys, Stripe webhook events

CREATE TYPE "TenantBillingStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED', 'LICENSE_ONLY');
CREATE TYPE "SubscriptionSource" AS ENUM ('TRIAL', 'STRIPE', 'LICENSE_KEY', 'PLATFORM_ADMIN');
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELED', 'EXPIRED');

ALTER TABLE "Tenant" ADD COLUMN "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "billingStatus" "TenantBillingStatus" NOT NULL DEFAULT 'TRIALING';
ALTER TABLE "Tenant" ADD COLUMN "paidThroughAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "billingUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "Tenant_stripeCustomerId_key" ON "Tenant"("stripeCustomerId");

ALTER TABLE "Subscription" ADD COLUMN "source" "SubscriptionSource";
ALTER TABLE "Subscription" ADD COLUMN "status" "SubscriptionStatus";
ALTER TABLE "Subscription" ADD COLUMN "stripeSubscriptionId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "stripePriceId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "licenseKeyId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}';

CREATE INDEX "Subscription_tenantId_validFrom_idx" ON "Subscription"("tenantId", "validFrom");
CREATE INDEX "Subscription_stripeSubscriptionId_idx" ON "Subscription"("stripeSubscriptionId");

CREATE TABLE "LicenseKey" (
    "id" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT,
    "validDays" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "usedByTenantId" TEXT,
    "batchLabel" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LicenseKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LicenseKey_keyHash_key" ON "LicenseKey"("keyHash");
CREATE INDEX "LicenseKey_usedByTenantId_idx" ON "LicenseKey"("usedByTenantId");
CREATE INDEX "LicenseKey_batchLabel_idx" ON "LicenseKey"("batchLabel");

ALTER TABLE "LicenseKey" ADD CONSTRAINT "LicenseKey_usedByTenantId_fkey"
  FOREIGN KEY ("usedByTenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_licenseKeyId_fkey"
  FOREIGN KEY ("licenseKeyId") REFERENCES "LicenseKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StripeWebhookEvent_processedAt_idx" ON "StripeWebhookEvent"("processedAt");

-- 既存 Subscription 行: 手動付与扱い
UPDATE "Subscription"
SET
  "source" = 'PLATFORM_ADMIN',
  "status" = 'ACTIVE'
WHERE "source" IS NULL;

-- 案A: 既存テナントは登録日 + 14日。14日経過済みは EXPIRED
UPDATE "Tenant"
SET
  "trialEndsAt" = "createdAt" + INTERVAL '14 days',
  "paidThroughAt" = "createdAt" + INTERVAL '14 days',
  "billingStatus" = CASE
    WHEN "createdAt" + INTERVAL '14 days' > NOW() THEN 'TRIALING'::"TenantBillingStatus"
    ELSE 'EXPIRED'::"TenantBillingStatus"
  END,
  "billingUpdatedAt" = NOW()
WHERE "trialEndsAt" IS NULL;

-- トライアル履歴行（最新が無いテナント向け）
INSERT INTO "Subscription" ("id", "tenantId", "planTier", "source", "status", "validFrom", "validTo", "metadata", "createdAt")
SELECT
  'trial_backfill_' || t."id",
  t."id",
  'STANDARD'::"PlanTier",
  'TRIAL'::"SubscriptionSource",
  CASE
    WHEN t."billingStatus" = 'EXPIRED'::"TenantBillingStatus" THEN 'EXPIRED'::"SubscriptionStatus"
    ELSE 'ACTIVE'::"SubscriptionStatus"
  END,
  t."createdAt",
  t."trialEndsAt",
  '{}'::jsonb,
  t."createdAt"
FROM "Tenant" t
WHERE NOT EXISTS (
  SELECT 1 FROM "Subscription" s
  WHERE s."tenantId" = t."id" AND s."source" = 'TRIAL'::"SubscriptionSource"
);

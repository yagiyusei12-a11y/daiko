-- 既存の初期テスターから14日制限を外す（当面は期限なし）
UPDATE "Tenant"
SET "paidThroughAt" = NULL,
    "trialEndsAt" = NULL
WHERE "isEarlyTester" = true;

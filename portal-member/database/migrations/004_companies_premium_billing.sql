-- プレミアム課金・請求システム連携（ポータル会員 DB）
-- 実行例: mysql -u root -p portal_member < database/migrations/004_companies_premium_billing.sql

USE portal_member;

ALTER TABLE companies
  ADD COLUMN premium_invoice_slip_id BIGINT UNSIGNED NULL DEFAULT NULL COMMENT '請求システム sales_slip.id' AFTER is_premium,
  ADD COLUMN premium_billing_status ENUM('none','pending','invoiced','paid','overdue','cancelled') NOT NULL DEFAULT 'none' COMMENT '課金ライフサイクル' AFTER premium_invoice_slip_id,
  ADD COLUMN premium_requested_at DATETIME NULL DEFAULT NULL AFTER premium_billing_status,
  ADD COLUMN premium_due_date DATE NULL DEFAULT NULL AFTER premium_requested_at,
  ADD COLUMN premium_paid_at DATETIME NULL DEFAULT NULL AFTER premium_due_date;

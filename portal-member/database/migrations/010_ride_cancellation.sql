-- フェーズ13: キャンセルポリシー・キャンセル料
-- 実行例: mysql -u root -p portal_member < database/migrations/010_ride_cancellation.sql

USE portal_member;

ALTER TABLE ride_requests
  ADD COLUMN cancelled_by ENUM('user', 'agency', 'system') NULL DEFAULT NULL COMMENT 'キャンセル実行者' AFTER pickup_lng,
  ADD COLUMN cancellation_reason VARCHAR(512) NULL DEFAULT NULL COMMENT 'キャンセル理由' AFTER cancelled_by,
  ADD COLUMN cancelled_at DATETIME NULL DEFAULT NULL COMMENT 'キャンセル日時' AFTER cancellation_reason,
  ADD COLUMN cancellation_fee_charged TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'キャンセル料徴収済み' AFTER cancelled_at,
  ADD COLUMN stripe_customer_id VARCHAR(255) NULL DEFAULT NULL COMMENT 'Stripe Customer（再課金用）' AFTER cancellation_fee_charged,
  ADD COLUMN stripe_payment_method_id VARCHAR(255) NULL DEFAULT NULL COMMENT 'Stripe PaymentMethod' AFTER stripe_customer_id;

ALTER TABLE transactions
  ADD COLUMN transaction_type ENUM('ride_fare', 'cancellation_fee') NOT NULL DEFAULT 'ride_fare'
    COMMENT '取引種別' AFTER company_id;

ALTER TABLE transactions
  DROP INDEX uq_transactions_ride_request;

ALTER TABLE transactions
  ADD UNIQUE KEY uq_transactions_ride_type (ride_request_id, transaction_type);

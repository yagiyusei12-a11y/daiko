-- フェーズ14: ダイナミックプライシング（サージ倍率記録）
-- 実行例: mysql -u root -p portal_member < database/migrations/011_surge_pricing.sql

USE portal_member;

ALTER TABLE transactions
  ADD COLUMN base_amount INT UNSIGNED NULL DEFAULT NULL COMMENT 'サージ適用前の基本料金' AFTER total_amount,
  ADD COLUMN surge_multiplier DECIMAL(4, 2) NOT NULL DEFAULT 1.00 COMMENT '適用サージ倍率' AFTER base_amount;

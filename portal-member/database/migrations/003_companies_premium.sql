-- 第5弾: 有料プラン（プレミアム掲載）フラグ
-- 実行例: mysql -u root -p portal_member < database/migrations/003_companies_premium.sql

USE portal_member;

ALTER TABLE companies
  ADD COLUMN is_premium TINYINT(1) NOT NULL DEFAULT 0 COMMENT '有料プラン（上位表示・おすすめバッジ）' AFTER left_hand_drive_ok;

-- 第1弾: お迎え目安・こだわり条件（companies 拡張）
-- 実行例: mysql -u root -p portal_member < database/migrations/002_companies_portal_features.sql

USE portal_member;

ALTER TABLE companies
  ADD COLUMN wait_time_minutes INT UNSIGNED DEFAULT NULL COMMENT 'お迎え目安時間（分）' AFTER review_count,
  ADD COLUMN accept_cashless TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'キャッシュレス決済対応',
  ADD COLUMN is_invoice_registered TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'インボイス対応',
  ADD COLUMN has_female_driver TINYINT(1) NOT NULL DEFAULT 0 COMMENT '女性ドライバー在籍',
  ADD COLUMN left_hand_drive_ok TINYINT(1) NOT NULL DEFAULT 0 COMMENT '左ハンドル外車対応';

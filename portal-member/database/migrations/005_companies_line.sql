-- LINE Messaging API 連携（業者の line_user_id 紐付け）
-- 実行例: mysql -u root -p portal_member < database/migrations/005_companies_line.sql

USE portal_member;

ALTER TABLE companies
  ADD COLUMN line_user_id VARCHAR(255) NULL DEFAULT NULL COMMENT 'LINE Messaging API userId' AFTER premium_paid_at,
  ADD COLUMN line_link_code VARCHAR(32) NULL DEFAULT NULL COMMENT 'LINE連携用ワンタイムコード' AFTER line_user_id,
  ADD COLUMN line_link_expires_at DATETIME NULL DEFAULT NULL COMMENT '連携コード有効期限' AFTER line_link_code,
  ADD UNIQUE KEY uq_companies_line_user_id (line_user_id);

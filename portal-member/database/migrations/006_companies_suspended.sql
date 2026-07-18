-- 第9弾: 管理者による強制停止（ポータル掲載除外）
-- 実行例: mysql -u root -p portal_member < database/migrations/006_companies_suspended.sql

USE portal_member;

ALTER TABLE companies
  ADD COLUMN is_suspended TINYINT(1) NOT NULL DEFAULT 0 COMMENT '強制停止（ポータル掲載・API除外）' AFTER line_link_expires_at;

-- 全国運転代行ポータル：業者会員用 MySQL スキーマ
-- 実行例: mysql -u root -p portal_member < database/migrations/001_init.sql

CREATE DATABASE IF NOT EXISTS portal_member
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE portal_member;

-- 業者アカウント（会員）
CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('free', 'premium') NOT NULL DEFAULT 'free',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 代行業者（1ユーザー = 1社 を想定）
CREATE TABLE IF NOT EXISTS companies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  cert_number VARCHAR(64) NOT NULL COMMENT '認定番号',
  name VARCHAR(255) NOT NULL COMMENT '業者名',
  tel VARCHAR(64) DEFAULT NULL,
  website VARCHAR(512) DEFAULT NULL,
  prefecture VARCHAR(32) NOT NULL DEFAULT '',
  city VARCHAR(64) NOT NULL DEFAULT '',
  address VARCHAR(512) NOT NULL DEFAULT '',
  description TEXT DEFAULT NULL,
  rating DECIMAL(3,1) DEFAULT NULL,
  review_count INT UNSIGNED DEFAULT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_companies_user_id (user_id),
  KEY idx_companies_cert (cert_number),
  KEY idx_companies_prefecture_city (prefecture, city),
  CONSTRAINT fk_companies_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 料金体系（1社につき1レコード想定。履歴が必要なら UNIQUE を外す）
CREATE TABLE IF NOT EXISTS prices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  base_distance DECIMAL(6,2) DEFAULT NULL COMMENT '初乗り km',
  base_price INT UNSIGNED DEFAULT NULL COMMENT '初乗り料金（円）',
  per_km_price INT UNSIGNED DEFAULT NULL COMMENT '以降1kmごと（円）',
  note VARCHAR(512) DEFAULT NULL COMMENT '深夜料金など',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_prices_company_id (company_id),
  CONSTRAINT fk_prices_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 本日のイベント・待機状況
CREATE TABLE IF NOT EXISTS events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=本日営業中',
  drivers_available INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '待機ドライバー数',
  event_title VARCHAR(255) DEFAULT NULL,
  event_body TEXT DEFAULT NULL,
  expires_at DATETIME DEFAULT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_events_company_id (company_id),
  CONSTRAINT fk_events_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

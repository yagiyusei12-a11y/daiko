-- フェーズ10: スマート配車リクエスト（Uber型一斉配車）
-- 実行例: mysql -u root -p portal_member < database/migrations/007_ride_requests.sql

USE portal_member;

CREATE TABLE IF NOT EXISTS ride_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  pref_slug VARCHAR(64) NOT NULL DEFAULT '',
  city_slug VARCHAR(128) NOT NULL DEFAULT '',
  city_name VARCHAR(64) NOT NULL DEFAULT '',
  prefecture VARCHAR(32) NOT NULL DEFAULT '',
  user_name VARCHAR(128) NOT NULL,
  user_phone VARCHAR(32) NOT NULL,
  location_details TEXT DEFAULT NULL COMMENT '現在地・お迎え先など',
  status ENUM('pending', 'accepted', 'completed', 'cancelled') NOT NULL DEFAULT 'pending',
  accepted_company_id BIGINT UNSIGNED NULL DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  accepted_at DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_ride_requests_status (status, created_at),
  KEY idx_ride_requests_city (city_slug, status),
  KEY idx_ride_requests_accepted_company (accepted_company_id),
  CONSTRAINT fk_ride_requests_company
    FOREIGN KEY (accepted_company_id) REFERENCES companies (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

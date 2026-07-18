-- フェーズ15: 双方向レビュー・レーティング・品質管理
-- mysql -u root -p portal_member < database/migrations/012_reviews_rating_system.sql

USE portal_member;

-- ユーザー → 業者のレビュー（乗車完了後）
CREATE TABLE IF NOT EXISTS reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ride_request_id BIGINT UNSIGNED NOT NULL,
  company_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL DEFAULT NULL COMMENT '会員ログイン時のみ',
  rating TINYINT UNSIGNED NOT NULL COMMENT '1-5',
  comment TEXT NULL DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reviews_ride_request (ride_request_id),
  KEY idx_reviews_company_created (company_id, created_at),
  KEY idx_reviews_rating (company_id, rating),
  CONSTRAINT fk_reviews_ride_request
    FOREIGN KEY (ride_request_id) REFERENCES ride_requests (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_reviews_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_reviews_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 業者 → ユーザーのマナー評価（配車リクエスト単位）
ALTER TABLE ride_requests
  ADD COLUMN user_manner_rating ENUM('good', 'bad') NULL DEFAULT NULL COMMENT '業者によるお客様マナー',
  ADD COLUMN driver_notes TEXT NULL DEFAULT NULL COMMENT '業者メモ（運営確認用）',
  ADD COLUMN user_review_submitted_at DATETIME NULL DEFAULT NULL COMMENT 'ユーザーが業者レビュー送信済み';

-- 低評価による一斉配信一時除外
ALTER TABLE companies
  ADD COLUMN rating_qc_excluded TINYINT(1) NOT NULL DEFAULT 0 COMMENT '直近レビュー品質基準未満で配信除外',
  ADD COLUMN rating_qc_excluded_at DATETIME NULL DEFAULT NULL COMMENT '除外フラグ更新日時';

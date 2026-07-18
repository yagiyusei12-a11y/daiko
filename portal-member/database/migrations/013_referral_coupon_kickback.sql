-- フェーズ16: 紹介クーポン ＆ 飲食店キックバック
-- mysql -u root -p portal_member < database/migrations/013_referral_coupon_kickback.sql

USE portal_member;

-- プロモーションコード
CREATE TABLE IF NOT EXISTS coupons (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(32) NOT NULL COMMENT 'クーポンコード（大文字推奨）',
  discount_amount INT UNSIGNED NOT NULL COMMENT '割引額（円）',
  is_used TINYINT(1) NOT NULL DEFAULT 0,
  user_id BIGINT UNSIGNED NULL DEFAULT NULL COMMENT '発行先ユーザー（任意）',
  ride_request_id BIGINT UNSIGNED NULL DEFAULT NULL COMMENT '利用した配車リクエスト',
  used_at DATETIME NULL DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_coupons_code (code),
  KEY idx_coupons_is_used (is_used),
  CONSTRAINT fk_coupons_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 飲食店アカウント拡張
ALTER TABLE users
  MODIFY COLUMN role ENUM('free', 'premium', 'shop') NOT NULL DEFAULT 'free',
  ADD COLUMN kickback_balance INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'キックバック報酬残高（円）',
  ADD COLUMN shop_name VARCHAR(255) NULL DEFAULT NULL COMMENT '飲食店表示名（role=shop）';

-- 配車リクエスト：クーポン・飲食店紹介
ALTER TABLE ride_requests
  ADD COLUMN coupon_id BIGINT UNSIGNED NULL DEFAULT NULL COMMENT '適用クーポン',
  ADD COLUMN referred_by_shop_id BIGINT UNSIGNED NULL DEFAULT NULL COMMENT '紹介飲食店 users.id',
  ADD KEY idx_ride_requests_shop_ref (referred_by_shop_id, created_at),
  ADD CONSTRAINT fk_ride_requests_coupon
    FOREIGN KEY (coupon_id) REFERENCES coupons (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT fk_ride_requests_shop
    FOREIGN KEY (referred_by_shop_id) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 決済：クーポン割引額
ALTER TABLE transactions
  ADD COLUMN coupon_discount INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'クーポン割引（円）',
  ADD COLUMN kickback_amount INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '飲食店キックバック（円・手数料から控除）';

-- キックバック付与履歴
CREATE TABLE IF NOT EXISTS shop_kickback_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shop_user_id BIGINT UNSIGNED NOT NULL,
  ride_request_id BIGINT UNSIGNED NOT NULL,
  transaction_id BIGINT UNSIGNED NOT NULL,
  amount_yen INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_kickback_transaction (transaction_id),
  KEY idx_kickback_shop_month (shop_user_id, created_at),
  CONSTRAINT fk_kickback_shop_user
    FOREIGN KEY (shop_user_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_kickback_ride
    FOREIGN KEY (ride_request_id) REFERENCES ride_requests (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_kickback_transaction
    FOREIGN KEY (transaction_id) REFERENCES transactions (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- テスト用サンプルクーポン（本番では管理画面等から発行）
INSERT INTO coupons (code, discount_amount, is_used)
SELECT 'WELCOME500', 500, 0
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM coupons WHERE code = 'WELCOME500' LIMIT 1);

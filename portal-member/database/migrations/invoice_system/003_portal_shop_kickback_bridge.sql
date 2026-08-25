-- 請求システム DB: 飲食店紹介料（支払手数料）ブリッジ
CREATE TABLE IF NOT EXISTS portal_shop_kickback_billings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  portal_transaction_id BIGINT UNSIGNED NOT NULL,
  portal_shop_user_id BIGINT UNSIGNED NOT NULL,
  ride_request_id BIGINT UNSIGNED NOT NULL,
  sales_slip_id INT UNSIGNED NOT NULL COMMENT '支払起票 sales_slip.id',
  kickback_amount_yen INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_portal_kickback_txn (portal_transaction_id),
  KEY idx_shop_user (portal_shop_user_id),
  KEY idx_sales_slip (sales_slip_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

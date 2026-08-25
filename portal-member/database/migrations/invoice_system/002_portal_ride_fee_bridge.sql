-- 請求システム DB 側: 配車手数料（プラットフォーム売上）ブリッジ
-- sales_entry（sales_slip）連携用

CREATE TABLE IF NOT EXISTS portal_ride_fee_billings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  portal_transaction_id BIGINT UNSIGNED NOT NULL COMMENT 'portal_member.transactions.id',
  portal_company_id BIGINT UNSIGNED NOT NULL,
  ride_request_id BIGINT UNSIGNED NOT NULL,
  sales_slip_id INT UNSIGNED NOT NULL COMMENT 'sales_slip.id（手数料分の売上伝票）',
  platform_fee_yen INT UNSIGNED NOT NULL,
  total_amount_yen INT UNSIGNED NOT NULL,
  agency_amount_yen INT UNSIGNED NOT NULL,
  stripe_charge_id VARCHAR(255) NULL DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_portal_transaction (portal_transaction_id),
  KEY idx_ride_request (ride_request_id),
  KEY idx_sales_slip (sales_slip_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

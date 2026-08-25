-- 請求システム DB（invoice.harunoyukoto.com 等）側に実行
-- sales_entry（sales_slip）連携用ブリッジテーブル
--
-- 実行例:
--   mysql -u USER -p INVOICE_DB_NAME < database/migrations/invoice_system/001_portal_premium_bridge.sql

CREATE TABLE IF NOT EXISTS portal_premium_billings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  portal_company_id BIGINT UNSIGNED NOT NULL COMMENT 'portal_member.companies.id',
  portal_cert_number VARCHAR(64) NOT NULL DEFAULT '',
  company_name VARCHAR(255) NOT NULL,
  sales_slip_id INT UNSIGNED NOT NULL COMMENT 'sales_slip.id（請求伝票）',
  amount_yen INT UNSIGNED NOT NULL,
  item_name VARCHAR(255) NOT NULL DEFAULT 'ポータルサイトプレミアム枠掲載料',
  billing_status ENUM('invoiced','paid','cancelled','overdue') NOT NULL DEFAULT 'invoiced',
  due_date DATE NOT NULL,
  paid_at DATETIME NULL DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_portal_company (portal_company_id),
  KEY idx_sales_slip (sales_slip_id),
  KEY idx_billing_status (billing_status, due_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

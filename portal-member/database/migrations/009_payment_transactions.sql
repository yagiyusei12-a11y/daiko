-- フェーズ12: 配車決済・手数料管理
-- 実行例: mysql -u root -p portal_member < database/migrations/009_payment_transactions.sql

USE portal_member;

ALTER TABLE companies
  ADD COLUMN commission_rate DECIMAL(5, 2) NOT NULL DEFAULT 10.00
    COMMENT 'プラットフォーム手数料率（%）' AFTER is_suspended;

CREATE TABLE IF NOT EXISTS transactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ride_request_id BIGINT UNSIGNED NOT NULL,
  company_id BIGINT UNSIGNED NOT NULL COMMENT '受注業者 companies.id',
  total_amount INT UNSIGNED NOT NULL COMMENT '決済総額（円）',
  platform_fee INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'プラットフォーム手数料（円）',
  agency_amount INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '業者取り分（円）',
  commission_rate DECIMAL(5, 2) NOT NULL DEFAULT 10.00 COMMENT '適用時手数料率（%）',
  payment_status ENUM('pending', 'paid', 'refunded') NOT NULL DEFAULT 'pending',
  payout_status ENUM('pending', 'transferred') NOT NULL DEFAULT 'pending' COMMENT '業者への振込プール状態',
  stripe_payment_intent_id VARCHAR(255) NULL DEFAULT NULL,
  stripe_charge_id VARCHAR(255) NULL DEFAULT NULL,
  invoice_slip_id BIGINT UNSIGNED NULL DEFAULT NULL COMMENT '請求システム sales_slip.id（手数料売上）',
  paid_at DATETIME NULL DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_transactions_ride_request (ride_request_id),
  KEY idx_transactions_company_status (company_id, payment_status),
  KEY idx_transactions_payout (company_id, payout_status, payment_status),
  CONSTRAINT fk_transactions_ride_request
    FOREIGN KEY (ride_request_id) REFERENCES ride_requests (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_transactions_company
    FOREIGN KEY (company_id) REFERENCES companies (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

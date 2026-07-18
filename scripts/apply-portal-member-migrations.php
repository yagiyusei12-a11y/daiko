<?php
declare(strict_types=1);

/**
 * Apply pending portal_member ALTER/CREATE migrations on the configured DB.
 * Usage (on VPS): php scripts/apply-portal-member-migrations.php
 */

$configPath = dirname(__DIR__) . '/portal-member/config/config.php';
if (!is_file($configPath)) {
    fwrite(STDERR, "config.php not found\n");
    exit(1);
}

/** @var array<string, mixed> $config */
$config = require $configPath;
$db = is_array($config['db'] ?? null) ? $config['db'] : [];
$host = (string) ($db['host'] ?? '127.0.0.1');
$name = (string) ($db['name'] ?? $db['dbname'] ?? $db['database'] ?? 'portal_member');
$user = (string) ($db['user'] ?? $db['username'] ?? '');
$pass = (string) ($db['pass'] ?? $db['password'] ?? '');
$charset = (string) ($db['charset'] ?? 'utf8mb4');

$pdo = new PDO(
    sprintf('mysql:host=%s;dbname=%s;charset=%s', $host, $name, $charset),
    $user,
    $pass,
    [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]
);

function columnExists(PDO $pdo, string $table, string $column): bool
{
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?'
    );
    $stmt->execute([$table, $column]);
    return (int) $stmt->fetchColumn() > 0;
}

function tableExists(PDO $pdo, string $table): bool
{
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?'
    );
    $stmt->execute([$table]);
    return (int) $stmt->fetchColumn() > 0;
}

function indexExists(PDO $pdo, string $table, string $index): bool
{
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?'
    );
    $stmt->execute([$table, $index]);
    return (int) $stmt->fetchColumn() > 0;
}

function run(PDO $pdo, string $label, string $sql): void
{
    echo "→ {$label}\n";
    $pdo->exec($sql);
    echo "  OK\n";
}

echo "DB={$name} host={$host}\n";

// 002 portal features
if (!columnExists($pdo, 'companies', 'wait_time_minutes')) {
    run($pdo, '002 wait_time / features', <<<'SQL'
ALTER TABLE companies
  ADD COLUMN wait_time_minutes INT UNSIGNED DEFAULT NULL COMMENT 'お迎え目安時間（分）' AFTER review_count,
  ADD COLUMN accept_cashless TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'キャッシュレス決済対応',
  ADD COLUMN is_invoice_registered TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'インボイス対応',
  ADD COLUMN has_female_driver TINYINT(1) NOT NULL DEFAULT 0 COMMENT '女性ドライバー在籍',
  ADD COLUMN left_hand_drive_ok TINYINT(1) NOT NULL DEFAULT 0 COMMENT '左ハンドル外車対応'
SQL);
} else {
    echo "skip 002 (already applied)\n";
}

// 003 premium
if (!columnExists($pdo, 'companies', 'is_premium')) {
    run($pdo, '003 is_premium', <<<'SQL'
ALTER TABLE companies
  ADD COLUMN is_premium TINYINT(1) NOT NULL DEFAULT 0 COMMENT '有料プラン' AFTER left_hand_drive_ok
SQL);
} else {
    echo "skip 003\n";
}

// 004 premium billing
if (!columnExists($pdo, 'companies', 'premium_billing_status')) {
    run($pdo, '004 premium billing', <<<'SQL'
ALTER TABLE companies
  ADD COLUMN premium_invoice_slip_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER is_premium,
  ADD COLUMN premium_billing_status ENUM('none','pending','invoiced','paid','overdue','cancelled') NOT NULL DEFAULT 'none' AFTER premium_invoice_slip_id,
  ADD COLUMN premium_requested_at DATETIME NULL DEFAULT NULL AFTER premium_billing_status,
  ADD COLUMN premium_due_date DATE NULL DEFAULT NULL AFTER premium_requested_at,
  ADD COLUMN premium_paid_at DATETIME NULL DEFAULT NULL AFTER premium_due_date
SQL);
} else {
    echo "skip 004\n";
}

// 005 line
if (!columnExists($pdo, 'companies', 'line_user_id')) {
    run($pdo, '005 line columns', <<<'SQL'
ALTER TABLE companies
  ADD COLUMN line_user_id VARCHAR(255) NULL DEFAULT NULL AFTER premium_paid_at,
  ADD COLUMN line_link_code VARCHAR(32) NULL DEFAULT NULL AFTER line_user_id,
  ADD COLUMN line_link_expires_at DATETIME NULL DEFAULT NULL AFTER line_link_code
SQL);
} else {
    echo "skip 005 columns\n";
}
if (columnExists($pdo, 'companies', 'line_user_id') && !indexExists($pdo, 'companies', 'uq_companies_line_user_id')) {
    run($pdo, '005 line unique index', 'ALTER TABLE companies ADD UNIQUE KEY uq_companies_line_user_id (line_user_id)');
}

// 006 suspended
if (!columnExists($pdo, 'companies', 'is_suspended')) {
    $after = columnExists($pdo, 'companies', 'line_link_expires_at') ? ' AFTER line_link_expires_at' : '';
    run($pdo, '006 is_suspended', "ALTER TABLE companies ADD COLUMN is_suspended TINYINT(1) NOT NULL DEFAULT 0{$after}");
} else {
    echo "skip 006\n";
}

// 007 ride_requests
if (!tableExists($pdo, 'ride_requests')) {
    run($pdo, '007 ride_requests', <<<'SQL'
CREATE TABLE ride_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  pref_slug VARCHAR(64) NOT NULL DEFAULT '',
  city_slug VARCHAR(128) NOT NULL DEFAULT '',
  city_name VARCHAR(64) NOT NULL DEFAULT '',
  prefecture VARCHAR(32) NOT NULL DEFAULT '',
  user_name VARCHAR(128) NOT NULL,
  user_phone VARCHAR(32) NOT NULL,
  location_details TEXT DEFAULT NULL,
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
SQL);
} else {
    echo "skip 007\n";
}

// 008 driver location
if (tableExists($pdo, 'ride_requests') && !columnExists($pdo, 'ride_requests', 'driver_lat')) {
    run($pdo, '008 driver location cols', <<<'SQL'
ALTER TABLE ride_requests
  ADD COLUMN driver_lat DECIMAL(10, 8) NULL DEFAULT NULL AFTER accepted_at,
  ADD COLUMN driver_lng DECIMAL(11, 8) NULL DEFAULT NULL AFTER driver_lat,
  ADD COLUMN last_location_updated_at DATETIME NULL DEFAULT NULL AFTER driver_lng,
  ADD COLUMN driver_tracking_token VARCHAR(64) NULL DEFAULT NULL AFTER last_location_updated_at,
  ADD COLUMN pickup_lat DECIMAL(10, 8) NULL DEFAULT NULL AFTER driver_tracking_token,
  ADD COLUMN pickup_lng DECIMAL(11, 8) NULL DEFAULT NULL AFTER pickup_lat
SQL);
}
if (tableExists($pdo, 'ride_requests') && !indexExists($pdo, 'ride_requests', 'idx_ride_requests_tracking_token')) {
    run($pdo, '008 tracking index', 'CREATE INDEX idx_ride_requests_tracking_token ON ride_requests (driver_tracking_token)');
} else {
    echo "skip 008 index\n";
}

// 009 commission + transactions
if (!columnExists($pdo, 'companies', 'commission_rate')) {
    run($pdo, '009 commission_rate', <<<'SQL'
ALTER TABLE companies
  ADD COLUMN commission_rate DECIMAL(5, 2) NOT NULL DEFAULT 10.00 AFTER is_suspended
SQL);
} else {
    echo "skip 009 commission\n";
}
if (!tableExists($pdo, 'transactions')) {
    run($pdo, '009 transactions', <<<'SQL'
CREATE TABLE transactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ride_request_id BIGINT UNSIGNED NOT NULL,
  company_id BIGINT UNSIGNED NOT NULL,
  total_amount INT UNSIGNED NOT NULL,
  platform_fee INT UNSIGNED NOT NULL DEFAULT 0,
  agency_amount INT UNSIGNED NOT NULL DEFAULT 0,
  commission_rate DECIMAL(5, 2) NOT NULL DEFAULT 10.00,
  payment_status ENUM('pending', 'paid', 'refunded') NOT NULL DEFAULT 'pending',
  payout_status ENUM('pending', 'transferred') NOT NULL DEFAULT 'pending',
  stripe_payment_intent_id VARCHAR(255) NULL DEFAULT NULL,
  stripe_charge_id VARCHAR(255) NULL DEFAULT NULL,
  invoice_slip_id BIGINT UNSIGNED NULL DEFAULT NULL,
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
SQL);
} else {
    echo "skip 009 transactions\n";
}

// 010 cancellation
if (tableExists($pdo, 'ride_requests') && !columnExists($pdo, 'ride_requests', 'cancelled_by')) {
    run($pdo, '010 ride cancel cols', <<<'SQL'
ALTER TABLE ride_requests
  ADD COLUMN cancelled_by ENUM('user', 'agency', 'system') NULL DEFAULT NULL AFTER pickup_lng,
  ADD COLUMN cancellation_reason VARCHAR(512) NULL DEFAULT NULL AFTER cancelled_by,
  ADD COLUMN cancelled_at DATETIME NULL DEFAULT NULL AFTER cancellation_reason,
  ADD COLUMN cancellation_fee_charged TINYINT(1) NOT NULL DEFAULT 0 AFTER cancelled_at,
  ADD COLUMN stripe_customer_id VARCHAR(255) NULL DEFAULT NULL AFTER cancellation_fee_charged,
  ADD COLUMN stripe_payment_method_id VARCHAR(255) NULL DEFAULT NULL AFTER stripe_customer_id
SQL);
}
if (tableExists($pdo, 'transactions') && !columnExists($pdo, 'transactions', 'transaction_type')) {
    run($pdo, '010 tx type', <<<'SQL'
ALTER TABLE transactions
  ADD COLUMN transaction_type ENUM('ride_fare', 'cancellation_fee') NOT NULL DEFAULT 'ride_fare' AFTER company_id
SQL);
    try {
        $pdo->exec('ALTER TABLE transactions DROP INDEX uq_transactions_ride_request');
    } catch (Throwable $e) {
        echo "010 drop old unique warn: " . $e->getMessage() . "\n";
    }
    if (!indexExists($pdo, 'transactions', 'uq_transactions_ride_type')) {
        run($pdo, '010 tx unique', 'ALTER TABLE transactions ADD UNIQUE KEY uq_transactions_ride_type (ride_request_id, transaction_type)');
    }
} else {
    echo "skip 010 tx type\n";
}

// 011 surge columns on transactions
if (tableExists($pdo, 'transactions') && !columnExists($pdo, 'transactions', 'surge_multiplier')) {
    run($pdo, '011 surge', <<<'SQL'
ALTER TABLE transactions
  ADD COLUMN base_amount INT UNSIGNED NULL DEFAULT NULL AFTER total_amount,
  ADD COLUMN surge_multiplier DECIMAL(4, 2) NOT NULL DEFAULT 1.00 AFTER base_amount
SQL);
} else {
    echo "skip 011\n";
}

// 012 reviews
if (!tableExists($pdo, 'reviews')) {
    run($pdo, '012 reviews', <<<'SQL'
CREATE TABLE reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ride_request_id BIGINT UNSIGNED NOT NULL,
  company_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL DEFAULT NULL,
  rating TINYINT UNSIGNED NOT NULL,
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
SQL);
} else {
    echo "skip 012 reviews table\n";
}
if (tableExists($pdo, 'ride_requests') && !columnExists($pdo, 'ride_requests', 'user_manner_rating')) {
    run($pdo, '012 ride manner cols', <<<'SQL'
ALTER TABLE ride_requests
  ADD COLUMN user_manner_rating ENUM('good', 'bad') NULL DEFAULT NULL,
  ADD COLUMN driver_notes TEXT NULL DEFAULT NULL,
  ADD COLUMN user_review_submitted_at DATETIME NULL DEFAULT NULL
SQL);
}
if (!columnExists($pdo, 'companies', 'rating_qc_excluded')) {
    run($pdo, '012 rating_qc', <<<'SQL'
ALTER TABLE companies
  ADD COLUMN rating_qc_excluded TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN rating_qc_excluded_at DATETIME NULL DEFAULT NULL
SQL);
}

// 013 coupons / kickback (idempotent pieces)
if (!tableExists($pdo, 'coupons')) {
    run($pdo, '013 coupons', <<<'SQL'
CREATE TABLE coupons (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(32) NOT NULL,
  discount_amount INT UNSIGNED NOT NULL,
  is_used TINYINT(1) NOT NULL DEFAULT 0,
  user_id BIGINT UNSIGNED NULL DEFAULT NULL,
  ride_request_id BIGINT UNSIGNED NULL DEFAULT NULL,
  used_at DATETIME NULL DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_coupons_code (code),
  KEY idx_coupons_is_used (is_used),
  CONSTRAINT fk_coupons_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
SQL);
}
if (!columnExists($pdo, 'users', 'kickback_balance')) {
    run($pdo, '013 users kickback', <<<'SQL'
ALTER TABLE users
  ADD COLUMN kickback_balance INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN shop_name VARCHAR(255) NULL DEFAULT NULL
SQL);
}
if (tableExists($pdo, 'ride_requests') && !columnExists($pdo, 'ride_requests', 'coupon_id')) {
    run($pdo, '013 ride coupon cols', <<<'SQL'
ALTER TABLE ride_requests
  ADD COLUMN coupon_id BIGINT UNSIGNED NULL DEFAULT NULL,
  ADD COLUMN referred_by_shop_id BIGINT UNSIGNED NULL DEFAULT NULL,
  ADD KEY idx_ride_requests_shop_ref (referred_by_shop_id, created_at),
  ADD CONSTRAINT fk_ride_requests_coupon
    FOREIGN KEY (coupon_id) REFERENCES coupons (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT fk_ride_requests_shop
    FOREIGN KEY (referred_by_shop_id) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
SQL);
}
if (tableExists($pdo, 'transactions') && !columnExists($pdo, 'transactions', 'coupon_discount')) {
    run($pdo, '013 tx coupon cols', <<<'SQL'
ALTER TABLE transactions
  ADD COLUMN coupon_discount INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN kickback_amount INT UNSIGNED NOT NULL DEFAULT 0
SQL);
}
if (!tableExists($pdo, 'shop_kickback_ledger')) {
    run($pdo, '013 kickback ledger', <<<'SQL'
CREATE TABLE shop_kickback_ledger (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
SQL);
}

// users.role shop (optional)
try {
    $roleCol = $pdo->query("SHOW COLUMNS FROM users LIKE 'role'")->fetch(PDO::FETCH_ASSOC);
    $type = (string) ($roleCol['Type'] ?? '');
    if ($type !== '' && !str_contains($type, "'shop'")) {
        run($pdo, 'users.role add shop', "ALTER TABLE users MODIFY role ENUM('free','premium','shop') NOT NULL DEFAULT 'free'");
    } else {
        echo "skip users.role shop\n";
    }
} catch (Throwable $e) {
    echo "users.role warn: " . $e->getMessage() . "\n";
}

echo "DONE\n";

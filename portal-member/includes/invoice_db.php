<?php
declare(strict_types=1);

/**
 * 自社請求システム（invoice.harunoyukoto.com）用 PDO 接続。
 */
function invoice_db(): ?PDO
{
    static $pdo = null;
    static $failed = false;

    if ($failed) {
        return null;
    }
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    global $config;
    $inv = $config['invoice'] ?? [];
    if (empty($inv['enabled'])) {
        return null;
    }

    $db = $inv['db'] ?? [];
    $database = (string) ($db['database'] ?? '');
    if ($database === '') {
        return null;
    }

    try {
        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=%s',
            $db['host'] ?? '127.0.0.1',
            (int) ($db['port'] ?? 3306),
            $database,
            $db['charset'] ?? 'utf8mb4'
        );
        $pdo = new PDO($dsn, $db['username'] ?? 'root', $db['password'] ?? '', [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        $pdo->exec("SET time_zone = '+09:00'");
    } catch (Throwable $e) {
        $failed = true;
        error_log('invoice_db connect failed: ' . $e->getMessage());
        return null;
    }

    return $pdo;
}

function invoice_config(): array
{
    global $config;
    return is_array($config['invoice'] ?? null) ? $config['invoice'] : [];
}

function invoice_table(string $logical): string
{
    $tables = invoice_config()['tables'] ?? [];
    $map = [
        'sales_slip' => 'sales_slip',
        'sales_parts' => 'sales_parts',
        'sales_slip_display_name' => 'sales_slip_display_name',
        'm_customer' => 'm_customer',
        'portal_premium_billings' => 'portal_premium_billings',
        'portal_ride_fee_billings' => 'portal_ride_fee_billings',
        'portal_shop_kickback_billings' => 'portal_shop_kickback_billings',
        'pay_receipt' => 'pay_receipt',
    ];
    return (string) ($tables[$logical] ?? $map[$logical] ?? $logical);
}

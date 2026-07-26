<?php
declare(strict_types=1);

require_once __DIR__ . '/invoice_db.php';
require_once __DIR__ . '/ride_dispatch.php';

/**
 * @return array<string, mixed>|null
 */
function kickback_payment_find_transaction(int $transactionId): ?array
{
    $stmt = db()->prepare('SELECT * FROM transactions WHERE id = ? LIMIT 1');
    $stmt->execute([$transactionId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : null;
}

/**
 * @return array<string, mixed>
 */
function kickback_config(): array
{
    global $config;
    $kb = is_array($config['kickback'] ?? null) ? $config['kickback'] : [];
    return [
        // キックバック報酬は廃止（付与しない）
        'enabled' => false,
        'amount_yen' => 0,
    ];
}

/**
 * 飲食店ユーザー（role=shop）を検証
 *
 * @return array<string, mixed>|null
 */
function kickback_find_shop_user(int $shopUserId): ?array
{
    if ($shopUserId <= 0) {
        return null;
    }
    $stmt = db()->prepare('SELECT * FROM users WHERE id = ? AND role = ? LIMIT 1');
    $stmt->execute([$shopUserId, 'shop']);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : null;
}

/**
 * 決済完了後：キックバック付与 ＋ 手数料調整 ＋ 請求起票
 *
 * @param array<string, mixed> $transaction
 * @return array{ok: bool, message: string, kickback_amount?: int, slip_id?: int}
 */
function kickback_process_on_payment_paid(array $transaction): array
{
    // キックバック報酬機能は廃止
    return ['ok' => true, 'message' => 'キックバックは無効です。', 'kickback_amount' => 0];
}

/**
 * 飲食店向け紹介料支払いを請求システムへ起票
 *
 * @param array<string, mixed> $transaction
 * @param array<string, mixed> $shopUser
 * @return array{ok: bool, slip_id?: int, message: string}
 */
function kickback_invoice_create_payable_entry(array $transaction, array $shopUser, int $amountYen): array
{
    $pdo = invoice_db();
    if (!$pdo instanceof PDO) {
        return ['ok' => false, 'message' => '請求システム連携が未設定です。'];
    }

    $transactionId = (int) ($transaction['id'] ?? 0);
    $rideRequestId = (int) ($transaction['ride_request_id'] ?? 0);
    $shopUserId = (int) ($shopUser['id'] ?? 0);
    if ($transactionId <= 0 || $amountYen <= 0 || $shopUserId <= 0) {
        return ['ok' => false, 'message' => '起票パラメータが不正です。'];
    }

    $cfg = invoice_config();
    $defaults = $cfg['defaults'] ?? [];
    $kbDefaults = $cfg['shop_kickback'] ?? [];
    $itemName = (string) ($kbDefaults['product_name'] ?? '飲食店への紹介料支払い（支払手数料）');
    $productCode = (string) ($kbDefaults['product_code'] ?? 'PORTAL-SHOP-KB');
    $slipPrefix = (string) ($kbDefaults['slip_prefix'] ?? 'K');
    $statusPaid = (int) ($cfg['status']['paid'] ?? 3);
    $kind = (int) ($kbDefaults['kind'] ?? 1);
    $taxRate = (float) ($defaults['tax_rate'] ?? 10.0);
    $taxType = (int) ($defaults['tax_type'] ?? 1);

    $shopName = trim((string) ($shopUser['shop_name'] ?? ''));
    if ($shopName === '') {
        $shopName = trim((string) ($shopUser['email'] ?? '飲食店提携'));
    }

    $pseudoCompany = [
        'id' => $shopUserId,
        'name' => $shopName,
        'cert_number' => 'SHOP-' . $shopUserId,
        'prefecture' => '',
        'city' => '',
        'tel' => null,
        'website' => null,
    ];

    $customerId = invoice_ensure_portal_customer($pdo, $pseudoCompany, $cfg);
    if ($customerId <= 0) {
        return ['ok' => false, 'message' => '飲食店の請求得意先登録に失敗しました。'];
    }

    $slipTable = invoice_table('sales_slip');
    $partsTable = invoice_table('sales_parts');
    $aliasTable = invoice_table('sales_slip_display_name');
    $bridgeTable = invoice_table('portal_shop_kickback_billings');

    $issueDate = date('Y-m-d');
    $sumPrice = $amountYen;
    $tax = (int) floor($sumPrice * $taxRate / (100 + $taxRate));
    $memo = sprintf(
        'PORTAL_SHOP_KICKBACK shop_user_id=%d txn=%d ride=%d',
        $shopUserId,
        $transactionId,
        $rideRequestId
    );

    try {
        $pdo->beginTransaction();

        $check = $pdo->prepare("SELECT sales_slip_id FROM {$bridgeTable} WHERE portal_transaction_id = ? LIMIT 1");
        $check->execute([$transactionId]);
        $existingSlip = $check->fetchColumn();
        if ($existingSlip) {
            $pdo->commit();
            return ['ok' => true, 'slip_id' => (int) $existingSlip, 'message' => '紹介料起票済みです。'];
        }

        $slipNumber = invoice_next_slip_number($pdo, $slipTable, $slipPrefix);
        $chargerId = (int) ($kbDefaults['charger_id'] ?? $defaults['charger_id'] ?? 1);
        $sectionId = (int) ($kbDefaults['section_id'] ?? $defaults['section_id'] ?? 1);

        $stmt = $pdo->prepare(
            "INSERT INTO {$slipTable}
             (customer_id, issue_date, slip_number, kind, status, charger_id, section_id, sum_price, tax, memo, created)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())"
        );
        $stmt->execute([
            $customerId,
            $issueDate,
            $slipNumber,
            $kind,
            $statusPaid,
            $chargerId,
            $sectionId,
            $sumPrice,
            $tax,
            $memo,
        ]);
        $slipId = (int) $pdo->lastInsertId();

        $stmtPart = $pdo->prepare(
            "INSERT INTO {$partsTable}
             (slip_id, product_code, product_name, quantity, unit_price, price, tax_type, tax_rate, unit_str, repair_id, created)
             VALUES (?, ?, ?, 1, ?, ?, ?, ?, '件', NULL, NOW())"
        );
        $stmtPart->execute([
            $slipId,
            $productCode,
            $itemName,
            $sumPrice,
            $sumPrice,
            $taxType,
            $taxRate,
        ]);

        $stmtAlias = $pdo->prepare(
            "INSERT INTO {$aliasTable} (slip_id, display_name, updated_at)
             VALUES (?, ?, NOW())
             ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), updated_at = NOW()"
        );
        $stmtAlias->execute([$slipId, $shopName . '（紹介料支払）']);

        $stmtBridge = $pdo->prepare(
            "INSERT INTO {$bridgeTable}
             (portal_transaction_id, portal_shop_user_id, ride_request_id, sales_slip_id, kickback_amount_yen)
             VALUES (?, ?, ?, ?, ?)"
        );
        $stmtBridge->execute([
            $transactionId,
            $shopUserId,
            $rideRequestId,
            $slipId,
            $amountYen,
        ]);

        $pdo->commit();

        return [
            'ok' => true,
            'slip_id' => $slipId,
            'message' => '飲食店紹介料を請求システムへ起票しました。',
        ];
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('kickback_invoice_create_payable_entry: ' . $e->getMessage());
        return ['ok' => false, 'message' => '紹介料の請求起票に失敗しました。'];
    }
}

/**
 * 飲食店ダッシュボード用サマリー
 *
 * @return array{referrals_this_month: int, kickback_balance: int, total_earned: int}
 */
function kickback_shop_dashboard_summary(int $shopUserId): array
{
    $shop = kickback_find_shop_user($shopUserId);
    if (!$shop) {
        return ['referrals_this_month' => 0, 'kickback_balance' => 0, 'total_earned' => 0];
    }

    $monthStart = date('Y-m-01 00:00:00');
    $stmt = db()->prepare(
        <<<SQL
SELECT COUNT(DISTINCT r.id) AS referral_count
FROM ride_requests r
INNER JOIN transactions t ON t.ride_request_id = r.id AND t.transaction_type = 'ride_fare' AND t.payment_status = 'paid'
WHERE r.referred_by_shop_id = ?
  AND r.created_at >= ?
SQL
    );
    $stmt->execute([$shopUserId, $monthStart]);
    $referrals = (int) ($stmt->fetchColumn() ?: 0);

    $stmtSum = db()->prepare(
        'SELECT COALESCE(SUM(amount_yen), 0) FROM shop_kickback_ledger WHERE shop_user_id = ?'
    );
    $stmtSum->execute([$shopUserId]);
    $totalEarned = (int) ($stmtSum->fetchColumn() ?: 0);

    return [
        'referrals_this_month' => $referrals,
        'kickback_balance' => (int) ($shop['kickback_balance'] ?? 0),
        'total_earned' => $totalEarned,
        'shop_name' => (string) ($shop['shop_name'] ?? ''),
    ];
}

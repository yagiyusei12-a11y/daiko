<?php
declare(strict_types=1);

require_once __DIR__ . '/invoice_db.php';
require_once __DIR__ . '/invoice_premium_sync.php';

/**
 * プレミアム申込 → 請求システムへ sales_slip（sales_entry 相当）を起票。
 *
 * @param array<string, mixed> $company
 * @param array<string, mixed> $user
 * @return array{ok: bool, slip_id?: int, message: string}
 */
function invoice_create_portal_premium_billing(array $company, array $user): array
{
    $pdo = invoice_db();
    if (!$pdo instanceof PDO) {
        return ['ok' => false, 'message' => '請求システム連携が未設定です（config.php の invoice.enabled）。'];
    }

    $cfg = invoice_config();
    $defaults = $cfg['defaults'] ?? [];
    $amount = (int) ($defaults['monthly_amount_yen'] ?? 3300);
    $itemName = (string) ($defaults['product_name'] ?? 'ポータルサイトプレミアム枠掲載料');
    $dueDays = max(1, (int) ($defaults['due_days'] ?? 14));
    $statusBilling = (int) ($cfg['status']['billing'] ?? 2);
    $kind = (int) ($defaults['kind'] ?? 1);
    $companyId = (int) ($company['id'] ?? 0);
    $companyName = trim((string) ($company['name'] ?? ''));
    $cert = trim((string) ($company['cert_number'] ?? ''));

    if ($companyId <= 0 || $companyName === '') {
        return ['ok' => false, 'message' => '業者情報が不正です。'];
    }

    $billingStatus = (string) ($company['premium_billing_status'] ?? 'none');
    if (in_array($billingStatus, ['pending', 'invoiced', 'paid'], true)) {
        return ['ok' => false, 'message' => '既にプレミアムのお申し込み・請求処理が進行中です。'];
    }

    $customerId = invoice_ensure_portal_customer($pdo, $company, $cfg);
    if ($customerId <= 0) {
        return ['ok' => false, 'message' => '請求システムへの得意先登録に失敗しました。'];
    }

    $issueDate = date('Y-m-d');
    $dueDate = date('Y-m-d', strtotime("+{$dueDays} days"));
    $taxRate = (float) ($defaults['tax_rate'] ?? 10.0);
    $taxType = (int) ($defaults['tax_type'] ?? 1);
    $sumPrice = $amount;
    $tax = (int) floor($sumPrice * $taxRate / (100 + $taxRate));
    $memo = sprintf(
        'PORTAL_PREMIUM company_id=%d cert=%s email=%s',
        $companyId,
        $cert,
        (string) ($user['email'] ?? '')
    );

    $slipTable = invoice_table('sales_slip');
    $partsTable = invoice_table('sales_parts');
    $aliasTable = invoice_table('sales_slip_display_name');
    $bridgeTable = invoice_table('portal_premium_billings');

    try {
        $pdo->beginTransaction();

        $slipNumber = invoice_next_slip_number($pdo, $slipTable, (string) ($defaults['slip_prefix'] ?? 'P'));
        $chargerId = (int) ($defaults['charger_id'] ?? 1);
        $sectionId = (int) ($defaults['section_id'] ?? 1);

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
            $statusBilling,
            $chargerId,
            $sectionId,
            $sumPrice,
            $tax,
            $memo,
        ]);
        $slipId = (int) $pdo->lastInsertId();
        $memoWithSlip = sprintf(
            'PORTAL_PREMIUM company_id=%d PORTAL_SLIP:%d cert=%s email=%s',
            $companyId,
            $slipId,
            $cert,
            (string) ($user['email'] ?? '')
        );
        $pdo->prepare("UPDATE {$slipTable} SET memo = ? WHERE id = ?")->execute([$memoWithSlip, $slipId]);

        $stmtPart = $pdo->prepare(
            "INSERT INTO {$partsTable}
             (slip_id, product_code, product_name, quantity, unit_price, price, tax_type, tax_rate, unit_str, repair_id, created)
             VALUES (?, ?, ?, 1, ?, ?, ?, ?, '月', NULL, NOW())"
        );
        $stmtPart->execute([
            $slipId,
            (string) ($defaults['product_code'] ?? 'PORTAL-PREMIUM'),
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
        $stmtAlias->execute([$slipId, $companyName]);

        $stmtBridge = $pdo->prepare(
            "INSERT INTO {$bridgeTable}
             (portal_company_id, portal_cert_number, company_name, sales_slip_id, amount_yen, item_name, billing_status, due_date)
             VALUES (?, ?, ?, ?, ?, ?, 'invoiced', ?)"
        );
        $stmtBridge->execute([
            $companyId,
            $cert,
            $companyName,
            $slipId,
            $sumPrice,
            $itemName,
            $dueDate,
        ]);

        $pdo->commit();

        $portalPdo = db();
        $portalPdo->prepare(
            'UPDATE companies SET
               premium_invoice_slip_id = ?,
               premium_billing_status = ?,
               premium_requested_at = NOW(),
               premium_due_date = ?,
               is_premium = 0
             WHERE id = ?'
        )->execute([$slipId, 'invoiced', $dueDate, $companyId]);

        return [
            'ok' => true,
            'slip_id' => $slipId,
            'message' => '請求データを起票しました。入金確認後、プレミアム掲載が自動で有効になります。',
        ];
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('invoice_create_portal_premium_billing: ' . $e->getMessage());
        return ['ok' => false, 'message' => '請求システムへの登録に失敗しました。管理者にお問い合わせください。'];
    }
}

/**
 * @param array<string, mixed> $company
 */
function invoice_ensure_portal_customer(PDO $pdo, array $company, array $cfg): int
{
    $custTable = invoice_table('m_customer');
    $defaults = $cfg['defaults'] ?? [];
    $cert = trim((string) ($company['cert_number'] ?? ''));
    $name = trim((string) ($company['name'] ?? ''));
    $code = 'PORTAL-' . ($cert !== '' ? preg_replace('/\s+/u', '', $cert) : (string) (int) $company['id']);

    $stmt = $pdo->prepare("SELECT id FROM {$custTable} WHERE code = ? LIMIT 1");
    $stmt->execute([$code]);
    $existing = $stmt->fetchColumn();
    if ($existing) {
        return (int) $existing;
    }

    $tel = trim((string) ($company['tel'] ?? ''));
    $addr = trim((string) ($company['address'] ?? ''));
    $pref = trim((string) ($company['prefecture'] ?? ''));
    $city = trim((string) ($company['city'] ?? ''));

    try {
        $stmt = $pdo->prepare(
            "INSERT INTO {$custTable} (code, name, tel, addr, created)
             VALUES (?, ?, ?, ?, NOW())"
        );
        $stmt->execute([$code, $name, $tel ?: null, trim("{$pref}{$city}{$addr}") ?: null]);
        return (int) $pdo->lastInsertId();
    } catch (Throwable $e) {
        error_log('invoice_ensure_portal_customer: ' . $e->getMessage());
        $fallbackId = (int) ($defaults['fallback_customer_id'] ?? 0);
        return $fallbackId;
    }
}

function invoice_next_slip_number(PDO $pdo, string $slipTable, string $prefix): string
{
    $today = date('Ymd');
    $pattern = $prefix . $today . '%';
    $stmt = $pdo->prepare(
        "SELECT slip_number FROM {$slipTable} WHERE slip_number LIKE ? ORDER BY slip_number DESC LIMIT 1"
    );
    $stmt->execute([$pattern]);
    $last = $stmt->fetchColumn();
    $seq = 1;
    if (is_string($last) && strlen($last) >= strlen($prefix) + 8 + 2) {
        $seq = (int) substr($last, -2) + 1;
    }
    return $prefix . $today . sprintf('%02d', $seq);
}

<?php
declare(strict_types=1);

require_once __DIR__ . '/invoice_db.php';

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
 * 入金・期限切れに応じて portal_premium_billings と companies を同期。
 *
 * @return array{updated: int, activated: int, deactivated: int, regenerated: bool}
 */
function invoice_sync_premium_statuses(): array
{
    $result = ['updated' => 0, 'activated' => 0, 'deactivated' => 0, 'regenerated' => false];

    $portalPdo = db();
    $invPdo = invoice_db();
    if (!$invPdo instanceof PDO) {
        return $result;
    }

    $cfg = invoice_config();
    $bridgeTable = invoice_table('portal_premium_billings');
    $slipTable = invoice_table('sales_slip');
    $payTable = invoice_table('pay_receipt');
    $paidMode = (string) ($cfg['paid_detection'] ?? 'bridge_and_payment');

    $rows = $portalPdo->query(
        "SELECT id, premium_invoice_slip_id, premium_billing_status, is_premium, premium_due_date
         FROM companies
         WHERE premium_invoice_slip_id IS NOT NULL
            OR premium_billing_status NOT IN ('none', '')
            OR is_premium = 1"
    )->fetchAll(PDO::FETCH_ASSOC);

    $anyPremiumChange = false;

    foreach ($rows as $row) {
        $companyId = (int) $row['id'];
        $slipId = (int) ($row['premium_invoice_slip_id'] ?? 0);
        $currentStatus = (string) ($row['premium_billing_status'] ?? 'none');
        $wasPremium = (int) ($row['is_premium'] ?? 0) === 1;

        if ($slipId <= 0) {
            continue;
        }

        $bridge = invoice_fetch_bridge_row($invPdo, $bridgeTable, $slipId, $companyId);
        $newBillingStatus = $bridge['billing_status'] ?? 'invoiced';
        $paidAt = $bridge['paid_at'] ?? null;

        if ($newBillingStatus === 'invoiced' && invoice_detect_payment_received($invPdo, $cfg, $slipId, $companyId, $paidMode)) {
            invoice_mark_bridge_paid($invPdo, $bridgeTable, $slipId, $companyId);
            $newBillingStatus = 'paid';
            $paidAt = date('Y-m-d H:i:s');
        }

        $dueDate = (string) ($bridge['due_date'] ?? $row['premium_due_date'] ?? '');
        if ($newBillingStatus === 'invoiced' && $dueDate !== '' && $dueDate < date('Y-m-d')) {
            $newBillingStatus = 'overdue';
            invoice_mark_bridge_overdue($invPdo, $bridgeTable, $slipId, $companyId);
        }

        if ($newBillingStatus === 'cancelled') {
            $shouldPremium = false;
            $portalBilling = 'cancelled';
        } elseif ($newBillingStatus === 'paid') {
            $shouldPremium = true;
            $portalBilling = 'paid';
        } else {
            $shouldPremium = false;
            $portalBilling = $newBillingStatus === 'overdue' ? 'overdue' : 'invoiced';
        }

        $shouldPremiumInt = $shouldPremium ? 1 : 0;
        if ($portalBilling !== $currentStatus || $shouldPremiumInt !== ($wasPremium ? 1 : 0)) {
            $portalPdo->prepare(
                'UPDATE companies SET
                   is_premium = ?,
                   premium_billing_status = ?,
                   premium_paid_at = CASE WHEN ? = 1 THEN COALESCE(premium_paid_at, NOW()) ELSE NULL END
                 WHERE id = ?'
            )->execute([$shouldPremiumInt, $portalBilling, $shouldPremiumInt, $companyId]);

            $result['updated']++;
            if ($shouldPremium && !$wasPremium) {
                $result['activated']++;
                $anyPremiumChange = true;
            }
            if (!$shouldPremium && $wasPremium) {
                $result['deactivated']++;
                $anyPremiumChange = true;
            }
        }
    }

    if ($anyPremiumChange) {
        $result['regenerated'] = portal_trigger_html_regeneration();
    }

    return $result;
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

/**
 * @return array<string, mixed>
 */
function invoice_fetch_bridge_row(PDO $pdo, string $bridgeTable, int $slipId, int $companyId): array
{
    $stmt = $pdo->prepare(
        "SELECT * FROM {$bridgeTable} WHERE sales_slip_id = ? AND portal_company_id = ? LIMIT 1"
    );
    $stmt->execute([$slipId, $companyId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : [];
}

function invoice_detect_payment_received(
    PDO $pdo,
    array $cfg,
    int $slipId,
    int $companyId,
    string $paidMode
): bool {
    if ($paidMode === 'bridge_only') {
        return false;
    }

    $slipTable = invoice_table('sales_slip');
    $payTable = invoice_table('pay_receipt');
    $stmt = $pdo->prepare(
        "SELECT customer_id, sum_price, issue_date, memo FROM {$slipTable} WHERE id = ? LIMIT 1"
    );
    $stmt->execute([$slipId]);
    $slip = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$slip) {
        return false;
    }

    $customerId = (int) ($slip['customer_id'] ?? 0);
    $sumPrice = (float) ($slip['sum_price'] ?? 0);
    $issueDate = (string) ($slip['issue_date'] ?? '');
    if ($customerId <= 0 || $sumPrice <= 0) {
        return false;
    }

    $memoNeedle = sprintf('PORTAL_PREMIUM company_id=%d', $companyId);
    if (str_contains((string) ($slip['memo'] ?? ''), $memoNeedle)) {
        $stmtPay = $pdo->prepare(
            "SELECT COALESCE(SUM(price), 0) AS paid_sum
             FROM {$payTable}
             WHERE target_id = ? AND deleted IS NULL
               AND target_date >= ?
               AND (memo LIKE ? OR memo LIKE ?)"
        );
        $stmtPay->execute([
            $customerId,
            $issueDate,
            '%' . $memoNeedle . '%',
            '%PORTAL_SLIP:' . $slipId . '%',
        ]);
        $paidSum = (float) $stmtPay->fetchColumn();
        if ($paidSum >= $sumPrice) {
            return true;
        }
    }

    $stmtPay2 = $pdo->prepare(
        "SELECT COALESCE(SUM(price), 0) FROM {$payTable}
         WHERE target_id = ? AND deleted IS NULL AND target_date >= ? AND price >= ?"
    );
    $stmtPay2->execute([$customerId, $issueDate, $sumPrice]);
    return (float) $stmtPay2->fetchColumn() >= $sumPrice;
}

function invoice_mark_bridge_paid(PDO $pdo, string $bridgeTable, int $slipId, int $companyId): void
{
    $pdo->prepare(
        "UPDATE {$bridgeTable} SET billing_status = 'paid', paid_at = NOW() WHERE sales_slip_id = ? AND portal_company_id = ?"
    )->execute([$slipId, $companyId]);
}

function invoice_mark_bridge_overdue(PDO $pdo, string $bridgeTable, int $slipId, int $companyId): void
{
    $pdo->prepare(
        "UPDATE {$bridgeTable} SET billing_status = 'overdue' WHERE sales_slip_id = ? AND portal_company_id = ? AND billing_status = 'invoiced'"
    )->execute([$slipId, $companyId]);
}

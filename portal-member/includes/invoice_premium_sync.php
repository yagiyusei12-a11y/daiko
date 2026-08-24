<?php
declare(strict_types=1);

/**
 * プレミアム課金同期（入金マッチは伝票固有根拠のみ）。
 */

/**
 * @param array<string, mixed> $options
 * @return array<string, mixed>
 */
function invoice_sync_premium_statuses(array $options = []): array
{
    $result = [
        'updated' => 0,
        'activated' => 0,
        'deactivated' => 0,
        'regenerated' => false,
        'portal_updates' => 0,
        'invoice_updates' => 0,
        'regen_launches' => 0,
        'candidates' => [],
        'error' => null,
    ];
    $dryRun = !empty($options['dry_run']);
    $today = (string) ($options['today'] ?? date('Y-m-d'));

    try {
        $invPdo = $options['invoice_pdo'] ?? invoice_db();
        $hasLoaders = isset($options['companies'], $options['fetch_bridge'], $options['detect_payment']);
        if (!$hasLoaders && !$invPdo instanceof PDO) {
            return $result;
        }

        $cfg = $options['cfg'] ?? invoice_config();
        $bridgeTable = invoice_table('portal_premium_billings');
        $paidMode = (string) ($cfg['paid_detection'] ?? 'bridge_and_payment');

        if (isset($options['companies']) && is_array($options['companies'])) {
            $rows = $options['companies'];
        } else {
            $portalPdo = $options['portal_pdo'] ?? db();
            $rows = $portalPdo->query(
                "SELECT id, premium_invoice_slip_id, premium_billing_status, is_premium, premium_due_date
                 FROM companies
                 WHERE premium_invoice_slip_id IS NOT NULL
                    OR premium_billing_status NOT IN ('none', '')
                    OR is_premium = 1"
            )->fetchAll(PDO::FETCH_ASSOC);
        }
    } catch (Throwable $e) {
        error_log('invoice_sync_premium_statuses query failed: ' . $e->getMessage());
        $result['error'] = 'db_error';
        return $result;
    }

    $anyPremiumChange = false;
    $portalPdo = $options['portal_pdo'] ?? null;

    foreach ($rows as $row) {
        $companyId = (int) ($row['id'] ?? 0);
        $slipId = (int) ($row['premium_invoice_slip_id'] ?? 0);
        $currentStatus = (string) ($row['premium_billing_status'] ?? 'none');
        $wasPremium = (int) ($row['is_premium'] ?? 0) === 1;
        $candidate = [
            'company_id' => $companyId,
            'current_premium' => $wasPremium ? 1 : 0,
            'slip_id' => $slipId > 0 ? $slipId : null,
            'detected_billing' => $currentStatus,
            'proposed_action' => 'unchanged',
            'match_evidence' => '',
            'skip_reason' => '',
        ];

        if ($companyId <= 0) {
            $candidate['skip_reason'] = 'invalid_company';
            $result['candidates'][] = $candidate;
            continue;
        }

        if ($slipId <= 0) {
            $candidate['skip_reason'] = 'no_slip_manual_or_unbilled';
            $result['candidates'][] = $candidate;
            continue;
        }

        try {
            if (isset($options['fetch_bridge']) && is_callable($options['fetch_bridge'])) {
                $bridgeState = $options['fetch_bridge']($slipId, $companyId);
            } else {
                $bridgeState = invoice_fetch_bridge_state($invPdo, $bridgeTable, $slipId, $companyId);
            }
        } catch (Throwable $e) {
            error_log('invoice_sync_premium_statuses bridge: ' . $e->getMessage());
            $candidate['skip_reason'] = 'db_error';
            $candidate['detected_billing'] = 'ERROR';
            $result['candidates'][] = $candidate;
            continue;
        }

        if (($bridgeState['status'] ?? '') !== 'ok') {
            $candidate['skip_reason'] = (string) ($bridgeState['status'] ?? 'bridge_error');
            $candidate['detected_billing'] = 'UNKNOWN';
            $result['candidates'][] = $candidate;
            continue;
        }

        $bridge = is_array($bridgeState['row'] ?? null) ? $bridgeState['row'] : [];
        try {
            if (isset($options['detect_payment']) && is_callable($options['detect_payment'])) {
                $paymentResult = $options['detect_payment']($slipId, $companyId, $paidMode, $bridge);
            } elseif ($invPdo instanceof PDO) {
                $paymentResult = invoice_detect_payment_received($invPdo, $cfg, $slipId, $companyId, $paidMode);
            } else {
                $paymentResult = [
                    'status' => 'skip',
                    'paid' => false,
                    'evidence' => '',
                    'reason' => 'no_invoice_db',
                ];
            }
        } catch (Throwable $e) {
            error_log('invoice_sync_premium_statuses payment: ' . $e->getMessage());
            $paymentResult = [
                'status' => 'error',
                'paid' => false,
                'evidence' => '',
                'reason' => 'db_error',
            ];
        }

        $decision = invoice_decide_premium_sync_action($row, $bridge, $paymentResult, $today);
        $candidate['detected_billing'] = $decision['detected_billing'];
        $candidate['proposed_action'] = $decision['action'];
        $candidate['match_evidence'] = $decision['evidence'];
        $candidate['skip_reason'] = $decision['skip_reason'];
        $result['candidates'][] = $candidate;

        if ($decision['action'] === 'unchanged') {
            continue;
        }

        if (!$dryRun) {
            if ($decision['mark_bridge_paid']) {
                if (isset($options['on_bridge_update']) && is_callable($options['on_bridge_update'])) {
                    $options['on_bridge_update']('paid', $slipId, $companyId);
                } elseif ($invPdo instanceof PDO) {
                    invoice_mark_bridge_paid($invPdo, $bridgeTable, $slipId, $companyId);
                }
                $result['invoice_updates']++;
            }
            if ($decision['mark_bridge_overdue']) {
                if (isset($options['on_bridge_update']) && is_callable($options['on_bridge_update'])) {
                    $options['on_bridge_update']('overdue', $slipId, $companyId);
                } elseif ($invPdo instanceof PDO) {
                    invoice_mark_bridge_overdue($invPdo, $bridgeTable, $slipId, $companyId);
                }
                $result['invoice_updates']++;
            }

            $shouldPremiumInt = (int) $decision['new_premium'];
            $portalBilling = (string) $decision['new_billing_status'];
            if (isset($options['on_portal_update']) && is_callable($options['on_portal_update'])) {
                $options['on_portal_update']($companyId, $shouldPremiumInt, $portalBilling);
            } else {
                if (!$portalPdo instanceof PDO) {
                    $portalPdo = $options['portal_pdo'] ?? db();
                }
                $portalPdo->prepare(
                    'UPDATE companies SET
                       is_premium = ?,
                       premium_billing_status = ?,
                       premium_paid_at = CASE WHEN ? = 1 THEN COALESCE(premium_paid_at, NOW()) ELSE NULL END
                     WHERE id = ?'
                )->execute([$shouldPremiumInt, $portalBilling, $shouldPremiumInt, $companyId]);
            }
            $result['portal_updates']++;
        }

        $result['updated']++;
        if ((int) $decision['new_premium'] === 1 && !$wasPremium) {
            $result['activated']++;
            $anyPremiumChange = true;
        }
        if ((int) $decision['new_premium'] === 0 && $wasPremium) {
            $result['deactivated']++;
            $anyPremiumChange = true;
        }
    }

    if ($anyPremiumChange && !$dryRun) {
        if (isset($options['trigger_regen']) && is_callable($options['trigger_regen'])) {
            $launched = (bool) $options['trigger_regen']();
        } else {
            $launched = portal_trigger_html_regeneration();
        }
        $result['regenerated'] = $launched;
        if ($launched) {
            $result['regen_launches']++;
        }
    }

    return $result;
}

/**
 * @param array<string, mixed> $company
 * @param array<string, mixed> $bridge
 * @param array<string, mixed> $paymentResult
 * @return array<string, mixed>
 */
function invoice_decide_premium_sync_action(
    array $company,
    array $bridge,
    array $paymentResult,
    string $today
): array {
    $wasPremium = (int) ($company['is_premium'] ?? 0) === 1;
    $currentStatus = (string) ($company['premium_billing_status'] ?? 'none');
    $base = [
        'action' => 'unchanged',
        'skip_reason' => '',
        'new_premium' => $wasPremium ? 1 : 0,
        'new_billing_status' => $currentStatus,
        'detected_billing' => (string) ($bridge['billing_status'] ?? 'UNKNOWN'),
        'evidence' => (string) ($paymentResult['evidence'] ?? ''),
        'mark_bridge_paid' => false,
        'mark_bridge_overdue' => false,
    ];

    $payStatus = (string) ($paymentResult['status'] ?? 'unmatched');
    if (in_array($payStatus, ['error', 'ambiguous'], true)) {
        $base['skip_reason'] = $payStatus === 'error' ? 'db_error' : 'ambiguous_match';
        $base['detected_billing'] = $payStatus === 'error' ? 'ERROR' : 'AMBIGUOUS';
        return $base;
    }

    $bridgeStatus = (string) ($bridge['billing_status'] ?? '');
    $dueDate = (string) ($bridge['due_date'] ?? '');
    $paidByBridge = $bridgeStatus === 'paid';
    $paidByPayment = $payStatus === 'paid';

    if ($paidByBridge || $paidByPayment) {
        $base['detected_billing'] = 'paid';
        $base['new_premium'] = 1;
        $base['new_billing_status'] = 'paid';
        $base['mark_bridge_paid'] = !$paidByBridge && $paidByPayment;
        if ($base['evidence'] === '') {
            $base['evidence'] = $paidByBridge ? 'bridge.billing_status=paid' : (string) ($paymentResult['evidence'] ?? '');
        }
        if ($wasPremium && $currentStatus === 'paid' && !$base['mark_bridge_paid']) {
            $base['action'] = 'unchanged';
            $base['skip_reason'] = 'already_paid';
            return $base;
        }
        $base['action'] = $wasPremium ? 'update_status' : 'activate';
        return $base;
    }

    if ($bridgeStatus === 'cancelled') {
        $base['detected_billing'] = 'cancelled';
        $base['evidence'] = 'bridge.billing_status=cancelled';
        $base['new_premium'] = 0;
        $base['new_billing_status'] = 'cancelled';
        if (!$wasPremium && $currentStatus === 'cancelled') {
            $base['action'] = 'unchanged';
            $base['skip_reason'] = 'already_cancelled';
            return $base;
        }
        $base['action'] = $wasPremium ? 'deactivate' : 'update_status';
        return $base;
    }

    $isOverdue = $bridgeStatus === 'overdue'
        || ($bridgeStatus === 'invoiced' && $dueDate !== '' && $dueDate < $today);
    if ($isOverdue) {
        $base['detected_billing'] = 'overdue';
        $base['evidence'] = $bridgeStatus === 'overdue' ? 'bridge.billing_status=overdue' : 'bridge.due_date';
        $base['new_premium'] = 0;
        $base['new_billing_status'] = 'overdue';
        $base['mark_bridge_overdue'] = $bridgeStatus === 'invoiced';
        if (!$wasPremium && $currentStatus === 'overdue' && !$base['mark_bridge_overdue']) {
            $base['action'] = 'unchanged';
            $base['skip_reason'] = 'already_overdue';
            return $base;
        }
        $base['action'] = $wasPremium ? 'deactivate' : 'update_status';
        return $base;
    }

    $base['detected_billing'] = $bridgeStatus !== '' ? $bridgeStatus : 'invoiced';
    $base['skip_reason'] = $payStatus === 'skip' ? 'payment_skip' : 'no_unique_slip_evidence';
    if ($base['evidence'] === '') {
        $base['evidence'] = (string) ($paymentResult['reason'] ?? $base['skip_reason']);
    }
    return $base;
}

/**
 * @return array{status: string, row?: array<string, mixed>, reason?: string}
 */
function invoice_fetch_bridge_state(PDO $pdo, string $bridgeTable, int $slipId, int $companyId): array
{
    $stmt = $pdo->prepare("SELECT * FROM {$bridgeTable} WHERE sales_slip_id = ?");
    $stmt->execute([$slipId]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    if (!is_array($rows)) {
        return ['status' => 'db_error', 'reason' => 'bridge_fetch_failed'];
    }
    if (count($rows) === 0) {
        return ['status' => 'bridge_missing', 'reason' => 'bridge_row_absent'];
    }
    if (count($rows) > 1) {
        return ['status' => 'ambiguous_duplicate_bridge', 'reason' => 'duplicate_sales_slip_id'];
    }
    $row = $rows[0];
    if ((int) ($row['portal_company_id'] ?? 0) !== $companyId) {
        return ['status' => 'ambiguous_duplicate_bridge', 'reason' => 'slip_company_mismatch'];
    }
    return ['status' => 'ok', 'row' => $row];
}

/**
 * @return array<string, mixed>
 */
function invoice_fetch_bridge_row(PDO $pdo, string $bridgeTable, int $slipId, int $companyId): array
{
    $state = invoice_fetch_bridge_state($pdo, $bridgeTable, $slipId, $companyId);
    return ($state['status'] ?? '') === 'ok' && isset($state['row']) ? $state['row'] : [];
}

function invoice_memo_has_portal_slip_marker(string $memo, int $slipId): bool
{
    if ($slipId <= 0) {
        return false;
    }
    $quoted = preg_quote((string) $slipId, '/');
    return preg_match('/PORTAL_SLIP:' . $quoted . '(?!\d)/', $memo) === 1;
}

/**
 * 伝票固有根拠のみで paid を判定する（customer+amount は使わない）。
 *
 * @param array<string, mixed> $slip
 * @param list<array<string, mixed>> $receipts
 * @return array{status: string, paid: bool, evidence: string, reason: string}
 */
function invoice_evaluate_slip_payment(
    array $slip,
    array $receipts,
    int $slipId,
    int $companyId,
    string $paidMode,
    int $paidStatusCode
): array {
    unset($companyId);
    $empty = [
        'status' => 'unmatched',
        'paid' => false,
        'evidence' => '',
        'reason' => 'unmatched',
    ];
    if ($paidMode === 'bridge_only') {
        return [
            'status' => 'skip',
            'paid' => false,
            'evidence' => '',
            'reason' => 'bridge_only',
        ];
    }
    if ($slipId <= 0 || $slip === []) {
        $empty['reason'] = 'slip_missing';
        return $empty;
    }

    $slipStatus = (int) ($slip['status'] ?? 0);
    if ($paidStatusCode > 0 && $slipStatus === $paidStatusCode) {
        return [
            'status' => 'paid',
            'paid' => true,
            'evidence' => 'sales_slip.id=' . $slipId . ';status=paid',
            'reason' => '',
        ];
    }

    $sumPrice = (float) ($slip['sum_price'] ?? 0);
    $paidSum = 0.0;
    $matchedReceipts = 0;
    foreach ($receipts as $receipt) {
        $memo = (string) ($receipt['memo'] ?? '');
        if (!invoice_memo_has_portal_slip_marker($memo, $slipId)) {
            continue;
        }
        $matchedReceipts++;
        $paidSum += (float) ($receipt['price'] ?? 0);
    }

    if ($matchedReceipts === 0) {
        $empty['reason'] = 'no_unique_slip_marker';
        return $empty;
    }
    if ($sumPrice > 0 && $paidSum >= $sumPrice) {
        return [
            'status' => 'paid',
            'paid' => true,
            'evidence' => 'PORTAL_SLIP:' . $slipId,
            'reason' => '',
        ];
    }

    $empty['reason'] = 'partial_or_insufficient';
    $empty['evidence'] = 'PORTAL_SLIP:' . $slipId;
    return $empty;
}

/**
 * @return array{status: string, paid: bool, evidence: string, reason: string}
 */
function invoice_detect_payment_received(
    PDO $pdo,
    array $cfg,
    int $slipId,
    int $companyId,
    string $paidMode
): array {
    if ($paidMode === 'bridge_only') {
        return invoice_evaluate_slip_payment([], [], $slipId, $companyId, $paidMode, 0);
    }

    try {
        $slipTable = invoice_table('sales_slip');
        $payTable = invoice_table('pay_receipt');
        $stmt = $pdo->prepare(
            "SELECT id, status, sum_price, memo FROM {$slipTable} WHERE id = ? LIMIT 1"
        );
        $stmt->execute([$slipId]);
        $slip = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!is_array($slip)) {
            return invoice_evaluate_slip_payment([], [], $slipId, $companyId, $paidMode, 0);
        }

        $paidStatusCode = (int) ($cfg['status']['paid'] ?? 3);
        $marker = 'PORTAL_SLIP:' . $slipId;
        $stmtPay = $pdo->prepare(
            "SELECT id, price, memo FROM {$payTable}
             WHERE deleted IS NULL AND memo LIKE ?"
        );
        $stmtPay->execute(['%' . $marker . '%']);
        $receipts = $stmtPay->fetchAll(PDO::FETCH_ASSOC);
        if (!is_array($receipts)) {
            return [
                'status' => 'error',
                'paid' => false,
                'evidence' => '',
                'reason' => 'db_error',
            ];
        }

        return invoice_evaluate_slip_payment(
            $slip,
            $receipts,
            $slipId,
            $companyId,
            $paidMode,
            $paidStatusCode
        );
    } catch (Throwable $e) {
        error_log('invoice_detect_payment_received: ' . $e->getMessage());
        return [
            'status' => 'error',
            'paid' => false,
            'evidence' => '',
            'reason' => 'db_error',
        ];
    }
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

<?php
declare(strict_types=1);

require_once __DIR__ . '/invoice_billing.php';
require_once __DIR__ . '/ride_dispatch.php';
require_once __DIR__ . '/surge_pricing.php';
require_once __DIR__ . '/coupons.php';

/**
 * @return array<string, mixed>
 */
function payment_config(): array
{
    global $config;
    $stripe = is_array($config['stripe'] ?? null) ? $config['stripe'] : [];
    return [
        'mock_mode' => !empty($stripe['mock_mode']),
        'publishable_key' => trim((string) ($stripe['publishable_key'] ?? '')),
        'secret_key' => trim((string) ($stripe['secret_key'] ?? '')),
        'webhook_secret' => trim((string) ($stripe['webhook_secret'] ?? '')),
        'mock_webhook_token' => trim((string) ($stripe['mock_webhook_token'] ?? 'dev_portal_payment_mock')),
        'default_amount_yen' => max(100, (int) ($stripe['default_amount_yen'] ?? 3000)),
        'currency' => (string) ($stripe['currency'] ?? 'jpy'),
    ];
}

function payment_calculate_fees(int $totalAmount, float $commissionRate): array
{
    $totalAmount = max(0, $totalAmount);
    $rate = max(0.0, min(100.0, $commissionRate));
    $platformFee = (int) round($totalAmount * $rate / 100);
    if ($platformFee > $totalAmount) {
        $platformFee = $totalAmount;
    }
    $agencyAmount = $totalAmount - $platformFee;
    return [
        'platform_fee' => $platformFee,
        'agency_amount' => $agencyAmount,
        'commission_rate' => $rate,
    ];
}

/**
 * @return array<string, mixed>|null
 */
function payment_find_transaction_by_ride(int $rideRequestId, string $transactionType = 'ride_fare'): ?array
{
    $stmt = db()->prepare(
        'SELECT * FROM transactions WHERE ride_request_id = ? AND transaction_type = ? LIMIT 1'
    );
    $stmt->execute([$rideRequestId, $transactionType]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : null;
}

/**
 * @return array<string, mixed>|null
 */
function payment_find_transaction_by_id(int $transactionId): ?array
{
    $stmt = db()->prepare('SELECT * FROM transactions WHERE id = ? LIMIT 1');
    $stmt->execute([$transactionId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : null;
}

function payment_estimate_amount_for_company(int $companyId): int
{
    $cfg = payment_config();
    $price = find_price_by_company_id($companyId);
    if (is_array($price) && !empty($price['base_price'])) {
        return max(100, (int) $price['base_price']);
    }
    return (int) $cfg['default_amount_yen'];
}

/**
 * @return array{ok: bool, message: string, transaction_id?: int, client_secret?: string, publishable_key?: string, mock_mode?: bool, amount?: int}
 */
function payment_create_checkout(int $rideRequestId): array
{
    $request = ride_fetch_request_by_id($rideRequestId);
    if (!$request) {
        return ['ok' => false, 'message' => '配車リクエストが見つかりません。'];
    }
    if ((string) ($request['status'] ?? '') !== 'accepted') {
        return ['ok' => false, 'message' => 'マッチング完了後に決済できます。'];
    }

    $companyId = (int) ($request['accepted_company_id'] ?? 0);
    if ($companyId <= 0) {
        return ['ok' => false, 'message' => '受注業者が確定していません。'];
    }

    $existing = payment_find_transaction_by_ride($rideRequestId);
    if ($existing && (string) ($existing['payment_status'] ?? '') === 'paid') {
        return ['ok' => false, 'message' => 'この案件は決済済みです。'];
    }

    $stmt = db()->prepare('SELECT commission_rate FROM companies WHERE id = ? LIMIT 1');
    $stmt->execute([$companyId]);
    $rate = (float) ($stmt->fetchColumn() ?: 10.0);
    $baseAmount = payment_estimate_amount_for_company($companyId);
    $surgePayload = surge_calculate_multiplier(
        (string) ($request['prefecture'] ?? ''),
        (string) ($request['city_name'] ?? ''),
        ride_parse_coordinate($request['pickup_lat'] ?? null),
        ride_parse_coordinate($request['pickup_lng'] ?? null),
    );
    $surgeMultiplier = (float) ($surgePayload['surge_multiplier'] ?? 1.0);
    $grossAmount = surge_apply_to_amount($baseAmount, $surgeMultiplier);
    $couponDiscount = coupon_discount_for_ride($request);
    $totalAmount = max(100, $grossAmount - $couponDiscount);
    $fees = payment_calculate_fees($totalAmount, $rate);

    $pdo = db();
    if ($existing) {
        $pdo->prepare(
            <<<SQL
UPDATE transactions
SET base_amount = ?, surge_multiplier = ?, total_amount = ?, coupon_discount = ?, platform_fee = ?, agency_amount = ?, commission_rate = ?,
    payment_status = 'pending', stripe_payment_intent_id = NULL, stripe_charge_id = NULL, paid_at = NULL
WHERE id = ? AND payment_status = 'pending'
SQL
        )->execute([
            $baseAmount,
            $surgeMultiplier,
            $totalAmount,
            $couponDiscount,
            $fees['platform_fee'],
            $fees['agency_amount'],
            $fees['commission_rate'],
            (int) $existing['id'],
        ]);
        $transactionId = (int) $existing['id'];
    } else {
        $ins = $pdo->prepare(
            <<<SQL
INSERT INTO transactions
  (ride_request_id, company_id, transaction_type, base_amount, surge_multiplier, total_amount, coupon_discount, platform_fee, agency_amount, commission_rate, payment_status)
VALUES (?, ?, 'ride_fare', ?, ?, ?, ?, ?, ?, ?, 'pending')
SQL
        );
        $ins->execute([
            $rideRequestId,
            $companyId,
            $baseAmount,
            $surgeMultiplier,
            $totalAmount,
            $fees['platform_fee'],
            $fees['agency_amount'],
            $fees['commission_rate'],
        ]);
        $transactionId = (int) $pdo->lastInsertId();
    }

    $cfg = payment_config();
    $intentId = 'pi_mock_' . $transactionId . '_' . bin2hex(random_bytes(4));
    $clientSecret = 'cs_mock_' . $transactionId . '_' . bin2hex(random_bytes(8));

    if (!$cfg['mock_mode'] && $cfg['secret_key'] !== '') {
        $stripeResult = payment_stripe_create_intent($transactionId, $totalAmount, $cfg);
        if (!$stripeResult['ok']) {
            return $stripeResult;
        }
        $intentId = (string) ($stripeResult['payment_intent_id'] ?? $intentId);
        $clientSecret = (string) ($stripeResult['client_secret'] ?? $clientSecret);
    }

    $pdo->prepare('UPDATE transactions SET stripe_payment_intent_id = ? WHERE id = ?')
        ->execute([$intentId, $transactionId]);

    return [
        'ok' => true,
        'message' => '決済を開始できます。',
        'transaction_id' => $transactionId,
        'amount' => $totalAmount,
        'gross_amount' => $grossAmount,
        'coupon_discount' => $couponDiscount,
        'base_amount' => $baseAmount,
        'surge_multiplier' => $surgeMultiplier,
        'surge' => $surgePayload,
        'client_secret' => $clientSecret,
        'publishable_key' => $cfg['publishable_key'] !== '' ? $cfg['publishable_key'] : 'pk_test_mock',
        'mock_mode' => (bool) $cfg['mock_mode'],
    ];
}

/**
 * @param array<string, mixed> $cfg
 * @return array{ok: bool, message: string, payment_intent_id?: string, client_secret?: string}
 */
function payment_stripe_create_intent(int $transactionId, int $amountYen, array $cfg): array
{
    $secret = (string) ($cfg['secret_key'] ?? '');
    if ($secret === '') {
        return ['ok' => false, 'message' => 'Stripe secret key が未設定です。'];
    }

    $payload = http_build_query([
        'amount' => $amountYen,
        'currency' => strtolower((string) ($cfg['currency'] ?? 'jpy')),
        'automatic_payment_methods[enabled]' => 'true',
        'metadata[transaction_id]' => (string) $transactionId,
    ]);

    $ch = curl_init('https://api.stripe.com/v1/payment_intents');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_USERPWD => $secret . ':',
        CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded'],
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_TIMEOUT => 20,
    ]);
    $response = curl_exec($ch);
    $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode < 200 || $httpCode >= 300 || !is_string($response)) {
        error_log('Stripe PaymentIntent failed HTTP ' . $httpCode . ' body=' . (string) $response);
        return ['ok' => false, 'message' => '決済の準備に失敗しました。'];
    }

    try {
        $data = json_decode($response, true, 512, JSON_THROW_ON_ERROR);
    } catch (Throwable) {
        return ['ok' => false, 'message' => '決済レスポンスの解析に失敗しました。'];
    }

    return [
        'ok' => true,
        'message' => 'ok',
        'payment_intent_id' => (string) ($data['id'] ?? ''),
        'client_secret' => (string) ($data['client_secret'] ?? ''),
    ];
}

/**
 * Webhook / モック完了時の本処理。
 *
 * @return array{ok: bool, message: string, slip_id?: int}
 */
function payment_mark_paid(int $transactionId, string $stripeChargeId, string $stripeIntentId = ''): array
{
    $txn = payment_find_transaction_by_id($transactionId);
    if (!$txn) {
        return ['ok' => false, 'message' => '取引が見つかりません。'];
    }
    if ((string) ($txn['payment_status'] ?? '') === 'paid') {
        return ['ok' => true, 'message' => '既に決済済みです。', 'slip_id' => (int) ($txn['invoice_slip_id'] ?? 0) ?: null];
    }

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $chargeId = $stripeChargeId !== '' ? $stripeChargeId : ('mock_ch_' . $transactionId);
        $intentId = $stripeIntentId !== '' ? $stripeIntentId : (string) ($txn['stripe_payment_intent_id'] ?? '');

        $upd = $pdo->prepare(
            <<<SQL
UPDATE transactions
SET payment_status = 'paid',
    stripe_charge_id = ?,
    stripe_payment_intent_id = COALESCE(NULLIF(?, ''), stripe_payment_intent_id),
    paid_at = NOW()
WHERE id = ? AND payment_status = 'pending'
SQL
        );
        $upd->execute([$chargeId, $intentId, $transactionId]);
        if ($upd->rowCount() === 0) {
            $pdo->rollBack();
            return ['ok' => false, 'message' => '決済状態の更新に失敗しました。'];
        }

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('payment_mark_paid: ' . $e->getMessage());
        return ['ok' => false, 'message' => '決済処理に失敗しました。'];
    }

    $txnFresh = payment_find_transaction_by_id($transactionId);
    if (!$txnFresh) {
        return ['ok' => false, 'message' => '取引の再読込に失敗しました。'];
    }

    $rideRequestId = (int) ($txnFresh['ride_request_id'] ?? 0);
    if ($rideRequestId > 0 && (string) ($txnFresh['transaction_type'] ?? 'ride_fare') === 'ride_fare') {
        payment_attach_stripe_method_from_intent($rideRequestId, $intentId);
    }

    $request = ride_fetch_request_by_id($rideRequestId);
    $couponId = (int) ($request['coupon_id'] ?? 0);
    if ($couponId > 0) {
        coupon_mark_used_for_ride($rideRequestId, $couponId);
    }

    require_once __DIR__ . '/kickback.php';
    $kickbackResult = kickback_process_on_payment_paid($txnFresh);
    $txnFresh = payment_find_transaction_by_id($transactionId) ?: $txnFresh;

    $invoiceResult = invoice_create_ride_platform_fee_entry($txnFresh, $chargeId);
    if ($invoiceResult['ok'] && !empty($invoiceResult['slip_id'])) {
        db()->prepare('UPDATE transactions SET invoice_slip_id = ? WHERE id = ?')
            ->execute([(int) $invoiceResult['slip_id'], $transactionId]);
    }

    return [
        'ok' => true,
        'message' => '決済を完了しました。',
        'slip_id' => $invoiceResult['slip_id'] ?? null,
        'invoice_ok' => $invoiceResult['ok'],
        'invoice_message' => $invoiceResult['message'] ?? '',
        'kickback_ok' => $kickbackResult['ok'] ?? false,
        'kickback_amount' => $kickbackResult['kickback_amount'] ?? 0,
    ];
}

/**
 * PaymentIntent 完了後に Stripe Customer / PM を ride_requests へ保存。
 */
function payment_attach_stripe_method_from_intent(int $rideRequestId, string $paymentIntentId): void
{
    if ($rideRequestId <= 0 || $paymentIntentId === '') {
        return;
    }
    $cfg = payment_config();
    if ($cfg['mock_mode'] || str_starts_with($paymentIntentId, 'pi_mock_')) {
        ride_save_stripe_payment_method(
            $rideRequestId,
            'cus_mock_' . $rideRequestId,
            'pm_mock_' . $rideRequestId
        );
        return;
    }
    $secret = (string) ($cfg['secret_key'] ?? '');
    if ($secret === '') {
        return;
    }
    $ch = curl_init('https://api.stripe.com/v1/payment_intents/' . rawurlencode($paymentIntentId));
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_USERPWD => $secret . ':',
        CURLOPT_TIMEOUT => 15,
    ]);
    $response = curl_exec($ch);
    curl_close($ch);
    if (!is_string($response)) {
        return;
    }
    try {
        $data = json_decode($response, true, 512, JSON_THROW_ON_ERROR);
    } catch (Throwable) {
        return;
    }
    $customerId = (string) ($data['customer'] ?? '');
    $pmId = (string) ($data['payment_method'] ?? '');
    if ($customerId !== '' || $pmId !== '') {
        ride_save_stripe_payment_method($rideRequestId, $customerId, $pmId);
    }
}

/**
 * キャンセル料の即時課金（Stripe / モック）。
 *
 * @param array<string, mixed> $request
 * @return array{ok: bool, message: string, transaction_id?: int, stripe_charge_id?: string, agency_amount?: int}
 */
function payment_charge_cancellation_fee(array $request, ?string $overridePaymentMethodId = null): array
{
    $rideRequestId = (int) ($request['id'] ?? 0);
    $companyId = (int) ($request['accepted_company_id'] ?? 0);
    if ($rideRequestId <= 0 || $companyId <= 0) {
        return ['ok' => false, 'message' => '案件情報が不正です。'];
    }

    $existing = payment_find_transaction_by_ride($rideRequestId, 'cancellation_fee');
    if ($existing && (string) ($existing['payment_status'] ?? '') === 'paid') {
        return ['ok' => true, 'message' => 'キャンセル料は既に決済済みです。', 'agency_amount' => (int) ($existing['agency_amount'] ?? 0)];
    }

    $payCfg = payment_config();
    $cfg = cancellation_config();
    $total = $cfg['fee_yen'];
    $platformFee = $cfg['platform_fee_yen'];
    $agencyAmount = $cfg['agency_compensation_yen'];
    if ($platformFee + $agencyAmount !== $total && $total > 0) {
        $platformFee = min($platformFee, $total);
        $agencyAmount = $total - $platformFee;
    }

    $customerId = trim((string) ($request['stripe_customer_id'] ?? ''));
    $pmId = trim($overridePaymentMethodId ?? (string) ($request['stripe_payment_method_id'] ?? ''));
    if ($pmId === '' && $customerId === '' && $payCfg['mock_mode']) {
        $fareTxn = payment_find_transaction_by_ride($rideRequestId, 'ride_fare');
        if ($fareTxn && (string) ($fareTxn['payment_status'] ?? '') === 'paid') {
            $customerId = 'cus_mock_' . $rideRequestId;
            $pmId = 'pm_mock_' . $rideRequestId;
        }
    }

    $pdo = db();
    if ($existing) {
        $transactionId = (int) $existing['id'];
    } else {
        $ins = $pdo->prepare(
            <<<SQL
INSERT INTO transactions
  (ride_request_id, company_id, transaction_type, total_amount, platform_fee, agency_amount, commission_rate, payment_status)
VALUES (?, ?, 'cancellation_fee', ?, ?, ?, 0, 'pending')
SQL
        );
        $ins->execute([$rideRequestId, $companyId, $total, $platformFee, $agencyAmount]);
        $transactionId = (int) $pdo->lastInsertId();
    }

    $chargeId = '';
    $intentId = '';

    if ($payCfg['mock_mode']) {
        if ($customerId === '' && $pmId === '') {
            ride_save_stripe_payment_method($rideRequestId, 'cus_mock_' . $rideRequestId, 'pm_mock_' . $rideRequestId);
        }
        $chargeId = 'mock_cancel_ch_' . $transactionId;
        $intentId = 'pi_mock_cancel_' . $transactionId;
    } else {
        $stripeCharge = payment_stripe_charge_off_session(
            $total,
            $customerId,
            $pmId,
            [
                'transaction_id' => (string) $transactionId,
                'ride_request_id' => (string) $rideRequestId,
                'type' => 'cancellation_fee',
            ],
            $payCfg
        );
        if (!$stripeCharge['ok']) {
            return $stripeCharge;
        }
        $chargeId = (string) ($stripeCharge['charge_id'] ?? '');
        $intentId = (string) ($stripeCharge['payment_intent_id'] ?? '');
    }

    $mark = payment_mark_paid($transactionId, $chargeId, $intentId);
    if (!$mark['ok']) {
        return $mark;
    }

    return [
        'ok' => true,
        'message' => 'キャンセル料を決済しました。',
        'transaction_id' => $transactionId,
        'stripe_charge_id' => $chargeId,
        'agency_amount' => $agencyAmount,
    ];
}

/**
 * @param array<string, string> $metadata
 * @param array<string, mixed> $cfg
 * @return array{ok: bool, message: string, charge_id?: string, payment_intent_id?: string}
 */
function payment_stripe_charge_off_session(
    int $amountYen,
    string $customerId,
    string $paymentMethodId,
    array $metadata,
    array $cfg,
): array {
    $secret = (string) ($cfg['secret_key'] ?? '');
    if ($secret === '' || $customerId === '' || $paymentMethodId === '') {
        return ['ok' => false, 'message' => '決済手段が登録されていません。先にオンライン決済を完了するか、カードを登録してください。'];
    }

    $fields = [
        'amount' => $amountYen,
        'currency' => strtolower((string) ($cfg['currency'] ?? 'jpy')),
        'customer' => $customerId,
        'payment_method' => $paymentMethodId,
        'confirm' => 'true',
        'off_session' => 'true',
        'payment_method_types[]' => 'card',
    ];
    foreach ($metadata as $k => $v) {
        $fields['metadata[' . $k . ']'] = $v;
    }

    $ch = curl_init('https://api.stripe.com/v1/payment_intents');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_USERPWD => $secret . ':',
        CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded'],
        CURLOPT_POSTFIELDS => http_build_query($fields),
        CURLOPT_TIMEOUT => 25,
    ]);
    $response = curl_exec($ch);
    $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode < 200 || $httpCode >= 300 || !is_string($response)) {
        error_log('Stripe off_session charge failed HTTP ' . $httpCode . ' body=' . (string) $response);
        return ['ok' => false, 'message' => 'キャンセル料の決済に失敗しました。カード残高や有効期限をご確認ください。'];
    }

    try {
        $data = json_decode($response, true, 512, JSON_THROW_ON_ERROR);
    } catch (Throwable) {
        return ['ok' => false, 'message' => '決済レスポンスの解析に失敗しました。'];
    }

    if (($data['status'] ?? '') !== 'succeeded') {
        return ['ok' => false, 'message' => 'キャンセル料の決済が完了しませんでした（' . (string) ($data['status'] ?? 'unknown') . '）。'];
    }

    return [
        'ok' => true,
        'message' => 'ok',
        'charge_id' => (string) ($data['latest_charge'] ?? $data['id'] ?? ''),
        'payment_intent_id' => (string) ($data['id'] ?? ''),
    ];
}

/**
 * @param array<string, mixed> $transaction
 * @return array{ok: bool, slip_id?: int, message: string}
 */
function invoice_create_ride_platform_fee_entry(array $transaction, string $stripeChargeId): array
{
    $pdo = invoice_db();
    if (!$pdo instanceof PDO) {
        return ['ok' => false, 'message' => '請求システム連携が未設定です。'];
    }

    $transactionId = (int) ($transaction['id'] ?? 0);
    $companyId = (int) ($transaction['company_id'] ?? 0);
    $rideRequestId = (int) ($transaction['ride_request_id'] ?? 0);
    $platformFee = (int) ($transaction['platform_fee'] ?? 0);
    if ($transactionId <= 0 || $platformFee <= 0) {
        return ['ok' => false, 'message' => '手数料金額がゼロのため請求起票をスキップしました。'];
    }

    $stmt = db()->prepare('SELECT * FROM companies WHERE id = ? LIMIT 1');
    $stmt->execute([$companyId]);
    $company = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$company) {
        return ['ok' => false, 'message' => '業者情報が見つかりません。'];
    }

    $cfg = invoice_config();
    $defaults = $cfg['defaults'] ?? [];
    $txnType = (string) ($transaction['transaction_type'] ?? 'ride_fare');
    $rideDefaults = $cfg['ride_fee'] ?? [];
    $cancelDefaults = $cfg['cancellation_fee'] ?? [];
    if ($txnType === 'cancellation_fee') {
        $itemName = (string) ($cancelDefaults['product_name'] ?? 'ポータル配車キャンセル料（プラットフォーム手数料）');
        $productCode = (string) ($cancelDefaults['product_code'] ?? 'PORTAL-CANCEL-FEE');
    } else {
        $itemName = (string) ($rideDefaults['product_name'] ?? 'ポータル配車手数料（プラットフォーム売上）');
        $productCode = (string) ($rideDefaults['product_code'] ?? 'PORTAL-RIDE-FEE');
    }
    $statusBilling = (int) ($cfg['status']['paid'] ?? $cfg['status']['billing'] ?? 3);
    $kind = (int) ($rideDefaults['kind'] ?? 1);
    $taxRate = (float) ($defaults['tax_rate'] ?? 10.0);
    $taxType = (int) ($defaults['tax_type'] ?? 1);

    $customerId = invoice_ensure_portal_customer($pdo, $company, $cfg);
    if ($customerId <= 0) {
        return ['ok' => false, 'message' => '請求システムへの得意先登録に失敗しました。'];
    }

    $slipTable = invoice_table('sales_slip');
    $partsTable = invoice_table('sales_parts');
    $aliasTable = invoice_table('sales_slip_display_name');
    $bridgeTable = invoice_table('portal_ride_fee_billings');

    $issueDate = date('Y-m-d');
    $sumPrice = $platformFee;
    $tax = (int) floor($sumPrice * $taxRate / (100 + $taxRate));
    $memoPrefix = $txnType === 'cancellation_fee' ? 'PORTAL_CANCEL_FEE' : 'PORTAL_RIDE_FEE';
    $memo = sprintf(
        '%s txn=%d ride=%d company_id=%d charge=%s',
        $memoPrefix,
        $transactionId,
        $rideRequestId,
        $companyId,
        $stripeChargeId
    );

    try {
        $pdo->beginTransaction();

        $check = $pdo->prepare("SELECT sales_slip_id FROM {$bridgeTable} WHERE portal_transaction_id = ? LIMIT 1");
        $check->execute([$transactionId]);
        $existingSlip = $check->fetchColumn();
        if ($existingSlip) {
            $pdo->commit();
            return ['ok' => true, 'slip_id' => (int) $existingSlip, 'message' => '既に請求起票済みです。'];
        }

        $slipPrefix = (string) (
            $txnType === 'cancellation_fee'
                ? ($cancelDefaults['slip_prefix'] ?? 'C')
                : ($rideDefaults['slip_prefix'] ?? 'R')
        );
        $slipNumber = invoice_next_slip_number($pdo, $slipTable, $slipPrefix);
        $chargerId = (int) ($rideDefaults['charger_id'] ?? $defaults['charger_id'] ?? 1);
        $sectionId = (int) ($rideDefaults['section_id'] ?? $defaults['section_id'] ?? 1);

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

        $companyName = trim((string) ($company['name'] ?? 'ポータル配車'));
        $stmtAlias = $pdo->prepare(
            "INSERT INTO {$aliasTable} (slip_id, display_name, updated_at)
             VALUES (?, ?, NOW())
             ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), updated_at = NOW()"
        );
        $stmtAlias->execute([$slipId, $companyName . '（配車手数料）']);

        $stmtBridge = $pdo->prepare(
            "INSERT INTO {$bridgeTable}
             (portal_transaction_id, portal_company_id, ride_request_id, sales_slip_id,
              platform_fee_yen, total_amount_yen, agency_amount_yen, stripe_charge_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        );
        $stmtBridge->execute([
            $transactionId,
            $companyId,
            $rideRequestId,
            $slipId,
            $platformFee,
            (int) ($transaction['total_amount'] ?? 0),
            (int) ($transaction['agency_amount'] ?? 0),
            $stripeChargeId,
        ]);

        $pdo->commit();

        return [
            'ok' => true,
            'slip_id' => $slipId,
            'message' => 'プラットフォーム手数料を請求システム（sales_slip）へ登録しました。',
        ];
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('invoice_create_ride_platform_fee_entry: ' . $e->getMessage());
        return ['ok' => false, 'message' => '請求システムへの登録に失敗しました。'];
    }
}

/**
 * ステータス API 用の決済ブロック。
 *
 * @return array<string, mixed>
 */
function payment_status_for_ride(int $rideRequestId, int $companyId): array
{
    $baseAmount = payment_estimate_amount_for_company($companyId);
    $request = ride_fetch_request_by_id($rideRequestId);
    $surgePayload = ['surge_multiplier' => 1.0, 'show_surge_badge' => false, 'surge_label' => ''];
    if ($request) {
        $surgePayload = surge_calculate_multiplier(
            (string) ($request['prefecture'] ?? ''),
            (string) ($request['city_name'] ?? ''),
            ride_parse_coordinate($request['pickup_lat'] ?? null),
            ride_parse_coordinate($request['pickup_lng'] ?? null),
        );
    }
    $surgeMultiplier = (float) ($surgePayload['surge_multiplier'] ?? 1.0);
    $grossEstimated = surge_apply_to_amount($baseAmount, $surgeMultiplier);
    $couponDiscount = coupon_discount_for_ride($request);
    $estimated = max(100, $grossEstimated - $couponDiscount);

    $txn = payment_find_transaction_by_ride($rideRequestId);
    $block = [
        'estimated_amount' => $estimated,
        'gross_amount' => $grossEstimated,
        'coupon_discount' => $couponDiscount,
        'coupon_discount_label' => $couponDiscount > 0 ? '¥' . number_format($couponDiscount) : '',
        'estimated_label' => '¥' . number_format($estimated),
        'base_amount' => $baseAmount,
        'base_amount_label' => '¥' . number_format($baseAmount),
        'surge_multiplier' => $surgeMultiplier,
        'surge' => $surgePayload,
        'is_estimate' => true,
        'payment_status' => 'none',
    ];

    if (!$txn) {
        return $block;
    }

    $block['transaction_id'] = (int) $txn['id'];
    $block['total_amount'] = (int) $txn['total_amount'];
    $block['coupon_discount'] = (int) ($txn['coupon_discount'] ?? $couponDiscount);
    $block['coupon_discount_label'] = $block['coupon_discount'] > 0
        ? '¥' . number_format($block['coupon_discount']) : '';
    $block['base_amount'] = (int) ($txn['base_amount'] ?? $baseAmount);
    $block['surge_multiplier'] = (float) ($txn['surge_multiplier'] ?? $surgeMultiplier);
    $block['amount_label'] = '¥' . number_format((int) $txn['total_amount']);
    if ($block['coupon_discount'] > 0) {
        $block['amount_label'] .= '（クーポン -' . $block['coupon_discount_label'] . '）';
    }
    $block['payment_status'] = (string) ($txn['payment_status'] ?? 'pending');
    $block['is_estimate'] = (string) ($txn['payment_status'] ?? '') !== 'paid';
    $block['paid'] = (string) ($txn['payment_status'] ?? '') === 'paid';

    return $block;
}

/**
 * 業者ダッシュボード用サマリー。
 *
 * @return array<string, mixed>
 */
function payment_company_sales_summary(int $companyId): array
{
    $empty = [
        'gross_sales' => 0,
        'total_fees' => 0,
        'pool_payout' => 0,
        'transferred_payout' => 0,
        'paid_count' => 0,
        'pending_count' => 0,
    ];
    try {
        $stmt = db()->prepare(
            <<<SQL
SELECT
  COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_amount ELSE 0 END), 0) AS gross_sales,
  COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN platform_fee ELSE 0 END), 0) AS total_fees,
  COALESCE(SUM(CASE WHEN payment_status = 'paid' AND payout_status = 'pending' THEN agency_amount ELSE 0 END), 0) AS pool_payout,
  COALESCE(SUM(CASE WHEN payment_status = 'paid' AND payout_status = 'transferred' THEN agency_amount ELSE 0 END), 0) AS transferred_payout,
  COUNT(CASE WHEN payment_status = 'paid' THEN 1 END) AS paid_count,
  COUNT(CASE WHEN payment_status = 'pending' THEN 1 END) AS pending_count
FROM transactions
WHERE company_id = ?
SQL
        );
        $stmt->execute([$companyId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
    } catch (Throwable $e) {
        error_log('payment_company_sales_summary: ' . $e->getMessage());
        return $empty;
    }

    return [
        'gross_sales' => (int) ($row['gross_sales'] ?? 0),
        'total_fees' => (int) ($row['total_fees'] ?? 0),
        'pool_payout' => (int) ($row['pool_payout'] ?? 0),
        'transferred_payout' => (int) ($row['transferred_payout'] ?? 0),
        'paid_count' => (int) ($row['paid_count'] ?? 0),
        'pending_count' => (int) ($row['pending_count'] ?? 0),
    ];
}

/**
 * @return list<array<string, mixed>>
 */
function payment_company_recent_transactions(int $companyId, int $limit = 20): array
{
    $limit = max(1, min(50, $limit));
    try {
        $stmt = db()->prepare(
            <<<SQL
SELECT t.*, r.user_name, r.city_name, r.prefecture, r.location_details
FROM transactions t
INNER JOIN ride_requests r ON r.id = t.ride_request_id
WHERE t.company_id = ?
ORDER BY t.created_at DESC
LIMIT {$limit}
SQL
        );
        $stmt->execute([$companyId]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    } catch (Throwable $e) {
        error_log('payment_company_recent_transactions: ' . $e->getMessage());
        return [];
    }
}

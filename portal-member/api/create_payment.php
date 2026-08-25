<?php
declare(strict_types=1);

/**
 * 配車決済セッション作成（Stripe PaymentIntent / モック）
 * POST /portal-member/api/create_payment.php
 */
require_once dirname(__DIR__) . '/includes/bootstrap_api.php';
require_once dirname(__DIR__) . '/includes/payment.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    api_json_response(['ok' => false, 'error' => 'method_not_allowed'], 405);
}

$raw = file_get_contents('php://input');
$input = [];
if (is_string($raw) && $raw !== '') {
    try {
        $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        if (is_array($decoded)) {
            $input = $decoded;
        }
    } catch (Throwable) {
        $input = $_POST;
    }
} else {
    $input = $_POST;
}

$rideRequestId = (int) ($input['ride_request_id'] ?? $input['request_id'] ?? 0);
if ($rideRequestId <= 0) {
    api_json_response(['ok' => false, 'error' => 'invalid_id', 'message' => 'ride_request_id が必要です。'], 400);
}

try {
    $result = payment_create_checkout($rideRequestId);
    if (!$result['ok']) {
        api_json_response([
            'ok' => false,
            'error' => 'create_failed',
            'message' => $result['message'],
        ], 400);
    }

    api_json_response([
        'ok' => true,
        'transaction_id' => $result['transaction_id'],
        'amount' => $result['amount'],
        'amount_label' => '¥' . number_format((int) $result['amount']),
        'client_secret' => $result['client_secret'],
        'publishable_key' => $result['publishable_key'],
        'mock_mode' => $result['mock_mode'] ?? true,
    ]);
} catch (Throwable $e) {
    error_log('create_payment: ' . $e->getMessage());
    api_json_response(['ok' => false, 'error' => 'server_error'], 500);
}

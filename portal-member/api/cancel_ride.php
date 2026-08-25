<?php
declare(strict_types=1);

/**
 * ユーザーによる配車キャンセル（無料枠 / キャンセル料課金）
 * POST /portal-member/api/cancel_ride.php
 *
 * JSON: { "ride_request_id": 1, "confirm_penalty": true }
 */
require_once dirname(__DIR__) . '/includes/bootstrap_api.php';
require_once dirname(__DIR__) . '/includes/ride_cancellation.php';

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
$confirmPenalty = !empty($input['confirm_penalty']);
$paymentMethodId = isset($input['payment_method_id']) ? trim((string) $input['payment_method_id']) : null;

if ($rideRequestId <= 0) {
    api_json_response(['ok' => false, 'error' => 'invalid_id', 'message' => 'ride_request_id が必要です。'], 400);
}

try {
    $result = ride_cancel_by_user($rideRequestId, $confirmPenalty, $paymentMethodId);
    if (!$result['ok']) {
        $status = !empty($result['needs_confirmation']) ? 409 : 400;
        api_json_response([
            'ok' => false,
            'error' => !empty($result['needs_confirmation']) ? 'confirmation_required' : 'cancel_failed',
            'message' => $result['message'],
            'needs_confirmation' => (bool) ($result['needs_confirmation'] ?? false),
            'penalty' => (bool) ($result['penalty'] ?? false),
        ], $status);
    }

    api_json_response([
        'ok' => true,
        'message' => $result['message'],
        'status' => 'cancelled',
        'penalty' => (bool) ($result['penalty'] ?? false),
        'fee_charged' => (bool) ($result['fee_charged'] ?? false),
        'agency_compensation' => (int) ($result['agency_compensation'] ?? 0),
    ]);
} catch (Throwable $e) {
    error_log('cancel_ride: ' . $e->getMessage());
    api_json_response(['ok' => false, 'error' => 'server_error'], 500);
}

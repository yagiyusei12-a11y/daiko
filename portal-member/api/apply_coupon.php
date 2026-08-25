<?php
declare(strict_types=1);

/**
 * クーポン適用
 * POST /portal-member/api/apply_coupon.php
 * Body: { "ride_request_id": 1, "code": "WELCOME500" }
 */
require_once dirname(__DIR__) . '/includes/bootstrap_api.php';
require_once dirname(__DIR__) . '/includes/coupons.php';
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
$code = (string) ($input['code'] ?? $input['coupon_code'] ?? '');

$result = coupon_apply_to_ride($rideRequestId, $code);
if (!$result['ok']) {
    api_json_response([
        'ok' => false,
        'error' => $result['error'] ?? 'apply_failed',
        'message' => $result['message'] ?? 'クーポンを適用できませんでした。',
    ], 400);
}

$companyId = 0;
$request = ride_fetch_request_by_id($rideRequestId);
if ($request) {
    $companyId = (int) ($request['accepted_company_id'] ?? 0);
}
$payment = $companyId > 0 ? payment_status_for_ride($rideRequestId, $companyId) : [];

api_json_response([
    'ok' => true,
    'message' => $result['message'],
    'coupon_id' => $result['coupon_id'],
    'discount_amount' => $result['discount_amount'],
    'discount_label' => '¥' . number_format((int) $result['discount_amount']),
    'payment' => $payment,
]);

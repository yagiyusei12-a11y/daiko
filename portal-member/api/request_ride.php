<?php
declare(strict_types=1);

/**
 * スマート配車リクエスト受付
 * POST /portal-member/api/request_ride.php
 */
require_once dirname(__DIR__) . '/includes/bootstrap_api.php';
require_once dirname(__DIR__) . '/includes/line_config.php';
require_once dirname(__DIR__) . '/includes/line_portal.php';
require_once dirname(__DIR__) . '/includes/ride_dispatch.php';

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

try {
    $result = ride_create_request($input);
    if (!$result['ok']) {
        api_json_response([
            'ok' => false,
            'error' => 'request_failed',
            'message' => $result['message'],
        ], 400);
    }

    api_json_response([
        'ok' => true,
        'request_id' => $result['request_id'],
        'message' => $result['message'],
        'notified_drivers' => $result['notified'] ?? 0,
    ]);
} catch (Throwable $e) {
    error_log('request_ride: ' . $e->getMessage());
    api_json_response(['ok' => false, 'error' => 'server_error'], 500);
}

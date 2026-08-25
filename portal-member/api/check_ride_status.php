<?php
declare(strict_types=1);

/**
 * 配車リクエスト状態ポーリング
 * GET /portal-member/api/check_ride_status.php?id=123
 */
require_once dirname(__DIR__) . '/includes/bootstrap_api.php';
require_once dirname(__DIR__) . '/includes/ride_dispatch.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    api_json_response(['ok' => false, 'error' => 'method_not_allowed'], 405);
}

$requestId = (int) ($_GET['id'] ?? $_GET['request_id'] ?? 0);
if ($requestId <= 0) {
    api_json_response(['ok' => false, 'error' => 'invalid_id'], 400);
}

$payload = ride_build_status_payload($requestId);
if ($payload === null) {
    api_json_response(['ok' => false, 'error' => 'not_found'], 404);
}

api_json_response($payload);

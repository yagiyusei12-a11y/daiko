<?php
declare(strict_types=1);

/**
 * ダイナミックプライシング（サージ倍率）
 * GET /portal-member/api/get_surge_multiplier.php?prefecture=...&city_name=...&lat=&lng=
 */
require_once dirname(__DIR__) . '/includes/bootstrap_api.php';
require_once dirname(__DIR__) . '/includes/surge_pricing.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    api_json_response(['ok' => false, 'error' => 'method_not_allowed'], 405);
}

$prefecture = trim((string) ($_GET['prefecture'] ?? ''));
$cityName = trim((string) ($_GET['city_name'] ?? $_GET['city'] ?? ''));
$lat = isset($_GET['lat']) && $_GET['lat'] !== '' ? (float) $_GET['lat'] : null;
$lng = isset($_GET['lng']) && $_GET['lng'] !== '' ? (float) $_GET['lng'] : null;

if ($prefecture === '' || $cityName === '') {
    api_json_response(['ok' => false, 'error' => 'missing_area', 'message' => 'prefecture と city_name が必要です。'], 400);
}

try {
    $payload = surge_calculate_multiplier($prefecture, $cityName, $lat, $lng);
    api_json_response($payload);
} catch (Throwable $e) {
    error_log('get_surge_multiplier: ' . $e->getMessage());
    api_json_response(['ok' => false, 'error' => 'server_error'], 500);
}

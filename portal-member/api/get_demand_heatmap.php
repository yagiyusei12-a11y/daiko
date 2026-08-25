<?php
declare(strict_types=1);

/**
 * 業者向け需要ヒートマップデータ
 * GET /portal-member/api/get_demand_heatmap.php（要ログイン）
 */
require_once dirname(__DIR__) . '/includes/bootstrap.php';
require_once dirname(__DIR__) . '/includes/surge_pricing.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'method_not_allowed'], JSON_UNESCAPED_UNICODE);
    exit;
}

$user = auth_user();
if (!$user) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'unauthorized'], JSON_UNESCAPED_UNICODE);
    exit;
}

$company = find_company_by_user_id((int) $user['id']);
if (!$company) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'no_company'], JSON_UNESCAPED_UNICODE);
    exit;
}

$prefecture = trim((string) ($company['prefecture'] ?? ''));
$cityName = trim((string) ($company['city'] ?? ''));
$cfg = surge_config();
$hours = (int) ($_GET['hours'] ?? $cfg['heatmap_hours']);

try {
    $surge = surge_calculate_multiplier($prefecture, $cityName, null, null);
    $points = surge_heatmap_points($prefecture, $cityName, $hours);
    $center = surge_resolve_coordinates($prefecture, $cityName, null, null) ?? ['lat' => 35.6812, 'lng' => 139.7671];

    echo json_encode([
        'ok' => true,
        'points' => $points,
        'center' => [$center['lat'], $center['lng']],
        'surge_multiplier' => $surge['surge_multiplier'],
        'surge_label' => '🔥 現在のサージ倍率: ' . $surge['surge_multiplier'] . '倍',
        'hours' => $hours,
        'prefecture' => $prefecture,
        'city_name' => $cityName,
        'requests_last_hour' => $surge['requests_last_hour'] ?? 0,
        'active_drivers' => $surge['active_drivers'] ?? 0,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $e) {
    error_log('get_demand_heatmap: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'server_error'], JSON_UNESCAPED_UNICODE);
}

<?php
declare(strict_types=1);

/**
 * ドライバー現在地 GPS 送信（軽量 UPDATE）
 * POST /portal-member/api/update_location.php
 *
 * JSON: { "ride_request_id": 123, "lat": 35.68, "lng": 139.76, "token": "..." }
 * または会員セッション Cookie + company_id が accepted_company_id と一致
 */
$configPath = dirname(__DIR__) . '/config/config.php';
if (!is_file($configPath)) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'config missing'], JSON_UNESCAPED_UNICODE);
    exit;
}

/** @var array<string, mixed> $config */
$config = require $configPath;

require_once dirname(__DIR__) . '/includes/db.php';
require_once dirname(__DIR__) . '/includes/auth.php';
require_once dirname(__DIR__) . '/includes/ride_dispatch.php';

if (!empty($config['session_name']) && is_string($config['session_name'])) {
    session_name($config['session_name']);
}
if (session_status() !== PHP_SESSION_ACTIVE) {
    session_start();
}

function update_location_json(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, max-age=0');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    update_location_json(['ok' => false, 'error' => 'method_not_allowed'], 405);
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

$requestId = (int) ($input['ride_request_id'] ?? $input['request_id'] ?? 0);
$lat = ride_parse_coordinate($input['lat'] ?? null);
$lng = ride_parse_coordinate($input['lng'] ?? null);
$token = trim((string) ($input['token'] ?? $input['tracking_token'] ?? ''));

if ($lat === null || $lng === null) {
    update_location_json(['ok' => false, 'error' => 'invalid_coordinates', 'message' => 'lat / lng が必要です。'], 400);
}

$companyId = null;
$user = $_SESSION['user'] ?? null;
if (is_array($user) && !empty($user['id'])) {
    $company = find_company_by_user_id((int) $user['id']);
    if ($company) {
        $companyId = (int) $company['id'];
    }
}

try {
    $result = ride_update_driver_location($requestId, $lat, $lng, $companyId, $token);
    if (!$result['ok']) {
        update_location_json([
            'ok' => false,
            'error' => 'update_failed',
            'message' => $result['message'],
        ], 403);
    }

    update_location_json([
        'ok' => true,
        'message' => $result['message'],
        'ride_request_id' => $requestId,
        'lat' => $lat,
        'lng' => $lng,
    ]);
} catch (Throwable $e) {
    error_log('update_location: ' . $e->getMessage());
    update_location_json(['ok' => false, 'error' => 'server_error'], 500);
}

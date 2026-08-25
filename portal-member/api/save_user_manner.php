<?php
declare(strict_types=1);

/**
 * 業者 → お客様マナー評価（会員ダッシュボード用）
 * POST /portal-member/api/save_user_manner.php
 */
require_once dirname(__DIR__) . '/includes/bootstrap.php';
require_once dirname(__DIR__) . '/includes/reviews.php';

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'method_not_allowed'], JSON_UNESCAPED_UNICODE);
    exit;
}

$user = auth_require();
$company = find_company_by_user_id((int) $user['id']);
if (!$company) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'message' => '業者情報がありません。'], JSON_UNESCAPED_UNICODE);
    exit;
}

$raw = file_get_contents('php://input');
$input = [];
if (is_string($raw) && $raw !== '') {
    $decoded = json_decode($raw, true);
    if (is_array($decoded)) {
        $input = $decoded;
    }
}
if ($input === []) {
    $input = $_POST;
}

$rideRequestId = (int) ($input['ride_request_id'] ?? 0);
$manner = (string) ($input['user_manner_rating'] ?? $input['manner'] ?? '');
$notes = (string) ($input['driver_notes'] ?? $input['notes'] ?? '');

$result = review_save_user_manner((int) $company['id'], $rideRequestId, $manner, $notes);
http_response_code($result['ok'] ? 200 : 400);
echo json_encode($result, JSON_UNESCAPED_UNICODE);

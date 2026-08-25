<?php
declare(strict_types=1);

/**
 * 乗車完了後のユーザー → 業者レビュー保存
 * POST /portal-member/api/save_review.php
 * Body: { "ride_request_id": 1, "rating": 5, "comment": "..." }
 */
require_once dirname(__DIR__) . '/includes/bootstrap_api.php';
require_once dirname(__DIR__) . '/includes/reviews.php';

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
$rating = (int) ($input['rating'] ?? 0);
$comment = (string) ($input['comment'] ?? '');

$result = review_save_user_review($rideRequestId, $rating, $comment);
if (!$result['ok']) {
    $status = match ($result['error'] ?? '') {
        'not_found' => 404,
        'payment_required', 'invalid_status', 'already_submitted' => 400,
        default => 400,
    };
    api_json_response([
        'ok' => false,
        'error' => $result['error'] ?? 'save_failed',
        'message' => $result['message'] ?? '保存に失敗しました。',
    ], $status);
}

$companyId = (int) ($result['company_id'] ?? 0);
$agg = review_company_aggregate($companyId);

require_once dirname(__DIR__) . '/includes/portal_regenerate.php';
portal_trigger_html_regeneration();

api_json_response([
    'ok' => true,
    'company_id' => $companyId,
    'aggregate' => [
        'avg_rating' => $agg['avg_rating'],
        'review_count' => $agg['review_count'],
        'label' => review_format_portal_label($agg['avg_rating'], $agg['review_count']),
    ],
]);

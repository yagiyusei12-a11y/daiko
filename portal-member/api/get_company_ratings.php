<?php
declare(strict_types=1);

/**
 * 業者評価の集計（単体・一括）
 * GET /portal-member/api/get_company_ratings.php?company_id=1
 * GET /portal-member/api/get_company_ratings.php?ids=1,2,3
 */
require_once dirname(__DIR__) . '/includes/bootstrap_api.php';
require_once dirname(__DIR__) . '/includes/reviews.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    api_json_response(['ok' => false, 'error' => 'method_not_allowed'], 405);
}

$idsParam = trim((string) ($_GET['ids'] ?? ''));
$singleId = (int) ($_GET['company_id'] ?? $_GET['id'] ?? 0);

$ids = [];
if ($idsParam !== '') {
    foreach (explode(',', $idsParam) as $part) {
        $id = (int) trim($part);
        if ($id > 0) {
            $ids[] = $id;
        }
    }
} elseif ($singleId > 0) {
    $ids[] = $singleId;
}

if ($ids === []) {
    api_json_response(['ok' => false, 'error' => 'invalid_id', 'message' => 'company_id または ids が必要です。'], 400);
}

$batch = review_company_aggregates_batch($ids);
$ratings = [];
foreach ($ids as $id) {
    $agg = $batch[$id] ?? ['avg_rating' => null, 'review_count' => 0];
    $avg = $agg['avg_rating'] ?? null;
    $count = (int) ($agg['review_count'] ?? 0);
    $ratings[(string) $id] = [
        'company_id' => $id,
        'avg_rating' => $avg,
        'review_count' => $count,
        'label' => review_format_portal_label(is_float($avg) ? $avg : null, $count),
    ];
}

api_json_response([
    'ok' => true,
    'ratings' => $ratings,
]);

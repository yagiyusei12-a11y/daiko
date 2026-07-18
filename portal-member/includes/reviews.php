<?php
declare(strict_types=1);

/** 直近 N 件の平均がこの値未満で配信除外 */
const REVIEW_QC_RECENT_COUNT = 5;
const REVIEW_QC_MIN_AVG = 3.0;

/**
 * 業者の集計評価（全期間）
 *
 * @return array{avg_rating: float|null, review_count: int}
 */
function review_company_aggregate(int $companyId): array
{
    if ($companyId <= 0) {
        return ['avg_rating' => null, 'review_count' => 0];
    }
    $stmt = db()->prepare(
        'SELECT AVG(rating) AS avg_rating, COUNT(*) AS review_count FROM reviews WHERE company_id = ?'
    );
    $stmt->execute([$companyId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row || (int) ($row['review_count'] ?? 0) === 0) {
        return ['avg_rating' => null, 'review_count' => 0];
    }
    return [
        'avg_rating' => round((float) $row['avg_rating'], 1),
        'review_count' => (int) $row['review_count'],
    ];
}

/**
 * 複数業者の集計を一括取得
 *
 * @param list<int> $companyIds
 * @return array<int, array{avg_rating: float, review_count: int}>
 */
function review_company_aggregates_batch(array $companyIds): array
{
    $ids = array_values(array_unique(array_filter(array_map('intval', $companyIds), static fn (int $id): bool => $id > 0)));
    if ($ids === []) {
        return [];
    }
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $stmt = db()->prepare(
        "SELECT company_id, AVG(rating) AS avg_rating, COUNT(*) AS review_count
         FROM reviews
         WHERE company_id IN ($placeholders)
         GROUP BY company_id"
    );
    $stmt->execute($ids);
    $out = [];
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $cid = (int) ($row['company_id'] ?? 0);
        if ($cid <= 0) {
            continue;
        }
        $out[$cid] = [
            'avg_rating' => round((float) ($row['avg_rating'] ?? 0), 1),
            'review_count' => (int) ($row['review_count'] ?? 0),
        ];
    }
    return $out;
}

/**
 * companies.rating / review_count をレビュー集計で同期
 */
function review_sync_company_rating_columns(int $companyId): void
{
    if ($companyId <= 0) {
        return;
    }
    $agg = review_company_aggregate($companyId);
    $stmt = db()->prepare(
        'UPDATE companies SET rating = ?, review_count = ? WHERE id = ?'
    );
    $stmt->execute([
        $agg['review_count'] > 0 ? $agg['avg_rating'] : null,
        $agg['review_count'] > 0 ? $agg['review_count'] : null,
        $companyId,
    ]);
}

/**
 * 直近 REVIEW_QC_RECENT_COUNT 件の平均で品質フラグを更新
 */
function review_apply_quality_control(int $companyId): void
{
    if ($companyId <= 0) {
        return;
    }
    $stmt = db()->prepare(
        'SELECT rating FROM reviews WHERE company_id = ? ORDER BY created_at DESC, id DESC LIMIT ?'
    );
    $stmt->bindValue(1, $companyId, PDO::PARAM_INT);
    $stmt->bindValue(2, REVIEW_QC_RECENT_COUNT, PDO::PARAM_INT);
    $stmt->execute();
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    $count = count($rows);
    $exclude = false;
    if ($count >= REVIEW_QC_RECENT_COUNT) {
        $sum = 0;
        foreach ($rows as $row) {
            $sum += (int) ($row['rating'] ?? 0);
        }
        $avg = $sum / $count;
        $exclude = $avg < REVIEW_QC_MIN_AVG;
    }
    $stmtUp = db()->prepare(
        'UPDATE companies SET rating_qc_excluded = ?, rating_qc_excluded_at = NOW() WHERE id = ?'
    );
    $stmtUp->execute([$exclude ? 1 : 0, $companyId]);
}

/**
 * ユーザー → 業者レビュー保存
 *
 * @return array{ok: bool, message?: string, error?: string}
 */
function review_save_user_review(int $rideRequestId, int $rating, string $comment): array
{
    if ($rideRequestId <= 0) {
        return ['ok' => false, 'error' => 'invalid_id', 'message' => 'ride_request_id が不正です。'];
    }
    if ($rating < 1 || $rating > 5) {
        return ['ok' => false, 'error' => 'invalid_rating', 'message' => '評価は1〜5の星で指定してください。'];
    }
    $comment = trim($comment);
    if (strlen($comment) > 2000) {
        $comment = mb_substr($comment, 0, 2000);
    }

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare('SELECT * FROM ride_requests WHERE id = ? FOR UPDATE');
        $stmt->execute([$rideRequestId]);
        $ride = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$ride) {
            $pdo->rollBack();
            return ['ok' => false, 'error' => 'not_found', 'message' => '配車リクエストが見つかりません。'];
        }
        if (($ride['status'] ?? '') !== 'accepted') {
            $pdo->rollBack();
            return ['ok' => false, 'error' => 'invalid_status', 'message' => 'マッチング成立後のみレビューできます。'];
        }
        $companyId = (int) ($ride['accepted_company_id'] ?? 0);
        if ($companyId <= 0) {
            $pdo->rollBack();
            return ['ok' => false, 'error' => 'no_company', 'message' => '受注業者が確定していません。'];
        }

        if (!function_exists('payment_status_for_ride')) {
            require_once __DIR__ . '/payment.php';
        }
        $payment = payment_status_for_ride($rideRequestId, $companyId);
        $paid = !empty($payment['paid']) || (($payment['payment_status'] ?? '') === 'paid');
        if (!$paid) {
            $pdo->rollBack();
            return ['ok' => false, 'error' => 'payment_required', 'message' => 'お支払い完了後にレビューを送信できます。'];
        }

        $exists = $pdo->prepare('SELECT id FROM reviews WHERE ride_request_id = ? LIMIT 1');
        $exists->execute([$rideRequestId]);
        if ($exists->fetch(PDO::FETCH_ASSOC)) {
            $pdo->rollBack();
            return ['ok' => false, 'error' => 'already_submitted', 'message' => 'この乗車のレビューは既に送信済みです。'];
        }

        $userId = null;

        $ins = $pdo->prepare(
            'INSERT INTO reviews (ride_request_id, company_id, user_id, rating, comment) VALUES (?, ?, ?, ?, ?)'
        );
        $ins->execute([
            $rideRequestId,
            $companyId,
            $userId,
            $rating,
            $comment !== '' ? $comment : null,
        ]);

        $pdo->prepare(
            'UPDATE ride_requests SET user_review_submitted_at = NOW() WHERE id = ?'
        )->execute([$rideRequestId]);

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        return ['ok' => false, 'error' => 'save_failed', 'message' => 'レビューの保存に失敗しました。'];
    }

    review_sync_company_rating_columns($companyId);
    review_apply_quality_control($companyId);

    return ['ok' => true, 'company_id' => $companyId];
}

/**
 * 業者 → ユーザー マナー評価
 *
 * @return array{ok: bool, message?: string, error?: string}
 */
function review_save_user_manner(
    int $companyId,
    int $rideRequestId,
    string $mannerRating,
    string $driverNotes
): array {
    if ($companyId <= 0 || $rideRequestId <= 0) {
        return ['ok' => false, 'error' => 'invalid_id', 'message' => 'パラメータが不正です。'];
    }
    $mannerRating = strtolower(trim($mannerRating));
    if (!in_array($mannerRating, ['good', 'bad'], true)) {
        return ['ok' => false, 'error' => 'invalid_manner', 'message' => 'マナー評価は good または bad を指定してください。'];
    }
    $driverNotes = trim($driverNotes);
    if (strlen($driverNotes) > 2000) {
        $driverNotes = mb_substr($driverNotes, 0, 2000);
    }

    $stmt = db()->prepare(
        'SELECT id, accepted_company_id, status FROM ride_requests WHERE id = ? LIMIT 1'
    );
    $stmt->execute([$rideRequestId]);
    $ride = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$ride) {
        return ['ok' => false, 'error' => 'not_found', 'message' => '配車リクエストが見つかりません。'];
    }
    if ((int) ($ride['accepted_company_id'] ?? 0) !== $companyId) {
        return ['ok' => false, 'error' => 'forbidden', 'message' => 'このリクエストを評価する権限がありません。'];
    }
    if (($ride['status'] ?? '') !== 'accepted') {
        return ['ok' => false, 'error' => 'invalid_status', 'message' => '受注済みのリクエストのみ評価できます。'];
    }

    $up = db()->prepare(
        'UPDATE ride_requests SET user_manner_rating = ?, driver_notes = ? WHERE id = ? AND accepted_company_id = ?'
    );
    $up->execute([
        $mannerRating,
        $driverNotes !== '' ? $driverNotes : null,
        $rideRequestId,
        $companyId,
    ]);

    return ['ok' => true];
}

/**
 * 管理画面: 警告アラート一覧
 *
 * @return array{
 *   low_rating_companies: list<array<string, mixed>>,
 *   bad_manner_rides: list<array<string, mixed>>
 * }
 */
function review_admin_alert_lists(): array
{
    $lowRatingCompanies = [];
    $badMannerRides = [];

    try {
        $lowStmt = db()->query(
            <<<SQL
SELECT c.id, c.name, c.cert_number, c.prefecture, c.city, c.rating, c.review_count,
       c.rating_qc_excluded, c.rating_qc_excluded_at
FROM companies c
WHERE COALESCE(c.rating_qc_excluded, 0) = 1
ORDER BY c.rating_qc_excluded_at DESC, c.id DESC
LIMIT 100
SQL
        );
        $lowRatingCompanies = $lowStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    } catch (Throwable $e) {
        error_log('review_admin_alert_lists low: ' . $e->getMessage());
    }

    try {
        $badStmt = db()->query(
            <<<SQL
SELECT r.id AS ride_request_id, r.user_name, r.user_phone, r.prefecture, r.city_name,
       r.user_manner_rating, r.driver_notes, r.accepted_at, r.updated_at,
       c.id AS company_id, c.name AS company_name
FROM ride_requests r
INNER JOIN companies c ON c.id = r.accepted_company_id
WHERE r.user_manner_rating = 'bad'
ORDER BY r.updated_at DESC
LIMIT 100
SQL
        );
        $badMannerRides = $badStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    } catch (Throwable $e) {
        error_log('review_admin_alert_lists bad: ' . $e->getMessage());
    }

    return [
        'low_rating_companies' => $lowRatingCompanies,
        'bad_manner_rides' => $badMannerRides,
    ];
}

/**
 * ポータル表示用ラベル（例: ⭐ 4.7 (32件)）
 */
function review_format_portal_label(?float $avg, int $count): string
{
    if ($count <= 0 || $avg === null) {
        return '';
    }
    return '⭐ ' . number_format($avg, 1) . ' (' . $count . '件)';
}

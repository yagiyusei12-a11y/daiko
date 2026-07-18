<?php
declare(strict_types=1);

require_once __DIR__ . '/ride_dispatch.php';

/**
 * @return array<string, mixed>
 */
function coupon_normalize_code(string $code): string
{
    return strtoupper(preg_replace('/\s+/', '', trim($code)) ?? '');
}

/**
 * @return array<string, mixed>|null
 */
function coupon_find_by_code(string $code): ?array
{
    $code = coupon_normalize_code($code);
    if ($code === '') {
        return null;
    }
    $stmt = db()->prepare('SELECT * FROM coupons WHERE code = ? LIMIT 1');
    $stmt->execute([$code]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : null;
}

/**
 * @return array<string, mixed>|null
 */
function coupon_find_by_id(int $couponId): ?array
{
    if ($couponId <= 0) {
        return null;
    }
    $stmt = db()->prepare('SELECT * FROM coupons WHERE id = ? LIMIT 1');
    $stmt->execute([$couponId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : null;
}

/**
 * 配車リクエストにクーポンを紐付け（未決済時のみ）
 *
 * @return array{ok: bool, message?: string, error?: string, discount_amount?: int, coupon_id?: int}
 */
function coupon_apply_to_ride(int $rideRequestId, string $code): array
{
    $code = coupon_normalize_code($code);
    if ($rideRequestId <= 0 || $code === '') {
        return ['ok' => false, 'error' => 'invalid_input', 'message' => 'クーポンコードを入力してください。'];
    }

    $coupon = coupon_find_by_code($code);
    if (!$coupon) {
        return ['ok' => false, 'error' => 'not_found', 'message' => 'クーポンコードが見つかりません。'];
    }
    if ((int) ($coupon['is_used'] ?? 0) === 1) {
        return ['ok' => false, 'error' => 'already_used', 'message' => 'このクーポンは既に使用済みです。'];
    }

    $request = ride_fetch_request_by_id($rideRequestId);
    if (!$request) {
        return ['ok' => false, 'error' => 'not_found', 'message' => '配車リクエストが見つかりません。'];
    }
    if ((string) ($request['status'] ?? '') !== 'accepted') {
        return ['ok' => false, 'error' => 'invalid_status', 'message' => 'マッチング成立後にクーポンを適用できます。'];
    }

    $existingCouponId = (int) ($request['coupon_id'] ?? 0);
    if ($existingCouponId > 0 && $existingCouponId !== (int) $coupon['id']) {
        return ['ok' => false, 'error' => 'already_applied', 'message' => '別のクーポンが既に適用されています。'];
    }

    $stmtPaid = db()->prepare(
        "SELECT payment_status FROM transactions WHERE ride_request_id = ? AND transaction_type = 'ride_fare' LIMIT 1"
    );
    $stmtPaid->execute([$rideRequestId]);
    $payStatus = (string) ($stmtPaid->fetchColumn() ?: '');
    if ($payStatus === 'paid') {
        return ['ok' => false, 'error' => 'already_paid', 'message' => '決済済みのためクーポンを変更できません。'];
    }

    $discount = max(0, (int) ($coupon['discount_amount'] ?? 0));
    if ($discount <= 0) {
        return ['ok' => false, 'error' => 'invalid_coupon', 'message' => 'クーポンの割引額が不正です。'];
    }

    db()->prepare('UPDATE ride_requests SET coupon_id = ? WHERE id = ?')
        ->execute([(int) $coupon['id'], $rideRequestId]);

    return [
        'ok' => true,
        'message' => 'クーポンを適用しました。',
        'coupon_id' => (int) $coupon['id'],
        'discount_amount' => $discount,
        'code' => $code,
    ];
}

/**
 * 決済金額へクーポン割引を反映
 */
function coupon_discount_for_ride(?array $request): int
{
    if (!$request) {
        return 0;
    }
    $couponId = (int) ($request['coupon_id'] ?? 0);
    if ($couponId <= 0) {
        return 0;
    }
    $coupon = coupon_find_by_id($couponId);
    if (!$coupon || (int) ($coupon['is_used'] ?? 0) === 1) {
        return 0;
    }
    return max(0, (int) ($coupon['discount_amount'] ?? 0));
}

/**
 * 決済完了時にクーポンを使用済みにする
 */
function coupon_mark_used_for_ride(int $rideRequestId, int $couponId): void
{
    if ($rideRequestId <= 0 || $couponId <= 0) {
        return;
    }
    $pdo = db();
    $pdo->prepare(
        'UPDATE coupons SET is_used = 1, ride_request_id = ?, used_at = NOW() WHERE id = ? AND is_used = 0'
    )->execute([$rideRequestId, $couponId]);
}

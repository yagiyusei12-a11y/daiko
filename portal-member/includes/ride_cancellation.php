<?php
declare(strict_types=1);

require_once __DIR__ . '/ride_dispatch.php';
require_once __DIR__ . '/line_config.php';

/**
 * @return array{ok: bool, message: string, penalty?: bool, fee_charged?: bool, agency_compensation?: int}
 */
function ride_cancel_by_user(int $rideRequestId, bool $confirmPenalty, ?string $paymentMethodId = null): array
{
    $request = ride_fetch_request_by_id($rideRequestId);
    if (!$request) {
        return ['ok' => false, 'message' => 'リクエストが見つかりません。'];
    }

    $status = (string) ($request['status'] ?? '');
    if ($status === 'cancelled') {
        return ['ok' => false, 'message' => '既にキャンセル済みです。'];
    }
    if ($status !== 'accepted') {
        return ['ok' => false, 'message' => 'マッチング成立後のみキャンセルできます。'];
    }

    $penalty = ride_is_penalty_cancel($request);
    if ($penalty && !$confirmPenalty) {
        $cfg = cancellation_config();
        return [
            'ok' => false,
            'needs_confirmation' => true,
            'penalty' => true,
            'message' => sprintf(
                'マッチング成立から%d分以上経過しているため、キャンセル料%sが発生します。同意が必要です。',
                $cfg['grace_minutes'],
                '¥' . number_format($cfg['fee_yen'])
            ),
        ];
    }

    $cfg = cancellation_config();
    $companyId = (int) ($request['accepted_company_id'] ?? 0);
    $feeCharged = false;
    $agencyCompensation = 0;
    $chargeId = '';

    if ($penalty) {
        require_once __DIR__ . '/payment.php';
        $chargeResult = payment_charge_cancellation_fee($request, $paymentMethodId);
        if (!$chargeResult['ok']) {
            return $chargeResult;
        }
        $feeCharged = true;
        $agencyCompensation = (int) ($chargeResult['agency_amount'] ?? $cfg['agency_compensation_yen']);
        $chargeId = (string) ($chargeResult['stripe_charge_id'] ?? '');
    }

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $upd = $pdo->prepare(
            <<<SQL
UPDATE ride_requests
SET status = 'cancelled',
    cancelled_by = 'user',
    cancellation_reason = ?,
    cancelled_at = NOW(),
    cancellation_fee_charged = ?
WHERE id = ? AND status = 'accepted'
SQL
        );
        $reason = $penalty
            ? 'ユーザー都合（キャンセル料あり）'
            : 'ユーザー都合（無料キャンセル枠内）';
        $upd->execute([$reason, $feeCharged ? 1 : 0, $rideRequestId]);
        if ($upd->rowCount() === 0) {
            $pdo->rollBack();
            return ['ok' => false, 'message' => 'キャンセル処理に失敗しました。'];
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('ride_cancel_by_user: ' . $e->getMessage());
        return ['ok' => false, 'message' => 'キャンセル処理に失敗しました。'];
    }

    ride_notify_cancel_to_agency($request, $feeCharged, $agencyCompensation);

    return [
        'ok' => true,
        'message' => $feeCharged
            ? 'キャンセルしました。キャンセル料の決済が完了しました。'
            : 'キャンセルしました（キャンセル料は発生しません）。',
        'penalty' => $penalty,
        'fee_charged' => $feeCharged,
        'agency_compensation' => $agencyCompensation,
    ];
}

/**
 * @param array<string, mixed> $request
 */
function ride_notify_cancel_to_agency(array $request, bool $feeCharged, int $agencyCompensation): void
{
    if (!line_messaging_enabled()) {
        return;
    }
    $companyId = (int) ($request['accepted_company_id'] ?? 0);
    if ($companyId <= 0) {
        return;
    }
    $stmt = db()->prepare('SELECT name, line_user_id FROM companies WHERE id = ? LIMIT 1');
    $stmt->execute([$companyId]);
    $company = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!is_array($company)) {
        return;
    }
    $lineUserId = trim((string) ($company['line_user_id'] ?? ''));
    if ($lineUserId === '') {
        return;
    }

    $userName = (string) ($request['user_name'] ?? 'お客様');
    if ($feeCharged && $agencyCompensation > 0) {
        $text = "【キャンセル通知】大変申し訳ありません。\n"
            . "{$userName}様からの依頼がキャンセルされました。\n"
            . "ペナルティ対象のため、補償金" . number_format($agencyCompensation) . "円が売上に加算されました。";
    } else {
        $text = "【キャンセル通知】\n"
            . "{$userName}様からの依頼がキャンセルされました（キャンセル料なし）。";
    }

    line_push_text_messages([$lineUserId], $text);
}

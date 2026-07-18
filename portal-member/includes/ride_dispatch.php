<?php
declare(strict_types=1);

require_once __DIR__ . '/line_config.php';

/**
 * 市区町村の営業中かつ LINE 連携済み業者を取得。
 *
 * @return list<array<string, mixed>>
 */
function ride_find_active_line_companies_in_city(string $prefecture, string $cityName): array
{
    $prefecture = trim($prefecture);
    $cityName = trim($cityName);
    if ($prefecture === '' || $cityName === '') {
        return [];
    }

    $stmt = db()->prepare(
        <<<SQL
SELECT c.id, c.name, c.tel, c.line_user_id, c.wait_time_minutes, c.prefecture, c.city
FROM companies c
INNER JOIN events e ON e.company_id = c.id AND e.is_active = 1
WHERE c.prefecture = ?
  AND c.city = ?
  AND COALESCE(c.is_suspended, 0) = 0
  AND COALESCE(c.rating_qc_excluded, 0) = 0
  AND c.line_user_id IS NOT NULL
  AND TRIM(c.line_user_id) <> ''
SQL
    );
    $stmt->execute([$prefecture, $cityName]);
    return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
}

/**
 * @param array<string, mixed> $input
 * @return array{ok: bool, request_id?: int, message: string, notified?: int}
 */
function ride_create_request(array $input): array
{
    $citySlug = trim((string) ($input['city_slug'] ?? ''));
    $prefSlug = trim((string) ($input['pref_slug'] ?? ''));
    $cityName = trim((string) ($input['city_name'] ?? ''));
    $prefecture = trim((string) ($input['prefecture'] ?? ''));
    $userName = trim((string) ($input['user_name'] ?? ''));
    $userPhone = trim((string) ($input['user_phone'] ?? ''));
    $location = trim((string) ($input['location_details'] ?? ''));
    $pickupLat = ride_parse_coordinate($input['pickup_lat'] ?? null);
    $pickupLng = ride_parse_coordinate($input['pickup_lng'] ?? null);
    $referredByShopId = (int) ($input['referred_by_shop_id'] ?? $input['shop_id'] ?? 0);
    if ($referredByShopId > 0) {
        $shopStmt = db()->prepare('SELECT id FROM users WHERE id = ? AND role = ? LIMIT 1');
        $shopStmt->execute([$referredByShopId, 'shop']);
        if (!$shopStmt->fetch(PDO::FETCH_ASSOC)) {
            $referredByShopId = 0;
        }
    } else {
        $referredByShopId = 0;
    }

    if ($citySlug === '' || $prefecture === '' || $cityName === '') {
        return ['ok' => false, 'message' => 'エリア情報が不足しています。市区町村ページから再度お試しください。'];
    }
    if ($userName === '' || mb_strlen($userName) > 128) {
        return ['ok' => false, 'message' => 'お名前を入力してください。'];
    }
    if ($userPhone === '' || !preg_match('/\d{10,11}/', preg_replace('/\D/', '', $userPhone))) {
        return ['ok' => false, 'message' => '有効な電話番号を入力してください。'];
    }

    $drivers = ride_find_active_line_companies_in_city($prefecture, $cityName);
    if ($drivers === []) {
        return [
            'ok' => false,
            'message' => '現在、このエリアで営業中かつLINE連携済みの代行業者がいません。しばらくしてからお試しください。',
        ];
    }

    $pdo = db();
    $stmt = $pdo->prepare(
        <<<SQL
INSERT INTO ride_requests
  (pref_slug, city_slug, city_name, prefecture, user_name, user_phone, location_details,
   pickup_lat, pickup_lng, referred_by_shop_id, status)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
SQL
    );
    $stmt->execute([
        $prefSlug,
        $citySlug,
        $cityName,
        $prefecture,
        $userName,
        $userPhone,
        $location !== '' ? $location : null,
        $pickupLat,
        $pickupLng,
        $referredByShopId > 0 ? $referredByShopId : null,
    ]);
    $requestId = (int) $pdo->lastInsertId();

    $notified = ride_notify_drivers_via_line($requestId, $drivers, $userName, $location, $cityName);

    return [
        'ok' => true,
        'request_id' => $requestId,
        'message' => '配車リクエストを送信しました。業者の応答をお待ちください。',
        'notified' => $notified,
    ];
}

/**
 * @param list<array<string, mixed>> $drivers
 */
function ride_notify_drivers_via_line(
    int $requestId,
    array $drivers,
    string $userName,
    string $location,
    string $cityName,
): int {
    if (!line_messaging_enabled()) {
        return 0;
    }

    $userIds = [];
    foreach ($drivers as $d) {
        $uid = trim((string) ($d['line_user_id'] ?? ''));
        if ($uid !== '') {
            $userIds[] = $uid;
        }
    }
    $userIds = array_values(array_unique($userIds));
    if ($userIds === []) {
        return 0;
    }

    $locLine = $location !== '' ? "\n📍 {$location}" : '';
    $text = "【新規配車リクエスト】\n"
        . "【{$cityName}】{$userName}様から依頼です！\n"
        . "一番早く「対応する」を押した業者が獲得できます！{$locLine}";

    $messages = [
        [
            'type' => 'text',
            'text' => $text,
            'quickReply' => [
                'items' => [
                    [
                        'type' => 'action',
                        'action' => [
                            'type' => 'postback',
                            'label' => '対応する',
                            'data' => 'action=accept_ride&request_id=' . $requestId,
                            'displayText' => '対応する',
                        ],
                    ],
                ],
            ],
        ],
    ];

    return line_multicast_messages($userIds, $messages) ? count($userIds) : 0;
}

/**
 * @param list<string> $userIds
 * @param list<array<string, mixed>> $messages
 */
function line_multicast_messages(array $userIds, array $messages): bool
{
    $token = line_messaging_config()['access_token'];
    if ($token === '' || $userIds === [] || $messages === []) {
        return false;
    }

    $chunks = array_chunk($userIds, 500);
    $ok = true;
    foreach ($chunks as $chunk) {
        $payload = json_encode([
            'to' => $chunk,
            'messages' => $messages,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $ch = curl_init('https://api.line.me/v2/bot/message/multicast');
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $token,
            ],
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_TIMEOUT => 15,
        ]);
        $response = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($httpCode < 200 || $httpCode >= 300) {
            error_log('LINE multicast failed HTTP ' . $httpCode . ' body=' . (string) $response);
            $ok = false;
        }
    }
    return $ok;
}

/**
 * @param list<string> $userIds
 */
function line_push_text_messages(array $userIds, string $text): void
{
    if ($text === '' || $userIds === []) {
        return;
    }
    line_multicast_messages($userIds, [['type' => 'text', 'text' => $text]]);
}

/**
 * @return array{ok: bool, won: bool, message: string}
 */
function ride_try_accept(int $requestId, int $companyId, string $lineUserId, string $replyToken): array
{
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare(
            'SELECT * FROM ride_requests WHERE id = ? FOR UPDATE'
        );
        $stmt->execute([$requestId]);
        $request = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$request) {
            $pdo->rollBack();
            return ['ok' => true, 'won' => false, 'message' => 'リクエストが見つかりません。'];
        }

        $status = (string) ($request['status'] ?? '');
        if ($status !== 'pending') {
            $pdo->rollBack();
            $winnerId = (int) ($request['accepted_company_id'] ?? 0);
            if ($winnerId === $companyId) {
                return ['ok' => true, 'won' => true, 'message' => 'この案件はあなたが受注済みです。'];
            }
            return ['ok' => true, 'won' => false, 'message' => '他社が受注しました。'];
        }

        $company = line_find_company_by_user_id($lineUserId);
        if (!$company || (int) $company['id'] !== $companyId) {
            $pdo->rollBack();
            return ['ok' => false, 'won' => false, 'message' => '業者情報の確認に失敗しました。'];
        }

        if (trim((string) ($company['prefecture'] ?? '')) !== trim((string) ($request['prefecture'] ?? ''))
            || trim((string) ($company['city'] ?? '')) !== trim((string) ($request['city_name'] ?? ''))) {
            $pdo->rollBack();
            return ['ok' => false, 'won' => false, 'message' => 'このリクエストは別エリアの依頼です。'];
        }

        $trackingToken = ride_generate_tracking_token();
        $upd = $pdo->prepare(
            <<<SQL
UPDATE ride_requests
SET status = 'accepted',
    accepted_company_id = ?,
    accepted_at = NOW(),
    driver_tracking_token = ?
WHERE id = ? AND status = 'pending'
SQL
        );
        $upd->execute([$companyId, $trackingToken, $requestId]);
        if ($upd->rowCount() === 0) {
            $pdo->rollBack();
            return ['ok' => true, 'won' => false, 'message' => '他社が受注しました。'];
        }

        $pdo->commit();

        $userPhone = (string) ($request['user_phone'] ?? '');
        $userName = (string) ($request['user_name'] ?? '');
        $location = (string) ($request['location_details'] ?? '');
        $locLine = $location !== '' ? "\nお迎え先: {$location}" : '';

        $trackUrl = ride_driver_tracking_page_url($requestId, $trackingToken);
        $trackLine = $trackUrl !== '' ? "\n📍 位置送信（お客様の地図に表示）:\n{$trackUrl}" : '';

        line_reply_text(
            $replyToken,
            "🎉 案件を獲得しました！\n"
            . "お客様: {$userName}様\n"
            . "電話: {$userPhone}{$locLine}\n"
            . "すぐにご連絡のうえ、お迎えに向かってください。{$trackLine}"
        );

        $others = ride_find_active_line_companies_in_city(
            (string) $request['prefecture'],
            (string) $request['city_name']
        );
        $loseIds = [];
        foreach ($others as $row) {
            if ((int) $row['id'] === $companyId) {
                continue;
            }
            $uid = trim((string) ($row['line_user_id'] ?? ''));
            if ($uid !== '' && $uid !== $lineUserId) {
                $loseIds[] = $uid;
            }
        }
        if ($loseIds !== []) {
            line_push_text_messages($loseIds, '【配車リクエスト】他社が受注しました。次の機会をお待ちください。');
        }

        return ['ok' => true, 'won' => true, 'message' => '獲得しました。'];
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('ride_try_accept: ' . $e->getMessage());
        return ['ok' => false, 'won' => false, 'message' => '処理に失敗しました。'];
    }
}

function ride_generate_tracking_token(): string
{
    return bin2hex(random_bytes(16));
}

/**
 * @return array<string, mixed>
 */
function cancellation_config(): array
{
    global $config;
    $c = is_array($config['cancellation'] ?? null) ? $config['cancellation'] : [];
    return [
        'fee_yen' => max(0, (int) ($c['fee_yen'] ?? 1000)),
        'grace_minutes' => max(0, (int) ($c['grace_minutes'] ?? 5)),
        'platform_fee_yen' => max(0, (int) ($c['platform_fee_yen'] ?? 200)),
        'agency_compensation_yen' => max(0, (int) ($c['agency_compensation_yen'] ?? 800)),
    ];
}

/**
 * マッチング成立からの経過秒（サーバー基準）。
 */
function ride_seconds_since_accepted(array $request): int
{
    $acceptedAt = (string) ($request['accepted_at'] ?? '');
    if ($acceptedAt === '') {
        return 0;
    }
    $ts = strtotime($acceptedAt);
    if ($ts === false) {
        return 0;
    }
    return max(0, time() - $ts);
}

function ride_is_penalty_cancel(array $request): bool
{
    $cfg = cancellation_config();
    $graceSeconds = $cfg['grace_minutes'] * 60;
    return ride_seconds_since_accepted($request) >= $graceSeconds;
}

/**
 * @return array<string, mixed>
 */
function ride_cancel_policy_for_status(array $request): array
{
    $cfg = cancellation_config();
    $seconds = ride_seconds_since_accepted($request);
    $penalty = ride_is_penalty_cancel($request);
    return [
        'grace_minutes' => $cfg['grace_minutes'],
        'fee_yen' => $cfg['fee_yen'],
        'fee_label' => '¥' . number_format($cfg['fee_yen']),
        'seconds_since_accepted' => $seconds,
        'penalty_applies' => $penalty,
        'accepted_at' => $request['accepted_at'] ?? null,
        'can_cancel' => (string) ($request['status'] ?? '') === 'accepted',
    ];
}

function ride_save_stripe_payment_method(int $rideRequestId, string $customerId, string $paymentMethodId): void
{
    $customerId = trim($customerId);
    $paymentMethodId = trim($paymentMethodId);
    if ($rideRequestId <= 0 || ($customerId === '' && $paymentMethodId === '')) {
        return;
    }
    db()->prepare(
        'UPDATE ride_requests SET stripe_customer_id = ?, stripe_payment_method_id = ? WHERE id = ?'
    )->execute([
        $customerId !== '' ? $customerId : null,
        $paymentMethodId !== '' ? $paymentMethodId : null,
        $rideRequestId,
    ]);
}

function ride_driver_tracking_page_url(int $requestId, string $token): string
{
    $token = trim($token);
    if ($requestId <= 0 || $token === '') {
        return '';
    }
    $configPath = dirname(__DIR__) . '/config/config.php';
    if (!is_file($configPath)) {
        return '';
    }
    /** @var array<string, mixed> $config */
    $config = require $configPath;
    $base = rtrim(
        (string) ($config['site_url'] ?? $config['daiko_lp_url'] ?? $config['portal_public_base'] ?? ''),
        '/'
    );
    if ($base === '') {
        $base = 'https://daiko.harunoyukoto.jp';
    }
    return $base . '/portal-member/driver_location.php?'
        . http_build_query(['ride_id' => $requestId, 'token' => $token]);
}

/**
 * @param mixed $value
 */
function ride_parse_coordinate($value): ?float
{
    if ($value === null || $value === '') {
        return null;
    }
    if (!is_numeric($value)) {
        return null;
    }
    $f = (float) $value;
    return is_finite($f) ? $f : null;
}

function ride_validate_lat_lng(float $lat, float $lng): bool
{
    return $lat >= -90.0 && $lat <= 90.0 && $lng >= -180.0 && $lng <= 180.0;
}

/**
 * @return array{ok: bool, message: string}
 */
function ride_update_driver_location(
    int $requestId,
    float $lat,
    float $lng,
    ?int $companyId,
    string $trackingToken,
): array {
    if ($requestId <= 0) {
        return ['ok' => false, 'message' => 'リクエストIDが不正です。'];
    }
    if (!ride_validate_lat_lng($lat, $lng)) {
        return ['ok' => false, 'message' => '緯度・経度が不正です。'];
    }

    $request = ride_fetch_request_by_id($requestId);
    if (!$request) {
        return ['ok' => false, 'message' => 'リクエストが見つかりません。'];
    }

    if ((string) ($request['status'] ?? '') !== 'accepted') {
        return ['ok' => false, 'message' => 'この案件は位置送信の対象外です。'];
    }

    $acceptedId = (int) ($request['accepted_company_id'] ?? 0);
    $token = trim($trackingToken);
    $authorized = false;
    if ($companyId !== null && $companyId > 0 && $companyId === $acceptedId) {
        $authorized = true;
    } elseif ($token !== '' && hash_equals((string) ($request['driver_tracking_token'] ?? ''), $token)) {
        $authorized = true;
    }

    if (!$authorized) {
        return ['ok' => false, 'message' => '認証に失敗しました。'];
    }

    $stmt = db()->prepare(
        <<<SQL
UPDATE ride_requests
SET driver_lat = ?, driver_lng = ?, last_location_updated_at = NOW()
WHERE id = ? AND status = 'accepted' AND accepted_company_id = ?
SQL
    );
    $stmt->execute([$lat, $lng, $requestId, $acceptedId]);

    if ($stmt->rowCount() === 0) {
        return ['ok' => false, 'message' => '位置の更新に失敗しました。'];
    }

    return ['ok' => true, 'message' => '位置を更新しました。'];
}

/**
 * @return array<string, mixed>|null
 */
function ride_fetch_request_by_id(int $requestId): ?array
{
    $stmt = db()->prepare('SELECT * FROM ride_requests WHERE id = ? LIMIT 1');
    $stmt->execute([$requestId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : null;
}

/**
 * @return array<string, mixed>|null
 */
function ride_build_status_payload(int $requestId): ?array
{
    $request = ride_fetch_request_by_id($requestId);
    if (!$request) {
        return null;
    }

    $status = (string) ($request['status'] ?? 'pending');
    $payload = [
        'ok' => true,
        'request_id' => $requestId,
        'status' => $status,
        'location_details' => (string) ($request['location_details'] ?? ''),
        'prefecture' => (string) ($request['prefecture'] ?? ''),
        'city_name' => (string) ($request['city_name'] ?? ''),
        'pickup_lat' => ride_parse_coordinate($request['pickup_lat'] ?? null),
        'pickup_lng' => ride_parse_coordinate($request['pickup_lng'] ?? null),
        'driver_lat' => ride_parse_coordinate($request['driver_lat'] ?? null),
        'driver_lng' => ride_parse_coordinate($request['driver_lng'] ?? null),
        'last_location_updated_at' => $request['last_location_updated_at'] ?? null,
        'accepted_at' => $request['accepted_at'] ?? null,
        'review_submitted' => !empty($request['user_review_submitted_at']),
    ];

    if ($status === 'accepted' && !empty($request['accepted_company_id'])) {
        $payload['cancellation'] = ride_cancel_policy_for_status($request);
    }
    if ($status === 'cancelled') {
        $payload['cancelled'] = true;
        $payload['cancelled_by'] = $request['cancelled_by'] ?? null;
        $payload['cancellation_fee_charged'] = (int) ($request['cancellation_fee_charged'] ?? 0) === 1;
    }

    if ($status === 'accepted' && !empty($request['accepted_company_id'])) {
        $stmt = db()->prepare(
            'SELECT id, name, tel, wait_time_minutes, prefecture, city FROM companies WHERE id = ? LIMIT 1'
        );
        $stmt->execute([(int) $request['accepted_company_id']]);
        $company = $stmt->fetch(PDO::FETCH_ASSOC);
        if (is_array($company)) {
            $wait = $company['wait_time_minutes'] ?? null;
            $waitLabel = '';
            if ($wait !== null && (int) $wait > 0) {
                $waitLabel = (int) $wait >= 60 ? '60分以上' : '約' . (int) $wait . '分';
            }
            $payload['company'] = [
                'id' => (int) $company['id'],
                'name' => (string) $company['name'],
                'tel' => (string) ($company['tel'] ?? ''),
                'wait_time_label' => $waitLabel,
                'prefecture' => (string) ($company['prefecture'] ?? ''),
                'city' => (string) ($company['city'] ?? ''),
            ];
            if (!function_exists('payment_status_for_ride')) {
                require_once __DIR__ . '/payment.php';
            }
            $payload['payment'] = payment_status_for_ride($requestId, (int) $company['id']);
            if (!function_exists('surge_calculate_multiplier')) {
                require_once __DIR__ . '/surge_pricing.php';
            }
            $payload['surge'] = surge_calculate_multiplier(
                (string) ($request['prefecture'] ?? ''),
                (string) ($request['city_name'] ?? ''),
                ride_parse_coordinate($request['pickup_lat'] ?? null),
                ride_parse_coordinate($request['pickup_lng'] ?? null),
            );
        }
    }

    return $payload;
}

/**
 * Postback: action=accept_ride&request_id=N
 */
function ride_handle_accept_postback(string $postbackData, string $lineUserId, string $replyToken): bool
{
    parse_str($postbackData, $params);
    if (($params['action'] ?? '') !== 'accept_ride') {
        return false;
    }
    $requestId = (int) ($params['request_id'] ?? 0);
    if ($requestId <= 0) {
        line_reply_text($replyToken, 'リクエストIDが不正です。');
        return true;
    }

    $company = line_find_company_by_user_id($lineUserId);
    if (!$company) {
        line_reply_text($replyToken, 'LINE連携が完了していないため対応できません。');
        return true;
    }

    $result = ride_try_accept($requestId, (int) $company['id'], $lineUserId, $replyToken);
    if (!$result['ok']) {
        line_reply_text($replyToken, $result['message']);
    } elseif (!$result['won']) {
        line_reply_text($replyToken, $result['message']);
    }

    return true;
}

<?php
declare(strict_types=1);

/**
 * ポータル閲覧用：会員登録業者のリアルタイム情報（イベント・待機・料金・お迎え目安・こだわり）を JSON で返す。
 *
 * GET /portal-member/api/get_live_info.php
 */
require_once dirname(__DIR__) . '/includes/bootstrap_api.php';

try {
    $pdo = db();

    $sql = <<<SQL
SELECT
  c.id AS company_id,
  c.cert_number,
  c.prefecture,
  c.name AS company_name,
  c.wait_time_minutes,
  c.accept_cashless,
  c.is_invoice_registered,
  c.has_female_driver,
  c.left_hand_drive_ok,
  c.is_premium,
  e.is_active,
  e.drivers_available,
  e.event_title,
  e.event_body,
  e.expires_at AS event_expires_at,
  p.base_distance,
  p.base_price,
  p.per_km_price,
  p.note AS price_note
FROM companies c
LEFT JOIN events e ON e.company_id = c.id
LEFT JOIN prices p ON p.company_id = c.id
WHERE COALESCE(c.is_suspended, 0) = 0
ORDER BY c.id ASC
SQL;

    $rows = $pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC);
    $now = new DateTimeImmutable('now', new DateTimeZone('Asia/Tokyo'));

    $byCompanyId = [];
    $byKey = [];

    foreach ($rows as $row) {
        $companyId = (int) $row['company_id'];
        $prefecture = trim((string) $row['prefecture']);
        $cert = trim((string) $row['cert_number']);
        $key = live_match_key($prefecture, $cert);

        $eventValid = is_event_active($row['event_expires_at'] ?? null, $now);
        $hasPrice = has_price_data($row);
        $hasEvent = $eventValid && (
            !empty($row['is_active'])
            || (int) ($row['drivers_available'] ?? 0) > 0
            || trim((string) ($row['event_title'] ?? '')) !== ''
            || trim((string) ($row['event_body'] ?? '')) !== ''
        );
        $hasPortalPrefs = has_portal_prefs($row);

        if (!$hasPrice && !$hasEvent && !$hasPortalPrefs) {
            continue;
        }

        $item = [
            'company_id' => $companyId,
            'cert_number' => $cert,
            'prefecture' => $prefecture,
            'company_name' => trim((string) $row['company_name']),
            'wait_time_minutes' => $row['wait_time_minutes'] !== null ? (int) $row['wait_time_minutes'] : null,
            'accept_cashless' => (bool) (int) ($row['accept_cashless'] ?? 0),
            'is_invoice_registered' => (bool) (int) ($row['is_invoice_registered'] ?? 0),
            'has_female_driver' => (bool) (int) ($row['has_female_driver'] ?? 0),
            'left_hand_drive_ok' => (bool) (int) ($row['left_hand_drive_ok'] ?? 0),
            'is_premium' => (bool) (int) ($row['is_premium'] ?? 0),
        ];

        if ($hasEvent) {
            $item['event'] = [
                'is_active' => (bool) (int) ($row['is_active'] ?? 0),
                'drivers_available' => (int) ($row['drivers_available'] ?? 0),
                'title' => trim((string) ($row['event_title'] ?? '')),
                'body' => trim((string) ($row['event_body'] ?? '')),
                'expires_at' => $row['event_expires_at'],
            ];
        }

        if ($hasPrice) {
            $item['prices'] = [
                'base_distance' => $row['base_distance'] !== null ? (float) $row['base_distance'] : null,
                'base_price' => $row['base_price'] !== null ? (int) $row['base_price'] : null,
                'per_km_price' => $row['per_km_price'] !== null ? (int) $row['per_km_price'] : null,
                'note' => trim((string) ($row['price_note'] ?? '')),
            ];
        }

        $byCompanyId[(string) $companyId] = $item;
        if ($key !== '|') {
            $byKey[$key] = $item;
        }
    }

    api_json_response([
        'ok' => true,
        'generated_at' => $now->format(DateTimeInterface::ATOM),
        'count' => count($byCompanyId),
        'by_company_id' => $byCompanyId,
        'by_key' => $byKey,
    ]);
} catch (Throwable $e) {
    api_json_response([
        'ok' => false,
        'error' => 'server_error',
    ], 500);
}

/**
 * @param string|null $expiresAt
 */
function is_event_active(?string $expiresAt, DateTimeImmutable $now): bool
{
    if ($expiresAt === null || trim($expiresAt) === '') {
        return true;
    }
    try {
        $exp = new DateTimeImmutable($expiresAt, new DateTimeZone('Asia/Tokyo'));
    } catch (Exception) {
        return false;
    }
    return $exp > $now;
}

/**
 * @param array<string, mixed> $row
 */
function has_price_data(array $row): bool
{
    if ($row['base_distance'] !== null && $row['base_distance'] !== '') {
        return true;
    }
    if ($row['base_price'] !== null && $row['base_price'] !== '') {
        return true;
    }
    if ($row['per_km_price'] !== null && $row['per_km_price'] !== '') {
        return true;
    }
    return trim((string) ($row['price_note'] ?? '')) !== '';
}

/**
 * お迎え目安またはこだわり条件が1つでも設定されているか。
 *
 * @param array<string, mixed> $row
 */
function has_portal_prefs(array $row): bool
{
    if ($row['wait_time_minutes'] !== null && $row['wait_time_minutes'] !== '') {
        return true;
    }
    if (!empty($row['accept_cashless'])) {
        return true;
    }
    if (!empty($row['is_invoice_registered'])) {
        return true;
    }
    if (!empty($row['has_female_driver'])) {
        return true;
    }
    if (!empty($row['left_hand_drive_ok'])) {
        return true;
    }
    if (!empty($row['is_premium'])) {
        return true;
    }
    return false;
}

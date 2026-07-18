<?php
declare(strict_types=1);

require_once __DIR__ . '/env.php';

/**
 * @return array<string, mixed>
 */
function surge_config(): array
{
    global $config;
    $s = is_array($config['surge'] ?? null) ? $config['surge'] : [];
    return [
        'max_multiplier' => max(1.0, (float) ($s['max_multiplier'] ?? 2.0)),
        'min_multiplier' => max(1.0, (float) ($s['min_multiplier'] ?? 1.0)),
        'peak_time_multiplier' => max(1.0, (float) ($s['peak_time_multiplier'] ?? 1.2)),
        'weather_bonus' => max(0.0, (float) ($s['weather_bonus'] ?? 0.2)),
        'demand_window_hours' => max(1, (int) ($s['demand_window_hours'] ?? 1)),
        'heatmap_hours' => max(1, (int) ($s['heatmap_hours'] ?? 6)),
        'badge_threshold' => max(1.0, (float) ($s['badge_threshold'] ?? 1.1)),
    ];
}

/**
 * @return array{requests: int, active_drivers: int, ratio: float}
 */
function surge_area_supply_demand(string $prefecture, string $cityName): array
{
    $prefecture = trim($prefecture);
    $cityName = trim($cityName);
    $hours = surge_config()['demand_window_hours'];

    $stmt = db()->prepare(
        <<<SQL
SELECT COUNT(*) FROM ride_requests
WHERE prefecture = ?
  AND city_name = ?
  AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
  AND status IN ('pending', 'accepted', 'completed')
SQL
    );
    $stmt->execute([$prefecture, $cityName, $hours]);
    $requests = (int) $stmt->fetchColumn();

    $stmtActive = db()->prepare(
        <<<SQL
SELECT COUNT(DISTINCT c.id)
FROM companies c
INNER JOIN events e ON e.company_id = c.id AND e.is_active = 1
WHERE c.prefecture = ?
  AND c.city = ?
  AND COALESCE(c.is_suspended, 0) = 0
SQL
    );
    $stmtActive->execute([$prefecture, $cityName]);
    $active = max(0, (int) $stmtActive->fetchColumn());

    $ratio = $active > 0 ? $requests / $active : (float) $requests;

    return [
        'requests' => $requests,
        'active_drivers' => $active,
        'ratio' => round($ratio, 2),
    ];
}

function surge_is_peak_time(?int $timestamp = null): bool
{
    $ts = $timestamp ?? time();
    $dow = (int) date('N', $ts);
    $hour = (int) date('G', $ts);
    if (!in_array($dow, [5, 6], true)) {
        return false;
    }
    return $hour >= 23 || $hour < 3;
}

/**
 * @return array{lat: float, lng: float}|null
 */
function surge_resolve_coordinates(string $prefecture, string $cityName, ?float $lat, ?float $lng): ?array
{
    if ($lat !== null && $lng !== null && $lat >= -90 && $lat <= 90 && $lng >= -180 && $lng <= 180) {
        return ['lat' => $lat, 'lng' => $lng];
    }

    global $config;
    $centroids = is_array($config['surge']['city_centroids'] ?? null)
        ? $config['surge']['city_centroids']
        : [];
    $key = trim($prefecture) . '|' . trim($cityName);
    if (isset($centroids[$key]) && is_array($centroids[$key])) {
        return [
            'lat' => (float) ($centroids[$key]['lat'] ?? 0),
            'lng' => (float) ($centroids[$key]['lng'] ?? 0),
        ];
    }

    $prefDefaults = [
        '東京都' => [35.6812, 139.7671],
        '大阪府' => [34.6937, 135.5023],
        '神奈川県' => [35.4478, 139.6425],
        '愛知県' => [35.1815, 136.9066],
        '福岡県' => [33.5904, 130.4017],
        '北海道' => [43.0618, 141.3545],
        '京都府' => [35.0116, 135.7681],
        '兵庫県' => [34.6901, 135.1956],
        '山梨県' => [35.6641, 138.5685],
    ];
    if (isset($prefDefaults[$prefecture])) {
        return ['lat' => $prefDefaults[$prefecture][0], 'lng' => $prefDefaults[$prefecture][1]];
    }

    return ['lat' => 35.6812, 'lng' => 139.7671];
}

/**
 * 雨・雪時は weather_bonus（既定 0.2）を返す。
 */
function surge_weather_bonus(?float $lat, ?float $lng, string $prefecture, string $cityName): float
{
    $cfg = surge_config();
    $apiKey = trim((string) (portal_env('OPENWEATHERMAP_API_KEY') ?? ''));
    if ($apiKey === '') {
        return 0.0;
    }

    $coords = surge_resolve_coordinates($prefecture, $cityName, $lat, $lng);
    if (!$coords) {
        return 0.0;
    }

    $url = sprintf(
        'https://api.openweathermap.org/data/2.5/weather?lat=%s&lon=%s&appid=%s&units=metric&lang=ja',
        rawurlencode((string) $coords['lat']),
        rawurlencode((string) $coords['lng']),
        rawurlencode($apiKey)
    );

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 8,
    ]);
    $response = curl_exec($ch);
    $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode < 200 || $httpCode >= 300 || !is_string($response)) {
        return 0.0;
    }

    try {
        $data = json_decode($response, true, 512, JSON_THROW_ON_ERROR);
    } catch (Throwable) {
        return 0.0;
    }

    $main = strtolower((string) ($data['weather'][0]['main'] ?? ''));
    $desc = strtolower((string) ($data['weather'][0]['description'] ?? ''));
    $rainSnow = ['rain', 'drizzle', 'snow', 'thunderstorm'];
    foreach ($rainSnow as $w) {
        if (str_contains($main, $w) || str_contains($desc, $w)) {
            return (float) $cfg['weather_bonus'];
        }
    }

    return 0.0;
}

/**
 * @return array<string, mixed>
 */
function surge_calculate_multiplier(
    string $prefecture,
    string $cityName,
    ?float $lat = null,
    ?float $lng = null,
): array {
    $cfg = surge_config();
    $multiplier = 1.0;
    $breakdown = [];

    if (surge_is_peak_time()) {
        $multiplier = max($multiplier, (float) $cfg['peak_time_multiplier']);
        $breakdown[] = [
            'factor' => 'peak_time',
            'label' => '金土深夜帯',
            'value' => (float) $cfg['peak_time_multiplier'],
        ];
    }

    $sd = surge_area_supply_demand($prefecture, $cityName);
    $demandBonus = 0.0;
    if ($sd['active_drivers'] === 0 && $sd['requests'] > 0) {
        $demandBonus = 0.5;
    } elseif ($sd['ratio'] >= 2.0) {
        $demandBonus = 0.3;
    } elseif ($sd['ratio'] >= 1.5) {
        $demandBonus = 0.2;
    } elseif ($sd['ratio'] >= 1.0) {
        $demandBonus = 0.1;
    }
    if ($demandBonus > 0) {
        $multiplier += $demandBonus;
        $breakdown[] = [
            'factor' => 'supply_demand',
            'label' => '需給バランス',
            'value' => $demandBonus,
            'requests_last_hour' => $sd['requests'],
            'active_drivers' => $sd['active_drivers'],
            'ratio' => $sd['ratio'],
        ];
    }

    $weatherBonus = surge_weather_bonus($lat, $lng, $prefecture, $cityName);
    if ($weatherBonus > 0) {
        $multiplier += $weatherBonus;
        $breakdown[] = [
            'factor' => 'weather',
            'label' => '悪天候（雨・雪）',
            'value' => $weatherBonus,
        ];
    }

    $multiplier = min((float) $cfg['max_multiplier'], max((float) $cfg['min_multiplier'], $multiplier));
    $multiplier = round($multiplier, 1);

    $showBadge = $multiplier >= (float) $cfg['badge_threshold'];

    return [
        'ok' => true,
        'surge_multiplier' => $multiplier,
        'show_surge_badge' => $showBadge,
        'surge_label' => $showBadge ? ('⚡ 混雑のため料金 x' . $multiplier . '倍') : '',
        'requests_last_hour' => $sd['requests'],
        'active_drivers' => $sd['active_drivers'],
        'supply_demand_ratio' => $sd['ratio'],
        'is_peak_time' => surge_is_peak_time(),
        'breakdown' => $breakdown,
        'prefecture' => $prefecture,
        'city_name' => $cityName,
    ];
}

function surge_apply_to_amount(int $baseAmountYen, float $multiplier): int
{
    $baseAmountYen = max(0, $baseAmountYen);
    $multiplier = max(1.0, $multiplier);
    return max(100, (int) round($baseAmountYen * $multiplier));
}

/**
 * 業者ダッシュボード用ヒートマップポイント。
 *
 * @return list<array{0: float, 1: float, 2: float}>
 */
function surge_heatmap_points(string $prefecture, string $cityName, int $hours): array
{
    $prefecture = trim($prefecture);
    $cityName = trim($cityName);
    $hours = max(1, min(48, $hours));

    $stmt = db()->prepare(
        <<<SQL
SELECT pickup_lat, pickup_lng, COUNT(*) AS cnt
FROM ride_requests
WHERE prefecture = ?
  AND city_name = ?
  AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
  AND pickup_lat IS NOT NULL
  AND pickup_lng IS NOT NULL
GROUP BY pickup_lat, pickup_lng
SQL
    );
    $stmt->execute([$prefecture, $cityName, $hours]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    $points = [];
    foreach ($rows as $row) {
        $lat = (float) ($row['pickup_lat'] ?? 0);
        $lng = (float) ($row['pickup_lng'] ?? 0);
        $cnt = (int) ($row['cnt'] ?? 1);
        if ($lat === 0.0 && $lng === 0.0) {
            continue;
        }
        $points[] = [$lat, $lng, min(1.0, 0.25 + $cnt * 0.2)];
    }

    if ($points === []) {
        $coords = surge_resolve_coordinates($prefecture, $cityName, null, null);
        if ($coords) {
            $stmt2 = db()->prepare(
                <<<SQL
SELECT COUNT(*) FROM ride_requests
WHERE prefecture = ? AND city_name = ?
  AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
SQL
            );
            $stmt2->execute([$prefecture, $cityName, $hours]);
            $cnt = (int) $stmt2->fetchColumn();
            if ($cnt > 0) {
                $spread = 0.008;
                for ($i = 0; $i < min(12, $cnt); $i++) {
                    $points[] = [
                        $coords['lat'] + (mt_rand(-100, 100) / 10000) * $spread,
                        $coords['lng'] + (mt_rand(-100, 100) / 10000) * $spread,
                        0.35,
                    ];
                }
            }
        }
    }

    return $points;
}

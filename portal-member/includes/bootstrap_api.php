<?php
declare(strict_types=1);

/**
 * 公開 API 用ブートストラップ（セッション不要・JSON のみ）
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

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/csv_merge.php';

function api_json_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, max-age=0');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function live_match_key(string $prefecture, string $certNumber): string
{
    return $prefecture . '|' . normalize_cert_for_match($certNumber);
}

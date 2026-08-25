<?php
declare(strict_types=1);

/**
 * LINE Messaging API Webhook
 * POST /portal-member/api/line_webhook.php
 *
 * .env: LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET
 */
require_once dirname(__DIR__) . '/includes/bootstrap_api.php';
require_once dirname(__DIR__) . '/includes/line_config.php';
require_once dirname(__DIR__) . '/includes/line_portal.php';

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    api_json_response(['ok' => true, 'service' => 'portal-line-webhook']);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    api_json_response(['ok' => false, 'error' => 'method_not_allowed'], 405);
}

if (!line_messaging_enabled()) {
    api_json_response(['ok' => false, 'error' => 'line_not_configured'], 503);
}

$rawBody = file_get_contents('php://input');
if ($rawBody === false) {
    $rawBody = '';
}

$signature = $_SERVER['HTTP_X_LINE_SIGNATURE'] ?? '';
if (!line_verify_signature($rawBody, is_string($signature) ? $signature : null)) {
    api_json_response(['ok' => false, 'error' => 'invalid_signature'], 403);
}

try {
    /** @var array<string, mixed>|null $payload */
    $payload = json_decode($rawBody, true, 512, JSON_THROW_ON_ERROR);
} catch (Throwable $e) {
    api_json_response(['ok' => false, 'error' => 'invalid_json'], 400);
}

$events = $payload['events'] ?? [];
if (!is_array($events)) {
    api_json_response(['ok' => true, 'handled' => 0]);
}

$handled = 0;
foreach ($events as $event) {
    if (!is_array($event)) {
        continue;
    }
    try {
        line_handle_webhook_event($event);
        $handled++;
    } catch (Throwable $e) {
        error_log('line_webhook event error: ' . $e->getMessage());
    }
}

http_response_code(200);
header('Content-Type: application/json; charset=utf-8');
echo json_encode(['ok' => true, 'handled' => $handled], JSON_UNESCAPED_UNICODE);
exit;

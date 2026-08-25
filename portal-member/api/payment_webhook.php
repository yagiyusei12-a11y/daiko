<?php
declare(strict_types=1);

/**
 * 決済完了 Webhook（Stripe / モックテスト）
 * POST /portal-member/api/payment_webhook.php
 */
$configPath = dirname(__DIR__) . '/config/config.php';
if (!is_file($configPath)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'config missing']);
    exit;
}

/** @var array<string, mixed> $config */
$config = require $configPath;

require_once dirname(__DIR__) . '/includes/db.php';
require_once dirname(__DIR__) . '/includes/payment.php';

function payment_webhook_json(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    payment_webhook_json(['ok' => false, 'error' => 'method_not_allowed'], 405);
}

$cfg = payment_config();
$raw = file_get_contents('php://input') ?: '';

// モックテスト（フロントエンド検証用）
$mockHeader = $_SERVER['HTTP_X_PORTAL_PAYMENT_MOCK'] ?? '';
if ($mockHeader !== '' && hash_equals($cfg['mock_webhook_token'], $mockHeader)) {
    try {
        $body = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    } catch (Throwable) {
        $body = $_POST;
    }
    $transactionId = (int) ($body['transaction_id'] ?? 0);
    if ($transactionId <= 0) {
        payment_webhook_json(['ok' => false, 'message' => 'transaction_id が必要です。'], 400);
    }
    $result = payment_mark_paid($transactionId, 'mock_ch_' . $transactionId, 'pi_mock_' . $transactionId);
    payment_webhook_json([
        'ok' => $result['ok'],
        'message' => $result['message'],
        'slip_id' => $result['slip_id'] ?? null,
    ], $result['ok'] ? 200 : 400);
}

// Stripe Webhook
$sigHeader = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';
if ($sigHeader !== '' && $cfg['webhook_secret'] !== '') {
    if (!payment_verify_stripe_signature($raw, $sigHeader, $cfg['webhook_secret'])) {
        payment_webhook_json(['ok' => false, 'error' => 'invalid_signature'], 400);
    }

    try {
        $event = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    } catch (Throwable) {
        payment_webhook_json(['ok' => false, 'error' => 'invalid_json'], 400);
    }

    $type = (string) ($event['type'] ?? '');
    if ($type === 'payment_intent.succeeded') {
        $object = $event['data']['object'] ?? [];
        $transactionId = (int) ($object['metadata']['transaction_id'] ?? 0);
        $intentId = (string) ($object['id'] ?? '');
        $chargeId = (string) ($object['latest_charge'] ?? $intentId);
        if ($transactionId <= 0) {
            payment_webhook_json(['ok' => false, 'message' => 'metadata.transaction_id missing'], 400);
        }
        $result = payment_mark_paid($transactionId, $chargeId, $intentId);
        payment_webhook_json(['ok' => $result['ok'], 'received' => true]);
    }

    payment_webhook_json(['ok' => true, 'received' => true, 'ignored' => $type]);
}

payment_webhook_json(['ok' => false, 'error' => 'unauthorized'], 401);

/**
 * Stripe-Signature 検証（簡易実装）
 */
function payment_verify_stripe_signature(string $payload, string $sigHeader, string $secret): bool
{
    $parts = [];
    foreach (explode(',', $sigHeader) as $item) {
        $kv = explode('=', trim($item), 2);
        if (count($kv) === 2 && $kv[0] === 'v1') {
            $parts[] = $kv[1];
        }
    }
    if ($parts === []) {
        return false;
    }
    $signed = '';
    if (preg_match('/t=(\d+)/', $sigHeader, $m)) {
        $signed = $m[1] . '.' . $payload;
    } else {
        $signed = $payload;
    }
    $expected = hash_hmac('sha256', $signed, $secret);
    foreach ($parts as $sig) {
        if (hash_equals($expected, $sig)) {
            return true;
        }
    }
    return false;
}

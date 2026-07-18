<?php
declare(strict_types=1);

require_once __DIR__ . '/line_config.php';
require_once __DIR__ . '/portal_regenerate.php';

/**
 * @return array<string, mixed>|null
 */
function line_find_company_by_user_id(string $lineUserId): ?array
{
    $lineUserId = trim($lineUserId);
    if ($lineUserId === '') {
        return null;
    }
    $stmt = db()->prepare('SELECT * FROM companies WHERE line_user_id = ? LIMIT 1');
    $stmt->execute([$lineUserId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : null;
}

/**
 * @return array<string, mixed>|null
 */
function line_find_company_by_link_code(string $code): ?array
{
    $code = strtoupper(trim($code));
    if ($code === '') {
        return null;
    }
    $stmt = db()->prepare(
        'SELECT * FROM companies
         WHERE line_link_code = ?
           AND line_link_expires_at IS NOT NULL
           AND line_link_expires_at > NOW()
         LIMIT 1'
    );
    $stmt->execute([$code]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : null;
}

function line_generate_link_code(int $companyId): string
{
    $code = strtoupper(substr(bin2hex(random_bytes(4)), 0, 8));
    $expires = date('Y-m-d H:i:s', strtotime('+24 hours'));
    db()->prepare(
        'UPDATE companies SET line_link_code = ?, line_link_expires_at = ? WHERE id = ?'
    )->execute([$code, $expires, $companyId]);
    return $code;
}

/**
 * @return array{ok: bool, message: string}
 */
function line_bind_user_to_company(int $companyId, string $lineUserId): array
{
    $lineUserId = trim($lineUserId);
    if ($lineUserId === '') {
        return ['ok' => false, 'message' => 'LINEユーザーIDが空です。'];
    }

    $existing = line_find_company_by_user_id($lineUserId);
    if ($existing && (int) $existing['id'] !== $companyId) {
        return ['ok' => false, 'message' => 'このLINEアカウントは別の業者に既に紐付けられています。'];
    }

    db()->prepare(
        'UPDATE companies SET line_user_id = ?, line_link_code = NULL, line_link_expires_at = NULL WHERE id = ?'
    )->execute([$lineUserId, $companyId]);

    return ['ok' => true, 'message' => 'LINE連携が完了しました。'];
}

function line_unbind_company(int $companyId): void
{
    db()->prepare(
        'UPDATE companies SET line_user_id = NULL, line_link_code = NULL, line_link_expires_at = NULL WHERE id = ?'
    )->execute([$companyId]);
}

function line_verify_signature(string $rawBody, ?string $signatureHeader): bool
{
    $secret = line_messaging_config()['channel_secret'];
    if ($secret === '' || $signatureHeader === null || $signatureHeader === '') {
        return false;
    }
    $hash = base64_encode(hash_hmac('sha256', $rawBody, $secret, true));
    return hash_equals($hash, $signatureHeader);
}

/**
 * @return array{action: string, wait_minutes?: int}|null
 */
function line_parse_incoming_command(string $text, ?string $postbackData = null): ?array
{
    if ($postbackData !== null && $postbackData !== '') {
        parse_str($postbackData, $params);
        if (!empty($params['action'])) {
            $action = (string) $params['action'];
            if ($action === 'wait' && isset($params['minutes'])) {
                return ['action' => 'wait', 'wait_minutes' => (int) $params['minutes']];
            }
            return ['action' => $action];
        }
    }

    $t = trim($text);
    if ($t === '') {
        return null;
    }
    $normalized = mb_strtolower($t, 'UTF-8');

    if (preg_match('/^連携\s*([A-Za-z0-9]{6,32})$/u', $t, $m)) {
        return ['action' => 'link', 'link_code' => strtoupper($m[1])];
    }

    if (preg_match('/^(ヘルプ|help|\?|コマンド)$/ui', $t)) {
        return ['action' => 'help'];
    }

    if (preg_match('/^(営業開始|開始|営業中|open|start)$/ui', $t)) {
        return ['action' => 'open'];
    }

    if (preg_match('/^(終了|営業終了|閉店|close|end|停止)$/ui', $t)) {
        return ['action' => 'close'];
    }

    if (preg_match('/^(\d{1,3})\s*分$/u', $t, $m)) {
        $min = (int) $m[1];
        if ($min > 0 && $min <= 180) {
            return ['action' => 'wait', 'wait_minutes' => $min];
        }
    }

    foreach (['10' => 10, '20' => 20, '30' => 30, '45' => 45, '60' => 60] as $key => $min) {
        if (str_contains($normalized, $key) && str_contains($t, '分')) {
            return ['action' => 'wait', 'wait_minutes' => $min];
        }
    }

    return null;
}

function line_ensure_event_row(int $companyId): void
{
    $pdo = db();
    $stmt = $pdo->prepare('SELECT id FROM events WHERE company_id = ? LIMIT 1');
    $stmt->execute([$companyId]);
    if ($stmt->fetchColumn()) {
        return;
    }
    $pdo->prepare('INSERT INTO events (company_id, is_active, drivers_available) VALUES (?, 0, 0)')
        ->execute([$companyId]);
}

/**
 * @param array{action: string, wait_minutes?: int} $command
 * @return array{ok: bool, label: string, message: string}
 */
function line_apply_portal_status(int $companyId, array $command): array
{
    line_ensure_event_row($companyId);
    $pdo = db();

    $action = $command['action'] ?? '';
    $waitMinutes = isset($command['wait_minutes']) ? (int) $command['wait_minutes'] : null;

    if ($action === 'open') {
        $pdo->prepare('UPDATE events SET is_active = 1, updated_at = NOW() WHERE company_id = ?')
            ->execute([$companyId]);
        $stmt = $pdo->prepare('SELECT wait_time_minutes FROM companies WHERE id = ?');
        $stmt->execute([$companyId]);
        $wait = $stmt->fetchColumn();
        $waitInt = $wait !== false && $wait !== null && $wait !== '' ? (int) $wait : null;
        $label = line_status_label(true, $waitInt);
        return ['ok' => true, 'label' => $label, 'message' => line_reply_status_message($label)];
    }

    if ($action === 'close') {
        $pdo->prepare('UPDATE events SET is_active = 0, drivers_available = 0, updated_at = NOW() WHERE company_id = ?')
            ->execute([$companyId]);
        $pdo->prepare('UPDATE companies SET wait_time_minutes = NULL WHERE id = ?')->execute([$companyId]);
        $label = '営業終了';
        return ['ok' => true, 'label' => $label, 'message' => line_reply_status_message($label)];
    }

    if ($action === 'wait' && $waitMinutes !== null && $waitMinutes > 0) {
        $allowed = [10, 20, 30, 45, 60];
        $store = in_array($waitMinutes, $allowed, true)
            ? $waitMinutes
            : min(60, max(10, (int) (round($waitMinutes / 10) * 10)));
        $pdo->prepare('UPDATE companies SET wait_time_minutes = ? WHERE id = ?')
            ->execute([$store, $companyId]);
        $pdo->prepare('UPDATE events SET is_active = 1, updated_at = NOW() WHERE company_id = ?')
            ->execute([$companyId]);
        $label = line_status_label(true, $store);
        return ['ok' => true, 'label' => $label, 'message' => line_reply_status_message($label)];
    }

    return ['ok' => false, 'label' => '', 'message' => line_help_message()];
}

function line_status_label(bool $isActive, ?int $waitMinutes): string
{
    if (!$isActive) {
        return '営業終了';
    }
    if ($waitMinutes !== null && $waitMinutes > 0) {
        if ($waitMinutes >= 60) {
            return '営業中（待ち時間60分以上）';
        }
        return '営業中（待ち時間' . $waitMinutes . '分）';
    }
    return '営業中';
}

function line_reply_status_message(string $label): string
{
    return 'ステータスを「' . $label . '」に更新しました！今日も安全運転で頑張ってください🚗';
}

function line_help_message(): string
{
    return implode("\n", [
        '【代行ポータル LINE操作】',
        '・営業開始 … 本日営業中にする',
        '・20分 / 30分 … 待ち時間を設定して営業中',
        '・終了 … 営業終了',
        '・連携 XXXXXXXX … マイページの連携コード',
        '',
        '例: 「営業開始」「20分」「終了」',
    ]);
}

/**
 * @param array<int, array<string, mixed>> $messages LINE message objects
 */
function line_reply_message(string $replyToken, array $messages): bool
{
    $token = line_messaging_config()['access_token'];
    if ($token === '' || $replyToken === '') {
        return false;
    }

    $payload = json_encode([
        'replyToken' => $replyToken,
        'messages' => $messages,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    $ch = curl_init('https://api.line.me/v2/bot/message/reply');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . $token,
        ],
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_TIMEOUT => 10,
    ]);
    $response = curl_exec($ch);
    $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode < 200 || $httpCode >= 300) {
        error_log('LINE reply failed HTTP ' . $httpCode . ' body=' . (string) $response);
        return false;
    }
    return true;
}

function line_reply_text(string $replyToken, string $text): bool
{
    return line_reply_message($replyToken, [
        ['type' => 'text', 'text' => $text],
    ]);
}

/**
 * @param array<string, mixed> $event LINE webhook event
 */
function line_handle_webhook_event(array $event): void
{
    $type = (string) ($event['type'] ?? '');
    if ($type !== 'message' && $type !== 'postback') {
        return;
    }

    $lineUserId = (string) ($event['source']['userId'] ?? '');
    $replyToken = (string) ($event['replyToken'] ?? '');
    if ($lineUserId === '' || $replyToken === '') {
        return;
    }

    $text = '';
    $postbackData = null;
    if ($type === 'message') {
        $msgType = (string) ($event['message']['type'] ?? '');
        if ($msgType !== 'text') {
            line_reply_text($replyToken, 'テキストで「営業開始」「20分」「終了」などを送信してください。');
            return;
        }
        $text = (string) ($event['message']['text'] ?? '');
    } else {
        $postbackData = (string) ($event['postback']['data'] ?? '');
        $text = (string) ($event['postback']['displayText'] ?? $postbackData);
        require_once __DIR__ . '/ride_dispatch.php';
        if (ride_handle_accept_postback($postbackData, $lineUserId, $replyToken)) {
            return;
        }
    }

    $command = line_parse_incoming_command($text, $postbackData);
    if ($command === null) {
        line_reply_text($replyToken, line_help_message());
        return;
    }

    if (($command['action'] ?? '') === 'link') {
        $code = (string) ($command['link_code'] ?? '');
        $target = line_find_company_by_link_code($code);
        if (!$target) {
            line_reply_text($replyToken, '連携コードが無効か期限切れです。マイページで新しいコードを発行してください。');
            return;
        }
        $bind = line_bind_user_to_company((int) $target['id'], $lineUserId);
        line_reply_text($replyToken, $bind['message']);
        return;
    }

    if (($command['action'] ?? '') === 'help') {
        line_reply_text($replyToken, line_help_message());
        return;
    }

    $company = line_find_company_by_user_id($lineUserId);
    if (!$company) {
        line_reply_text(
            $replyToken,
            "LINE連携がまだ完了していません。\nマイページにログインし「LINE連携」でコードを発行後、「連携 コード」と送信してください。"
        );
        return;
    }

    $companyId = (int) $company['id'];
    $result = line_apply_portal_status($companyId, $command);
    if (!$result['ok']) {
        line_reply_text($replyToken, $result['message']);
        return;
    }

    line_reply_text($replyToken, $result['message']);
    portal_trigger_html_regeneration();
}

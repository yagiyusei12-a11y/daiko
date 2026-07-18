<?php
declare(strict_types=1);

require_once __DIR__ . '/env.php';

/**
 * LINE Messaging API 設定（.env 優先、config.php の line セクションをフォールバック）。
 *
 * @return array{access_token: string, channel_secret: string, bot_id: string}
 */
function line_messaging_config(): array
{
    global $config;
    portal_load_dotenv();

    $fromConfig = is_array($config['line'] ?? null) ? $config['line'] : [];

    return [
        'access_token' => trim((string) (
            portal_env('LINE_CHANNEL_ACCESS_TOKEN')
            ?? $fromConfig['channel_access_token']
            ?? ''
        )),
        'channel_secret' => trim((string) (
            portal_env('LINE_CHANNEL_SECRET')
            ?? $fromConfig['channel_secret']
            ?? ''
        )),
        'bot_id' => trim((string) (
            portal_env('LINE_BOT_BASIC_ID')
            ?? $fromConfig['bot_basic_id']
            ?? ''
        )),
    ];
}

function line_messaging_enabled(): bool
{
    $cfg = line_messaging_config();
    return $cfg['access_token'] !== '' && $cfg['channel_secret'] !== '';
}

<?php
declare(strict_types=1);

$configPath = dirname(__DIR__) . '/config/config.php';
if (!is_file($configPath)) {
    http_response_code(500);
    echo 'config/config.php がありません。config.example.php をコピーして設定してください。';
    exit;
}

/** @var array<string, mixed> $config */
$config = require $configPath;

if (!empty($config['session_name']) && is_string($config['session_name'])) {
    session_name($config['session_name']);
}

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_start();
}

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/csv_merge.php';
require_once __DIR__ . '/helpers.php';

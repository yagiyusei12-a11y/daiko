<?php
declare(strict_types=1);

$configPath = dirname(__DIR__, 2) . '/config/config.php';
if (!is_file($configPath)) {
    http_response_code(500);
    echo 'config/config.php がありません。';
    exit;
}

/** @var array<string, mixed> $config */
$config = require $configPath;

require_once dirname(__DIR__, 2) . '/includes/db.php';
require_once dirname(__DIR__, 2) . '/includes/env.php';
require_once dirname(__DIR__, 2) . '/includes/portal_regenerate.php';
require_once __DIR__ . '/admin_auth.php';

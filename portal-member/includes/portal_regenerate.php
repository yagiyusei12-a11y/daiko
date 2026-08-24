<?php
declare(strict_types=1);

require_once __DIR__ . '/process_lock.php';

/**
 * is_premium 変更後にポータル静的 HTML をバックグラウンド再生成する。
 * 生成中なら 2 本目は起動しない（課金失敗とはみなさない）。
 */
function portal_trigger_html_regeneration(): bool
{
    global $config;

    $root = (string) ($config['project_root'] ?? dirname(__DIR__, 2));
    $lockPath = $root . DIRECTORY_SEPARATOR . 'logs' . DIRECTORY_SEPARATOR . 'portal-generate.lock';
    $probe = daiko_try_exclusive_lock($lockPath);
    if (!$probe['ok']) {
        error_log('portal_trigger_html_regeneration: skip (' . $probe['reason'] . ')');
        return false;
    }
    daiko_release_exclusive_lock($probe['handle']);

    $script = (string) ($config['portal_generate_script'] ?? 'scripts/generate_portal_html.py');
    $scriptPath = $root . DIRECTORY_SEPARATOR . str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $script);

    if (!is_file($scriptPath)) {
        error_log('portal_trigger_html_regeneration: script not found ' . $scriptPath);
        return false;
    }

    $python = (string) ($config['portal_python'] ?? 'python3');
    $logFile = (string) ($config['portal_generate_log'] ?? $root . '/logs/portal-generate.log');
    $logDir = dirname($logFile);
    if (!is_dir($logDir)) {
        @mkdir($logDir, 0755, true);
    }

    if (PHP_OS_FAMILY === 'Windows') {
        $cmd = sprintf(
            'start /B "" %s %s >> %s 2>&1',
            escapeshellarg($python),
            escapeshellarg($scriptPath),
            escapeshellarg($logFile)
        );
        @pclose(@popen($cmd, 'r'));
        return true;
    }

    $cmd = sprintf(
        'cd %s && nohup %s %s >> %s 2>&1 &',
        escapeshellarg($root),
        escapeshellcmd($python),
        escapeshellarg($scriptPath),
        escapeshellarg($logFile)
    );
    exec($cmd, $output, $exitCode);
    return $exitCode === 0;
}

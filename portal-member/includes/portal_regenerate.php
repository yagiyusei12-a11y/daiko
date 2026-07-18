<?php
declare(strict_types=1);

/**
 * is_premium 変更後にポータル静的 HTML をバックグラウンド再生成する。
 */
function portal_trigger_html_regeneration(): bool
{
    global $config;

    $root = (string) ($config['project_root'] ?? dirname(__DIR__, 2));
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

<?php
declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/includes/env.php';

const PORTAL_ADMIN_SESSION_KEY = 'portal_master_admin';

/**
 * @return array{username: string, password: string}
 */
function portal_admin_credentials(): array
{
    global $config;
    portal_load_dotenv();

    $fromConfig = is_array($config['admin'] ?? null) ? $config['admin'] : [];

    return [
        'username' => trim((string) (
            portal_env('PORTAL_ADMIN_USERNAME')
            ?? $fromConfig['username']
            ?? ''
        )),
        'password' => (string) (
            portal_env('PORTAL_ADMIN_PASSWORD')
            ?? $fromConfig['password']
            ?? ''
        ),
    ];
}

function portal_admin_session_start(): void
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_name('portal_master_admin_session');
        session_start();
    }
}

function portal_admin_is_logged_in(): bool
{
    portal_admin_session_start();
    return !empty($_SESSION[PORTAL_ADMIN_SESSION_KEY]);
}

function portal_admin_require(): void
{
    if (!portal_admin_is_logged_in()) {
        header('Location: login.php');
        exit;
    }
}

/**
 * @return array{ok: bool, message: string}
 */
function portal_admin_attempt_login(string $username, string $password): array
{
    $cred = portal_admin_credentials();
    if ($cred['username'] === '' || $cred['password'] === '') {
        return ['ok' => false, 'message' => '管理者認証が未設定です（.env の PORTAL_ADMIN_*）。'];
    }
    if (!hash_equals($cred['username'], trim($username))) {
        return ['ok' => false, 'message' => 'ID またはパスワードが正しくありません。'];
    }
    if (!hash_equals($cred['password'], $password)) {
        return ['ok' => false, 'message' => 'ID またはパスワードが正しくありません。'];
    }
    portal_admin_session_start();
    session_regenerate_id(true);
    $_SESSION[PORTAL_ADMIN_SESSION_KEY] = [
        'username' => $cred['username'],
        'logged_in_at' => time(),
    ];
    return ['ok' => true, 'message' => ''];
}

function portal_admin_logout(): void
{
    portal_admin_session_start();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(
            session_name(),
            '',
            time() - 42000,
            $params['path'],
            $params['domain'],
            (bool) $params['secure'],
            (bool) $params['httponly']
        );
    }
    session_destroy();
}

<?php
declare(strict_types=1);

function auth_user(): ?array
{
    return $_SESSION['user'] ?? null;
}

function auth_require(): array
{
    $user = auth_user();
    if (!$user) {
        header('Location: login.php');
        exit;
    }
    return $user;
}

function auth_login(array $user): void
{
    session_regenerate_id(true);
    $_SESSION['user'] = [
        'id' => (int) $user['id'],
        'email' => $user['email'],
        'role' => $user['role'],
    ];
}

function auth_logout(): void
{
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], (bool) $params['secure'], (bool) $params['httponly']);
    }
    session_destroy();
}

function find_user_by_email(string $email): ?array
{
    $stmt = db()->prepare('SELECT * FROM users WHERE email = ? LIMIT 1');
    $stmt->execute([$email]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function find_user_by_id(int $id): ?array
{
    $stmt = db()->prepare('SELECT * FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function find_company_by_user_id(int $userId): ?array
{
    $stmt = db()->prepare('SELECT * FROM companies WHERE user_id = ? LIMIT 1');
    $stmt->execute([$userId]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function find_price_by_company_id(int $companyId): ?array
{
    $stmt = db()->prepare('SELECT * FROM prices WHERE company_id = ? LIMIT 1');
    $stmt->execute([$companyId]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function find_event_by_company_id(int $companyId): ?array
{
    $stmt = db()->prepare('SELECT * FROM events WHERE company_id = ? LIMIT 1');
    $stmt->execute([$companyId]);
    $row = $stmt->fetch();
    return $row ?: null;
}

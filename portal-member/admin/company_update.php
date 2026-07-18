<?php
declare(strict_types=1);

require_once __DIR__ . '/includes/bootstrap_admin.php';

portal_admin_require();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Location: index.php');
    exit;
}

$companyId = (int) ($_POST['company_id'] ?? 0);
$redirect = 'index.php';

if ($companyId <= 0) {
    $_SESSION['admin_flash_error'] = '不正な業者 ID です。';
    header('Location: ' . $redirect);
    exit;
}

portal_admin_session_start();

$isPremium = isset($_POST['is_premium']) ? 1 : 0;
$isSuspended = isset($_POST['is_suspended']) ? 1 : 0;

try {
    $pdo = db();
    $stmt = $pdo->prepare(
        'UPDATE companies SET is_premium = ?, is_suspended = ? WHERE id = ?'
    );
    $stmt->execute([$isPremium, $isSuspended, $companyId]);

    if ($stmt->rowCount() === 0) {
        $_SESSION['admin_flash_error'] = '業者が見つかりません。';
    } else {
        $_SESSION['admin_flash_success'] = sprintf(
            '業者 #%d を更新しました（プレミアム=%s / 停止=%s）。ポータル再生成を開始しました。',
            $companyId,
            $isPremium ? 'ON' : 'OFF',
            $isSuspended ? 'ON' : 'OFF'
        );
        portal_trigger_html_regeneration();
    }
} catch (Throwable $e) {
    error_log('admin company_update: ' . $e->getMessage());
    $_SESSION['admin_flash_error'] = '更新に失敗しました。';
}

header('Location: ' . $redirect);
exit;

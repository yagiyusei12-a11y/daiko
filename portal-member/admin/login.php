<?php
declare(strict_types=1);

require_once __DIR__ . '/includes/bootstrap_admin.php';

if (portal_admin_is_logged_in()) {
    header('Location: index.php');
    exit;
}

$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim((string) ($_POST['username'] ?? ''));
    $password = (string) ($_POST['password'] ?? '');
    $result = portal_admin_attempt_login($username, $password);
    if ($result['ok']) {
        header('Location: index.php');
        exit;
    }
    $error = $result['message'];
}
?>
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>マスター管理ログイン | 代行ポータル</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-slate-900 flex items-center justify-center p-4">
  <div class="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
    <p class="text-xs font-bold uppercase tracking-wide text-slate-500">Super Admin</p>
    <h1 class="mt-1 text-xl font-bold text-slate-900">ポータル マスター管理</h1>
    <p class="mt-2 text-sm text-slate-600">運営者専用。加盟業者の一覧・停止・プレミアム管理。</p>
    <?php if ($error !== ''): ?>
      <p class="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></p>
    <?php endif; ?>
    <form method="post" class="mt-6 space-y-4">
      <div>
        <label class="block text-xs font-semibold text-slate-600">管理者 ID</label>
        <input name="username" required autocomplete="username"
               class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" />
      </div>
      <div>
        <label class="block text-xs font-semibold text-slate-600">パスワード</label>
        <input type="password" name="password" required autocomplete="current-password"
               class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" />
      </div>
      <button type="submit"
              class="w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white hover:bg-slate-800">
        ログイン
      </button>
    </form>
    <p class="mt-6 text-center text-xs text-slate-500">
      <a href="/portal/" class="text-blue-600 hover:underline">ポータルTOP</a>
    </p>
  </div>
</body>
</html>

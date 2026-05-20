<?php
declare(strict_types=1);

require_once __DIR__ . '/includes/bootstrap.php';

if (auth_user()) {
    redirect('dashboard.php');
}

$errors = [];
$email = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!csrf_verify($_POST['csrf_token'] ?? null)) {
        $errors[] = 'セッションが無効です。ページを再読み込みしてください。';
    } else {
        $email = trim((string) ($_POST['email'] ?? ''));
        $password = (string) ($_POST['password'] ?? '');

        $user = find_user_by_email($email);
        if (!$user || !password_verify($password, $user['password_hash'])) {
            $errors[] = 'メールアドレスまたはパスワードが正しくありません。';
        } else {
            auth_login($user);
            redirect('dashboard.php');
        }
    }
}

layout_head('ログイン');
?>
<main class="mx-auto max-w-md px-4 py-10">
  <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
    <h1 class="text-xl font-bold text-slate-900">業者会員ログイン</h1>

    <?php if ($errors !== []): ?>
      <ul class="mt-4 list-disc space-y-1 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
        <?php foreach ($errors as $err): ?>
          <li><?= e($err) ?></li>
        <?php endforeach; ?>
      </ul>
    <?php endif; ?>

    <form method="post" class="mt-6 space-y-4">
      <input type="hidden" name="csrf_token" value="<?= e(csrf_token()) ?>" />
      <div>
        <label class="block text-xs font-semibold text-slate-600">メールアドレス</label>
        <input type="email" name="email" required value="<?= e($email) ?>"
               class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" />
      </div>
      <div>
        <label class="block text-xs font-semibold text-slate-600">パスワード</label>
        <input type="password" name="password" required
               class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" />
      </div>
      <button type="submit"
              class="w-full rounded-xl bg-brand py-3 text-sm font-bold text-white hover:bg-blue-800">
        ログイン
      </button>
    </form>

    <p class="mt-6 text-center text-sm text-slate-600">
      <a href="register.php" class="font-semibold text-brand hover:underline">新規会員登録</a>
      ·
      <a href="/portal/" class="text-slate-500 hover:underline">ポータルTOP</a>
    </p>
  </div>
</main>
<?php layout_foot(); ?>

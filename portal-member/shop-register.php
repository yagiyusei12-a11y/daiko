<?php
declare(strict_types=1);

require_once __DIR__ . '/includes/bootstrap.php';

if (auth_user()) {
    redirect(auth_home_path());
}

$errors = [];
$old = ['email' => '', 'shop_name' => ''];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!csrf_verify($_POST['csrf_token'] ?? null)) {
        $errors[] = 'セッションが無効です。ページを再読み込みしてください。';
    } else {
        $email = trim((string) ($_POST['email'] ?? ''));
        $password = (string) ($_POST['password'] ?? '');
        $passwordConfirm = (string) ($_POST['password_confirm'] ?? '');
        $shopName = trim((string) ($_POST['shop_name'] ?? ''));
        $old = ['email' => $email, 'shop_name' => $shopName];

        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors[] = '有効なメールアドレスを入力してください。';
        }
        if (strlen($password) < 8) {
            $errors[] = 'パスワードは8文字以上にしてください。';
        }
        if ($password !== $passwordConfirm) {
            $errors[] = 'パスワード（確認）が一致しません。';
        }
        if ($shopName === '') {
            $errors[] = '店舗名を入力してください。';
        }
        if (empty($_POST['agree_terms'])) {
            $errors[] = '利用規約への同意が必要です。';
        }
        if ($errors === [] && find_user_by_email($email)) {
            $errors[] = 'このメールアドレスは既に登録されています。';
        }

        if ($errors === []) {
            $hash = password_hash($password, PASSWORD_DEFAULT);
            $stmt = db()->prepare(
                'INSERT INTO users (email, password_hash, role, shop_name) VALUES (?, ?, ?, ?)'
            );
            $stmt->execute([$email, $hash, 'shop', $shopName]);
            $user = find_user_by_email($email);
            if ($user) {
                auth_login($user);
                flash_set('success', '飲食店アカウントを登録しました。店頭用URLをマイページで確認できます。');
                redirect('shop-dashboard.php');
            }
            $errors[] = '登録に失敗しました。';
        }
    }
}

layout_head('飲食店提携登録');
?>
<main class="mx-auto max-w-md px-4 py-10">
  <div class="rounded-2xl border border-amber-200 bg-white p-6 shadow-sm sm:p-8">
    <h1 class="text-xl font-bold text-amber-900">🍽 飲食店提携登録</h1>
    <p class="mt-2 text-sm text-slate-600">
      お店専用の飲食店モードURLを発行できます。営業中の代行だけを大きく表示し、お客様がすぐ電話できるようになります。
    </p>

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
        <label class="block text-xs font-semibold text-slate-600">店舗名</label>
        <input type="text" name="shop_name" required value="<?= e($old['shop_name']) ?>"
               class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" />
      </div>
      <div>
        <label class="block text-xs font-semibold text-slate-600">メールアドレス</label>
        <input type="email" name="email" required value="<?= e($old['email']) ?>"
               class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" />
      </div>
      <div>
        <label class="block text-xs font-semibold text-slate-600">パスワード</label>
        <input type="password" name="password" required minlength="8"
               class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" />
      </div>
      <div>
        <label class="block text-xs font-semibold text-slate-600">パスワード（確認）</label>
        <input type="password" name="password_confirm" required minlength="8"
               class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" />
      </div>
      <label class="flex items-start gap-2 text-xs text-slate-600">
        <input type="checkbox" name="agree_terms" value="1" class="mt-0.5" required />
        <span><a href="/portal/terms/" class="text-brand hover:underline" target="_blank" rel="noopener">利用規約</a>に同意する</span>
      </label>
      <button type="submit"
              class="w-full rounded-xl bg-amber-600 py-3 text-sm font-bold text-white hover:bg-amber-700">
        提携アカウントを作成
      </button>
    </form>

    <p class="mt-6 text-center text-sm text-slate-600">
      <a href="login.php" class="font-semibold text-brand hover:underline">ログイン</a>
      ·
      <a href="register.php" class="text-slate-500 hover:underline">代行業者の登録</a>
    </p>
  </div>
</main>
<?php layout_foot(); ?>

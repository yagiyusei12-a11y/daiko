<?php
declare(strict_types=1);

require_once __DIR__ . '/includes/bootstrap.php';

if (auth_user()) {
    redirect(auth_home_path());
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
            redirect(auth_home_path($user));
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
      <a href="guide.php" class="font-semibold text-brand hover:underline">使い方ガイド</a>
      ·
      <a href="register.php" class="font-semibold text-brand hover:underline">新規会員登録</a>
      ·
      <a href="shop-register.php" class="font-semibold text-amber-700 hover:underline">飲食店提携登録</a>
      ·
      <a href="/portal/" class="text-slate-500 hover:underline">ポータルTOP</a>
    </p>

    <a href="guide.php#premium" class="mt-6 block rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 no-underline hover:border-amber-300">
      <p class="font-semibold">✨ ポータル掲載のプレミアム枠</p>
      <p class="mt-1 text-xs leading-relaxed text-amber-900/90">
        ログイン後のマイページから、一覧最上位・ゴールド枠の有料プランへお申し込みいただけます。使い方を見る →
      </p>
    </a>

    <a href="guide.php#line" class="mt-4 block rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-950 no-underline hover:border-green-300">
      <p class="font-semibold">📱 LINEから営業ステータス更新</p>
      <p class="mt-1 text-xs leading-relaxed text-green-900/90">
        ログイン後、マイページの「LINE連携」から公式アカウントと紐付けると、トークで「営業開始」「20分」「終了」を送るだけで掲載情報を更新できます。使い方を見る →
      </p>
    </a>

    <a href="guide.php#sales" class="mt-4 block rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-950 no-underline hover:border-indigo-300">
      <p class="font-semibold">💰 オンライン決済・売上管理</p>
      <p class="mt-1 text-xs leading-relaxed text-indigo-900/90">
        ログイン後のマイページ「売上管理」で、プラットフォーム経由の決済売上・手数料・次回振込プールを確認できます。使い方を見る →
      </p>
    </a>
  </div>
</main>
<?php layout_foot(); ?>

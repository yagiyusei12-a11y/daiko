<?php
declare(strict_types=1);

require_once __DIR__ . '/includes/bootstrap.php';

if (auth_user()) {
    redirect('dashboard.php');
}

$errors = [];
$old = [
    'email' => '',
    'cert_number' => '',
    'prefecture' => '',
    'name' => '',
];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!csrf_verify($_POST['csrf_token'] ?? null)) {
        $errors[] = 'セッションが無効です。ページを再読み込みしてください。';
    } else {
        $email = trim((string) ($_POST['email'] ?? ''));
        $password = (string) ($_POST['password'] ?? '');
        $passwordConfirm = (string) ($_POST['password_confirm'] ?? '');
        $certNumber = trim((string) ($_POST['cert_number'] ?? ''));
        $prefecture = trim((string) ($_POST['prefecture'] ?? ''));
        $name = trim((string) ($_POST['name'] ?? ''));

        $old = compact('email', 'cert_number', 'prefecture', 'name');

        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors[] = '有効なメールアドレスを入力してください。';
        }
        if (strlen($password) < 8) {
            $errors[] = 'パスワードは8文字以上にしてください。';
        }
        if ($password !== $passwordConfirm) {
            $errors[] = 'パスワード（確認）が一致しません。';
        }
        if ($certNumber === '') {
            $errors[] = '認定番号を入力してください。';
        }
        if ($name === '') {
            $errors[] = '業者名を入力してください。';
        }
        if ($errors === [] && find_user_by_email($email)) {
            $errors[] = 'このメールアドレスは既に登録されています。';
        }

        if ($errors === []) {
            $seed = find_enriched_row_by_cert($certNumber, $prefecture !== '' ? $prefecture : null) ?? [];
            if ($seed !== []) {
                $name = ($seed['name'] ?? '') ?: $name;
                $prefecture = ($seed['prefecture'] ?? '') ?: $prefecture;
            }

            $pdo = db();
            $pdo->beginTransaction();
            try {
                $stmt = $pdo->prepare(
                    'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)'
                );
                $stmt->execute([$email, password_hash($password, PASSWORD_DEFAULT), 'free']);
                $userId = (int) $pdo->lastInsertId();

                $stmt = $pdo->prepare(
                    'INSERT INTO companies (
                        user_id, cert_number, name, tel, website,
                        prefecture, city, address, description, rating, review_count
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)'
                );
                $stmt->execute([
                    $userId,
                    $certNumber,
                    $name,
                    $seed['tel'] ?? null,
                    $seed['website'] ?? null,
                    $prefecture,
                    $seed['city'] ?? '',
                    $seed['address'] ?? '',
                    isset($seed['rating']) ? (float) $seed['rating'] : null,
                    $seed['review_count'] ?? null,
                ]);
                $companyId = (int) $pdo->lastInsertId();

                $pdo->prepare('INSERT INTO prices (company_id) VALUES (?)')->execute([$companyId]);
                $pdo->prepare('INSERT INTO events (company_id) VALUES (?)')->execute([$companyId]);

                $pdo->commit();

                $user = find_user_by_id($userId);
                if ($user) {
                    auth_login($user);
                }
                flash_set('success', $seed !== []
                    ? '登録完了。公開CSVの情報を認定番号で取り込みました。'
                    : '登録完了。基本情報はダッシュボードから編集できます。');
                redirect('dashboard.php');
            } catch (Throwable $e) {
                $pdo->rollBack();
                $errors[] = '登録に失敗しました。しばらくしてから再度お試しください。';
            }
        }
    }
}

layout_head('新規会員登録');
?>
<main class="mx-auto max-w-lg px-4 py-10">
  <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
    <h1 class="text-xl font-bold text-slate-900">業者会員 新規登録</h1>
    <p class="mt-2 text-sm text-slate-600">
      認定番号で <code class="rounded bg-slate-100 px-1">data/3_enriched_csv/</code> の公開データと自動マージできます（都道府県を指定すると精度向上）。
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
        <label class="block text-xs font-semibold text-slate-600">認定番号 *</label>
        <input name="cert_number" required value="<?= e($old['cert_number']) ?>"
               class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" placeholder="例: 第２号 / 199" />
      </div>

      <div>
        <label class="block text-xs font-semibold text-slate-600">都道府県（マージ用・任意）</label>
        <input name="prefecture" value="<?= e($old['prefecture']) ?>"
               class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" placeholder="例: 滋賀県" />
      </div>

      <div>
        <label class="block text-xs font-semibold text-slate-600">業者名 *</label>
        <input name="name" required value="<?= e($old['name']) ?>"
               class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" />
      </div>

      <div>
        <label class="block text-xs font-semibold text-slate-600">メールアドレス *</label>
        <input type="email" name="email" required value="<?= e($old['email']) ?>"
               class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" />
      </div>

      <div>
        <label class="block text-xs font-semibold text-slate-600">パスワード *（8文字以上）</label>
        <input type="password" name="password" required minlength="8"
               class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" />
      </div>

      <div>
        <label class="block text-xs font-semibold text-slate-600">パスワード（確認） *</label>
        <input type="password" name="password_confirm" required minlength="8"
               class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" />
      </div>

      <button type="submit"
              class="w-full rounded-xl bg-brand py-3 text-sm font-bold text-white hover:bg-blue-800">
        登録する
      </button>
    </form>

    <p class="mt-6 text-center text-sm text-slate-600">
      既にアカウントをお持ちの方は
      <a href="login.php" class="font-semibold text-brand hover:underline">ログイン</a>
    </p>
  </div>
</main>
<?php layout_foot(); ?>

<?php
declare(strict_types=1);

require_once __DIR__ . '/includes/bootstrap.php';

if (auth_user()) {
    redirect('dashboard.php');
}

$initialPref = prefecture_from_query((string) ($_GET['pref'] ?? ''));

$errors = [];
$old = [
    'email' => '',
    'cert_number' => '',
    'prefecture' => $initialPref,
    'name' => '',
    'tel' => '',
    'city' => '',
    'address' => '',
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
        $tel = trim((string) ($_POST['tel'] ?? ''));
        $city = trim((string) ($_POST['city'] ?? ''));
        $address = trim((string) ($_POST['address'] ?? ''));

        $old = compact('email', 'cert_number', 'prefecture', 'name', 'tel', 'city', 'address');

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
        if ($prefecture === '' || !prefecture_is_valid($prefecture)) {
            $errors[] = '都道府県を選択してください。';
        }
        if ($errors === [] && find_user_by_email($email)) {
            $errors[] = 'このメールアドレスは既に登録されています。';
        }
        if ($errors === [] && find_company_by_cert($certNumber, $prefecture)) {
            $errors[] = 'この認定番号は既に掲載登録されています。ログインするか、別の番号をご確認ください。';
        }

        if ($errors === []) {
            $seed = find_enriched_row_by_cert($certNumber, $prefecture) ?? [];

            if ($seed !== []) {
                $name = ($seed['name'] ?? '') ?: $name;
                $tel = $tel !== '' ? $tel : (string) ($seed['tel'] ?? '');
                $city = $city !== '' ? $city : (string) ($seed['city'] ?? '');
                $address = $address !== '' ? $address : (string) ($seed['address'] ?? '');
                $prefecture = ($seed['prefecture'] ?? '') ?: $prefecture;
            }

            if ($tel === '') {
                $errors[] = '電話番号を入力してください。';
            }
            if ($city === '') {
                $errors[] = '市区町村を入力してください。';
            }
        }

        if ($errors === []) {
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
                    $tel,
                    $seed['website'] ?? null,
                    $prefecture,
                    $city,
                    $address,
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
                $msg = $seed !== []
                    ? '登録完了。公開CSVの情報を認定番号で取り込みました。掲載反映はポータル再生成後に表示されます。'
                    : '登録完了。新規掲載として登録しました。ポータル再生成後に一覧へ表示されます。';
                flash_set('success', $msg);
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
      CSVに未掲載のエリアでも登録できます。認定番号が公開CSVにある場合は住所・電話などを自動で取り込みます。
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
        <label class="block text-xs font-semibold text-slate-600">都道府県 *</label>
        <select name="prefecture" required
                class="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-base">
          <option value="">選択してください</option>
          <?php foreach (PREFECTURES_JIS as $pref): ?>
            <option value="<?= e($pref) ?>"<?= $old['prefecture'] === $pref ? ' selected' : '' ?>><?= e($pref) ?></option>
          <?php endforeach; ?>
        </select>
      </div>

      <div>
        <label class="block text-xs font-semibold text-slate-600">認定番号 *</label>
        <input name="cert_number" required value="<?= e($old['cert_number']) ?>"
               class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" placeholder="例: 第２２号 / 199" />
      </div>

      <div>
        <label class="block text-xs font-semibold text-slate-600">業者名 *</label>
        <input name="name" required value="<?= e($old['name']) ?>"
               class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" />
      </div>

      <div>
        <label class="block text-xs font-semibold text-slate-600">市区町村 *</label>
        <input name="city" required value="<?= e($old['city']) ?>"
               class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" placeholder="例: 長浜市" />
      </div>

      <div>
        <label class="block text-xs font-semibold text-slate-600">電話番号 *</label>
        <input name="tel" required value="<?= e($old['tel']) ?>"
               class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" placeholder="例: 090-1234-5678" />
      </div>

      <div>
        <label class="block text-xs font-semibold text-slate-600">所在地（任意）</label>
        <input name="address" value="<?= e($old['address']) ?>"
               class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" placeholder="例: 長浜市○○町1-2" />
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
        無料で掲載登録する
      </button>
    </form>

    <p class="mt-6 text-center text-sm text-slate-600">
      既にアカウントをお持ちの方は
      <a href="login.php" class="font-semibold text-brand hover:underline">ログイン</a>
    </p>
  </div>
</main>
<?php layout_foot(); ?>

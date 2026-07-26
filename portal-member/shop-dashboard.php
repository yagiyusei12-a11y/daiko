<?php
declare(strict_types=1);

require_once __DIR__ . '/includes/bootstrap.php';
require_once __DIR__ . '/includes/kickback.php';

$user = auth_require();
if (!auth_is_shop($user)) {
    redirect('dashboard.php');
}

$shopUserId = (int) $user['id'];
$shopFresh = kickback_find_shop_user($shopUserId);
if (!$shopFresh) {
    flash_set('error', '飲食店アカウントが見つかりません。');
    auth_logout();
    redirect('login.php');
}

$shopName = (string) ($shopFresh['shop_name'] ?? '');
$portalBase = rtrim((string) ($config['portal_public_base'] ?? '/portal/'), '/');
$shopLink = $portalBase . '/?mode=shop&ref=' . $shopUserId;

$success = flash_get('success');
$error = flash_get('error');

layout_head('飲食店マイページ');
?>
<main class="member-neo-main mx-auto max-w-3xl px-4 py-8">
  <header class="member-neo-glass flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 p-4 mb-6">
    <div>
      <p class="text-xs font-bold text-amber-700">飲食店提携パートナー</p>
      <h1 class="text-2xl font-bold text-slate-900"><?= e($shopName !== '' ? $shopName : (string) $user['email']) ?></h1>
    </div>
    <div class="flex gap-2 text-sm">
      <a href="/portal/?mode=shop&ref=<?= $shopUserId ?>" target="_blank" rel="noopener"
         class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 font-semibold text-amber-900 hover:bg-amber-100">
        お客様用ページを開く
      </a>
      <a href="logout.php" class="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50">ログアウト</a>
    </div>
  </header>

  <?php if ($success): ?>
    <p class="mt-4 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-800"><?= e($success) ?></p>
  <?php endif; ?>
  <?php if ($error): ?>
    <p class="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800"><?= e($error) ?></p>
  <?php endif; ?>

  <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <h2 class="text-lg font-bold text-slate-900">店頭用URL（飲食店モード）</h2>
    <p class="mt-1 text-sm text-slate-600">
      このURLをQRコード化して店内掲示してください。営業中の代行だけが大きく表示され、電話しやすくなります。
    </p>
    <div class="mt-3 flex flex-wrap gap-2">
      <input type="text" readonly value="<?= e($shopLink) ?>" id="shop-ref-url"
             class="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm" />
      <button type="button" id="shop-ref-copy"
              class="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700">
        URLをコピー
      </button>
    </div>
    <p class="mt-2 text-xs text-slate-500">例: タブレットのホーム画面やメニュー表のQRに設定</p>
  </section>

  <section class="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
    <p class="font-semibold text-slate-900">できること</p>
    <ul class="mt-2 list-disc space-y-1 pl-5">
      <li>お客様が店内からすぐ営業中の代行を探せる</li>
      <li>大きな電話ボタンで呼び出しやすい表示</li>
    </ul>
  </section>
</main>
<script>
(function () {
  var btn = document.getElementById("shop-ref-copy");
  var input = document.getElementById("shop-ref-url");
  if (!btn || !input) return;
  btn.addEventListener("click", function () {
    input.select();
    try {
      navigator.clipboard.writeText(input.value);
      btn.textContent = "コピーしました";
      setTimeout(function () { btn.textContent = "URLをコピー"; }, 2000);
    } catch (e) {
      document.execCommand("copy");
    }
  });
})();
</script>
<?php layout_foot(); ?>

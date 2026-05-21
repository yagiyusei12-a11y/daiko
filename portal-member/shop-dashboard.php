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

$summary = kickback_shop_dashboard_summary($shopUserId);
$portalBase = rtrim((string) ($config['portal_public_base'] ?? '/portal/'), '/');
$refLink = $portalBase . '/?mode=shop&ref=' . $shopUserId;

$recentStmt = db()->prepare(
    <<<SQL
SELECT r.id, r.user_name, r.created_at, t.paid_at, l.amount_yen
FROM ride_requests r
INNER JOIN transactions t ON t.ride_request_id = r.id AND t.transaction_type = 'ride_fare' AND t.payment_status = 'paid'
LEFT JOIN shop_kickback_ledger l ON l.transaction_id = t.id
WHERE r.referred_by_shop_id = ?
ORDER BY t.paid_at DESC
LIMIT 15
SQL
);
$recentStmt->execute([$shopUserId]);
$recentRows = $recentStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

$success = flash_get('success');
$error = flash_get('error');

layout_head('飲食店キックバック');
?>
<main class="member-neo-main mx-auto max-w-3xl px-4 py-8">
  <header class="member-neo-glass flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 p-4 mb-6">
    <div>
      <p class="text-xs font-bold text-amber-700">飲食店提携パートナー</p>
      <h1 class="text-2xl font-bold text-slate-900"><?= e((string) ($summary['shop_name'] ?: $user['email'])) ?></h1>
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

  <section class="mt-6 grid gap-4 sm:grid-cols-2">
    <div class="member-neo-glass rounded-2xl border-2 border-amber-500/40 bg-gradient-to-br from-amber-950/60 to-slate-900/80 p-5 shadow-sm">
      <p class="member-neo-metric-label text-amber-400">今月の紹介（決済完了）</p>
      <p class="member-neo-metric mt-2 text-amber-400"><?= (int) $summary['referrals_this_month'] ?></p>
      <p class="mt-1 text-xs text-amber-700">件</p>
    </div>
    <div class="member-neo-glass rounded-2xl border-2 border-emerald-500/40 bg-gradient-to-br from-emerald-950/60 to-slate-900/80 p-5 shadow-sm">
      <p class="member-neo-metric-label">キックバック報酬残高</p>
      <p class="member-neo-metric mt-2">¥<?= e(number_format((int) $summary['kickback_balance'])) ?></p>
      <p class="mt-1 text-xs text-emerald-700">累計獲得: ¥<?= e(number_format((int) $summary['total_earned'])) ?></p>
    </div>
  </section>

  <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <h2 class="text-lg font-bold text-slate-900">紹介用URL（バイラル配布用）</h2>
    <p class="mt-1 text-sm text-slate-600">
      このURLをQRコード化して店内掲示してください。お客様が一斉配車・決済すると紹介として記録されます。
    </p>
    <div class="mt-3 flex flex-wrap gap-2">
      <input type="text" readonly value="<?= e($refLink) ?>" id="shop-ref-url"
             class="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm" />
      <button type="button" id="shop-ref-copy"
              class="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700">
        URLをコピー
      </button>
    </div>
    <p class="mt-2 text-xs text-slate-500">パラメータ <code>ref=<?= $shopUserId ?></code> があなたの店舗IDです。</p>
  </section>

  <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <h2 class="text-lg font-bold text-slate-900">最近の紹介・キックバック</h2>
    <?php if ($recentRows === []): ?>
      <p class="mt-4 text-sm text-slate-500">まだ決済完了した紹介はありません。</p>
    <?php else: ?>
      <div class="mt-4 overflow-x-auto">
        <table class="min-w-full text-left text-sm">
          <thead class="border-b border-slate-200 text-xs text-slate-500">
            <tr>
              <th class="py-2 pr-4">決済日時</th>
              <th class="py-2 pr-4">お客様</th>
              <th class="py-2 pr-4">リクエスト</th>
              <th class="py-2">キックバック</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <?php foreach ($recentRows as $row): ?>
              <tr>
                <td class="py-2 text-xs text-slate-500"><?= e((string) ($row['paid_at'] ?? '')) ?></td>
                <td class="py-2"><?= e((string) ($row['user_name'] ?? '')) ?></td>
                <td class="py-2 text-xs">#<?= (int) ($row['id'] ?? 0) ?></td>
                <td class="py-2 font-semibold text-emerald-700">
                  <?= (int) ($row['amount_yen'] ?? 0) > 0 ? '¥' . e(number_format((int) $row['amount_yen'])) : '—' ?>
                </td>
              </tr>
            <?php endforeach; ?>
          </tbody>
        </table>
      </div>
    <?php endif; ?>
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

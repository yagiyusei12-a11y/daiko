<?php
declare(strict_types=1);

require_once __DIR__ . '/includes/bootstrap.php';

$user = auth_require();
$company = find_company_by_user_id((int) $user['id']);
if (!$company) {
    flash_set('error', '業者情報が見つかりません。');
    auth_logout();
    redirect('login.php');
}

$companyId = (int) $company['id'];
$price = find_price_by_company_id($companyId) ?? [];
$event = find_event_by_company_id($companyId) ?? [];

$daikoLp = $config['daiko_lp_url'] ?? 'https://daiko.harunoyukoto.jp/';
$daikoApp = $config['daiko_app_url'] ?? 'https://daiko.harunoyukoto.jp/app/register';
$isPremium = ($user['role'] ?? 'free') === 'premium';

if ($_SERVER['REQUEST_METHOD'] === 'POST' && csrf_verify($_POST['csrf_token'] ?? null)) {
    $action = (string) ($_POST['action'] ?? '');

    if ($action === 'profile') {
        $stmt = db()->prepare(
            'UPDATE companies SET name = ?, tel = ?, website = ?, prefecture = ?, city = ?, address = ?, description = ? WHERE id = ? AND user_id = ?'
        );
        $stmt->execute([
            trim((string) ($_POST['name'] ?? '')),
            trim((string) ($_POST['tel'] ?? '')) ?: null,
            trim((string) ($_POST['website'] ?? '')) ?: null,
            trim((string) ($_POST['prefecture'] ?? '')),
            trim((string) ($_POST['city'] ?? '')),
            trim((string) ($_POST['address'] ?? '')),
            trim((string) ($_POST['description'] ?? '')) ?: null,
            $companyId,
            (int) $user['id'],
        ]);
        flash_set('success', '基本情報を保存しました。');
    }

    if ($action === 'prices') {
        $stmt = db()->prepare(
            'UPDATE prices SET base_distance = ?, base_price = ?, per_km_price = ?, note = ? WHERE company_id = ?'
        );
        $stmt->execute([
            $_POST['base_distance'] !== '' ? (float) $_POST['base_distance'] : null,
            $_POST['base_price'] !== '' ? (int) $_POST['base_price'] : null,
            $_POST['per_km_price'] !== '' ? (int) $_POST['per_km_price'] : null,
            trim((string) ($_POST['note'] ?? '')) ?: null,
            $companyId,
        ]);
        flash_set('success', '料金体制を保存しました。');
    }

    if ($action === 'event') {
        $expires = trim((string) ($_POST['expires_at'] ?? ''));
        $expiresAt = $expires !== '' ? date('Y-m-d H:i:s', strtotime($expires)) : null;
        $stmt = db()->prepare(
            'UPDATE events SET is_active = ?, drivers_available = ?, event_title = ?, event_body = ?, expires_at = ? WHERE company_id = ?'
        );
        $stmt->execute([
            isset($_POST['is_active']) ? 1 : 0,
            max(0, (int) ($_POST['drivers_available'] ?? 0)),
            trim((string) ($_POST['event_title'] ?? '')) ?: null,
            trim((string) ($_POST['event_body'] ?? '')) ?: null,
            $expiresAt,
            $companyId,
        ]);
        flash_set('success', '本日のイベント・待機状況を保存しました。');
    }

    redirect('dashboard.php');
}

$company = find_company_by_user_id((int) $user['id']) ?: $company;
$price = find_price_by_company_id($companyId) ?? $price;
$event = find_event_by_company_id($companyId) ?? $event;

$success = flash_get('success');
$error = flash_get('error');

layout_head('マイページ');
?>
<header class="border-b border-slate-200 bg-white">
  <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
    <div>
      <p class="text-xs font-semibold text-brand">業者マイページ</p>
      <h1 class="text-lg font-bold"><?= e($company['name']) ?></h1>
      <p class="text-xs text-slate-500">認定 <?= e($company['cert_number']) ?> · <?= e($user['role']) ?> プラン</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <a href="/portal/" class="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:border-brand">ポータルTOP</a>
      <a href="logout.php" class="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">ログアウト</a>
    </div>
  </div>
</header>

<main class="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:flex lg:gap-8">
  <!-- サイドバー：プレミアム導線 -->
  <aside class="mb-8 lg:mb-0 lg:w-72 lg:shrink-0">
    <div class="sticky top-4 space-y-4">
      <div class="overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 p-5 text-white shadow-lg">
        <p class="text-xs font-bold uppercase tracking-wide opacity-90">Premium</p>
        <h2 class="mt-1 text-base font-bold leading-snug">【プレミアム機能】配車・インボイス対応売上管理システムを利用する</h2>
        <p class="mt-2 text-sm opacity-95">Daiko で配車・日報・売上を一元管理。ポータル掲載と連携した本丸システムへ。</p>
        <a href="<?= e($daikoApp) ?>"
           class="mt-4 flex w-full items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-bold text-orange-700 shadow-md hover:bg-orange-50">
          アップグレード・無料トライアル →
        </a>
        <a href="<?= e($daikoLp) ?>" class="mt-2 block text-center text-xs underline opacity-90">サービス詳細を見る</a>
      </div>

      <nav class="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
        <p class="font-semibold text-slate-800">メニュー</p>
        <ul class="mt-2 space-y-1 text-slate-600">
          <li><a href="#profile" class="block rounded-lg px-2 py-1.5 hover:bg-slate-50">基本情報</a></li>
          <li><a href="#prices" class="block rounded-lg px-2 py-1.5 hover:bg-slate-50">料金体制</a></li>
          <li><a href="#events" class="block rounded-lg px-2 py-1.5 hover:bg-slate-50">本日のイベント</a></li>
        </ul>
      </nav>
    </div>
  </aside>

  <div class="min-w-0 flex-1 space-y-8">
    <?php if ($success): ?>
      <p class="rounded-xl bg-green-50 px-4 py-3 text-sm text-green-800"><?= e($success) ?></p>
    <?php endif; ?>
    <?php if ($error): ?>
      <p class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800"><?= e($error) ?></p>
    <?php endif; ?>

    <?php if (!$isPremium): ?>
      <section class="rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:hidden">
        <p class="text-sm font-semibold text-amber-900">配車・売上管理は Daiko プレミアムプランで</p>
        <a href="<?= e($daikoApp) ?>" class="mt-2 inline-block text-sm font-bold text-brand underline">詳しくはこちら</a>
      </section>
    <?php endif; ?>

    <!-- 基本情報 -->
    <section id="profile" class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-lg font-bold text-slate-900">基本情報（電話・HP）</h2>
      <form method="post" class="mt-4 space-y-4">
        <input type="hidden" name="csrf_token" value="<?= e(csrf_token()) ?>" />
        <input type="hidden" name="action" value="profile" />
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="sm:col-span-2">
            <label class="text-xs font-semibold text-slate-600">業者名</label>
            <input name="name" required value="<?= e($company['name']) ?>"
                   class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" />
          </div>
          <div>
            <label class="text-xs font-semibold text-slate-600">電話番号</label>
            <input name="tel" value="<?= e($company['tel'] ?? '') ?>"
                   class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" />
          </div>
          <div>
            <label class="text-xs font-semibold text-slate-600">公式HP（URL）</label>
            <input name="website" value="<?= e($company['website'] ?? '') ?>"
                   class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" />
          </div>
          <div>
            <label class="text-xs font-semibold text-slate-600">都道府県</label>
            <input name="prefecture" value="<?= e($company['prefecture'] ?? '') ?>"
                   class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" />
          </div>
          <div>
            <label class="text-xs font-semibold text-slate-600">市区町村</label>
            <input name="city" value="<?= e($company['city'] ?? '') ?>"
                   class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" />
          </div>
          <div class="sm:col-span-2">
            <label class="text-xs font-semibold text-slate-600">所在地</label>
            <input name="address" value="<?= e($company['address'] ?? '') ?>"
                   class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" />
          </div>
          <div class="sm:col-span-2">
            <label class="text-xs font-semibold text-slate-600">紹介文</label>
            <textarea name="description" rows="3"
                      class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5"><?= e($company['description'] ?? '') ?></textarea>
          </div>
        </div>
        <button type="submit" class="rounded-xl bg-brand px-6 py-2.5 text-sm font-bold text-white hover:bg-blue-800">保存</button>
      </form>
    </section>

    <!-- 料金 -->
    <section id="prices" class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-lg font-bold text-slate-900">料金体制</h2>
      <form method="post" class="mt-4 space-y-4">
        <input type="hidden" name="csrf_token" value="<?= e(csrf_token()) ?>" />
        <input type="hidden" name="action" value="prices" />
        <div class="grid gap-4 sm:grid-cols-3">
          <div>
            <label class="text-xs font-semibold text-slate-600">初乗り（km）</label>
            <input type="number" step="0.1" min="0" name="base_distance"
                   value="<?= e((string) ($price['base_distance'] ?? '')) ?>"
                   class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" />
          </div>
          <div>
            <label class="text-xs font-semibold text-slate-600">初乗り料金（円）</label>
            <input type="number" min="0" name="base_price"
                   value="<?= e((string) ($price['base_price'] ?? '')) ?>"
                   class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" />
          </div>
          <div>
            <label class="text-xs font-semibold text-slate-600">以降1km（円）</label>
            <input type="number" min="0" name="per_km_price"
                   value="<?= e((string) ($price['per_km_price'] ?? '')) ?>"
                   class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" />
          </div>
          <div class="sm:col-span-3">
            <label class="text-xs font-semibold text-slate-600">備考（深夜料金など）</label>
            <input name="note" value="<?= e($price['note'] ?? '') ?>"
                   class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" />
          </div>
        </div>
        <button type="submit" class="rounded-xl bg-brand px-6 py-2.5 text-sm font-bold text-white hover:bg-blue-800">保存</button>
      </form>
    </section>

    <!-- イベント -->
    <section id="events" class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-lg font-bold text-slate-900">本日のイベント・待機状況</h2>
      <form method="post" class="mt-4 space-y-4">
        <input type="hidden" name="csrf_token" value="<?= e(csrf_token()) ?>" />
        <input type="hidden" name="action" value="event" />
        <label class="flex items-center gap-2">
          <input type="checkbox" name="is_active" value="1" <?= !empty($event['is_active']) ? 'checked' : '' ?>
                 class="h-4 w-4 rounded border-slate-300 text-brand" />
          <span class="text-sm font-semibold">本日営業中</span>
        </label>
        <div>
          <label class="text-xs font-semibold text-slate-600">待機ドライバー数</label>
          <input type="number" min="0" name="drivers_available"
                 value="<?= e((string) ($event['drivers_available'] ?? '0')) ?>"
                 class="mt-1 w-full max-w-xs rounded-xl border border-slate-200 px-4 py-2.5" />
        </div>
        <div>
          <label class="text-xs font-semibold text-slate-600">イベントタイトル</label>
          <input name="event_title" value="<?= e($event['event_title'] ?? '') ?>"
                 class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5" placeholder="例: 今夜は待機3名！" />
        </div>
        <div>
          <label class="text-xs font-semibold text-slate-600">イベント本文</label>
          <textarea name="event_body" rows="4"
                    class="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5"><?= e($event['event_body'] ?? '') ?></textarea>
        </div>
        <div>
          <label class="text-xs font-semibold text-slate-600">掲載期限（任意）</label>
          <input type="datetime-local" name="expires_at"
                 value="<?= e(!empty($event['expires_at']) ? date('Y-m-d\TH:i', strtotime($event['expires_at'])) : '') ?>"
                 class="mt-1 w-full max-w-sm rounded-xl border border-slate-200 px-4 py-2.5" />
        </div>
        <button type="submit" class="rounded-xl bg-brand px-6 py-2.5 text-sm font-bold text-white hover:bg-blue-800">投稿・更新</button>
      </form>
    </section>
  </div>
</main>
<?php layout_foot(); ?>

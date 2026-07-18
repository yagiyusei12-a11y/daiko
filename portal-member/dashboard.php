<?php
declare(strict_types=1);

require_once __DIR__ . '/includes/bootstrap.php';
require_once __DIR__ . '/includes/payment.php';
require_once __DIR__ . '/includes/reviews.php';

$user = auth_require();
if (auth_is_shop($user)) {
    redirect('shop-dashboard.php');
}
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
$isPortalPremium = (int) ($company['is_premium'] ?? 0) === 1;
$premiumBillingStatus = (string) ($company['premium_billing_status'] ?? 'none');
$premiumCanApply = !in_array($premiumBillingStatus, ['pending', 'invoiced', 'paid'], true);

/** お迎え目安（分）。キー => 表示ラベル */
const WAIT_TIME_OPTIONS = [
    '' => '未設定（表示しない）',
    '10' => '約10分',
    '20' => '約20分',
    '30' => '約30分',
    '45' => '約45分',
    '60' => '60分以上',
];

if ($_SERVER['REQUEST_METHOD'] === 'POST' && csrf_verify($_POST['csrf_token'] ?? null)) {
    $action = (string) ($_POST['action'] ?? '');

    try {
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

        if ($action === 'portal_features') {
            $waitRaw = trim((string) ($_POST['wait_time_minutes'] ?? ''));
            $allowedWait = ['10', '20', '30', '45', '60'];
            $waitMinutes = in_array($waitRaw, $allowedWait, true) ? (int) $waitRaw : null;

            $stmt = db()->prepare(
                'UPDATE companies SET wait_time_minutes = ?, accept_cashless = ?, is_invoice_registered = ?, has_female_driver = ?, left_hand_drive_ok = ? WHERE id = ? AND user_id = ?'
            );
            $stmt->execute([
                $waitMinutes,
                isset($_POST['accept_cashless']) ? 1 : 0,
                isset($_POST['is_invoice_registered']) ? 1 : 0,
                isset($_POST['has_female_driver']) ? 1 : 0,
                isset($_POST['left_hand_drive_ok']) ? 1 : 0,
                $companyId,
                (int) $user['id'],
            ]);
            flash_set('success', 'お迎え目安・こだわり条件を保存しました。');
        }

        if ($action === 'premium_apply') {
            $companyFresh = find_company_by_user_id((int) $user['id']) ?: $company;
            $billingResult = invoice_create_portal_premium_billing($companyFresh, $user);
            if ($billingResult['ok']) {
                $slipNote = isset($billingResult['slip_id'])
                    ? '（請求伝票 ID: ' . (int) $billingResult['slip_id'] . '）'
                    : '';
                flash_set('success', $billingResult['message'] . $slipNote);
            } else {
                flash_set('error', $billingResult['message']);
            }
        }

        if ($action === 'line_link_generate') {
            $code = line_generate_link_code($companyId);
            flash_set('success', 'LINE連携コードを発行しました。公式アカウントに「連携 ' . $code . '」と送信してください（24時間有効）。');
        }

        if ($action === 'line_save_manual') {
            $lineUid = trim((string) ($_POST['line_user_id'] ?? ''));
            if ($lineUid === '') {
                flash_set('error', 'LINEユーザーIDを入力してください。');
            } else {
                $bind = line_bind_user_to_company($companyId, $lineUid);
                if ($bind['ok']) {
                    flash_set('success', $bind['message']);
                } else {
                    flash_set('error', $bind['message']);
                }
            }
        }

        if ($action === 'line_unlink') {
            line_unbind_company($companyId);
            flash_set('success', 'LINE連携を解除しました。');
        }

        if ($action === 'user_manner') {
            $rideRequestId = (int) ($_POST['ride_request_id'] ?? 0);
            $manner = (string) ($_POST['user_manner_rating'] ?? '');
            $notes = (string) ($_POST['driver_notes'] ?? '');
            $result = review_save_user_manner($companyId, $rideRequestId, $manner, $notes);
            flash_set($result['ok'] ? 'success' : 'error', $result['message'] ?? '保存に失敗しました。');
        }
    } catch (Throwable $e) {
        error_log('dashboard save [' . $action . ']: ' . $e->getMessage());
        flash_set('error', '保存に失敗しました。時間をおいて再度お試しください。');
    }

    redirect('dashboard.php');
}

$company = find_company_by_user_id((int) $user['id']) ?: $company;
$price = find_price_by_company_id($companyId) ?? $price;
$event = find_event_by_company_id($companyId) ?? $event;

$success = flash_get('success');
$error = flash_get('error');
$portalDetail = resolve_company_portal_detail($company);
$lineCfg = line_messaging_config();
$lineEnabled = line_messaging_enabled();
$lineLinked = trim((string) ($company['line_user_id'] ?? '')) !== '';
$lineLinkCode = (string) ($company['line_link_code'] ?? '');
$lineBotId = $lineCfg['bot_id'] !== '' ? ltrim($lineCfg['bot_id'], '@') : '';
$salesSummary = payment_company_sales_summary($companyId);
$salesRows = payment_company_recent_transactions($companyId, 15);
$commissionRate = (float) ($company['commission_rate'] ?? 10.0);

layout_head('マイページ');
?>
<header class="member-neo-header border-b border-slate-800">
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

<main class="member-neo-layout mx-auto max-w-6xl">
  <aside class="member-neo-sidebar mb-8 lg:mb-0">
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

      <nav class="member-neo-glass member-neo-nav p-4 text-sm">
        <p class="font-semibold text-slate-800">メニュー</p>
        <ul class="mt-2 space-y-1 text-slate-600">
          <li><a href="#profile" class="block rounded-lg px-2 py-1.5 hover:bg-slate-50">基本情報</a></li>
          <li><a href="#prices" class="block rounded-lg px-2 py-1.5 hover:bg-slate-50">料金体制</a></li>
          <li><a href="#events" class="block rounded-lg px-2 py-1.5 hover:bg-slate-50">本日のイベント</a></li>
          <li><a href="#portal-features" class="block rounded-lg px-2 py-1.5 hover:bg-slate-50">お迎え・こだわり</a></li>
          <li><a href="#line-integration" class="block rounded-lg px-2 py-1.5 hover:bg-green-50 font-semibold text-green-800">📱 LINE連携</a></li>
          <li><a href="#portal-premium" class="block rounded-lg px-2 py-1.5 hover:bg-amber-50 font-semibold text-amber-800">✨ プレミアム掲載</a></li>
          <li><a href="#sales-management" class="block rounded-lg px-2 py-1.5 hover:bg-indigo-50 font-semibold text-indigo-800">💰 売上管理</a></li>
          <li><a href="#demand-heatmap" class="block rounded-lg px-2 py-1.5 hover:bg-orange-50 font-semibold text-orange-800">🔥 需要ヒートマップ</a></li>
          <li><a href="#store-pop" class="block rounded-lg px-2 py-1.5 hover:bg-slate-50">店舗用POP</a></li>
        </ul>
      </nav>
    </div>
  </aside>

  <div class="member-neo-main min-w-0 flex-1 space-y-8">
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

    <!-- ポータル掲載：プレミアムプラン（有料枠） -->
    <section id="portal-premium" class="overflow-hidden rounded-2xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 via-white to-amber-50/80 p-6 shadow-md ring-2 ring-amber-200/60">
      <div class="flex flex-wrap items-start gap-2">
        <span class="inline-flex rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-1 text-xs font-bold text-white shadow-sm">✨ Premium</span>
        <?php if ($isPortalPremium): ?>
          <span class="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">掲載中</span>
        <?php endif; ?>
      </div>
      <h2 class="mt-3 text-xl font-bold text-slate-900">プレミアムプラン（有料枠）へアップグレード</h2>
      <p class="mt-2 text-sm leading-relaxed text-slate-700">
        プレミアムに登録すると、<strong class="text-amber-900">一覧で常に最上位付近に表示</strong>され、
        目立つ<strong class="text-amber-900">ゴールド枠・「おすすめ」バッジ</strong>が適用されます。
        お気に入り登録ユーザーの目に留まりやすく、リピート獲得に効果的です。
      </p>
      <ul class="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-600">
        <li>市町村一覧・都道府県ページで優先表示（プレミアム枠）</li>
        <li>業者カードにゴールドデザイン＋「✨ おすすめ」バッジ</li>
        <li>通常の「営業中」表示より上位の視認性（お気に入りの次に表示）</li>
      </ul>
      <?php if ($isPortalPremium): ?>
        <p class="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          現在、プレミアム掲載が<strong>有効</strong>です（入金確認済み）。
          <?php if (!empty($company['premium_paid_at'])): ?>
            有効化: <?= e((string) $company['premium_paid_at']) ?>
          <?php endif; ?>
        </p>
      <?php elseif ($premiumBillingStatus === 'invoiced'): ?>
        <p class="mt-4 rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-900">
          請求書を発行済みです。入金が確認されると、自動でプレミアム掲載が有効になります。
          <?php if (!empty($company['premium_due_date'])): ?>
            お支払期限: <?= e((string) $company['premium_due_date']) ?>
          <?php endif; ?>
          <?php if (!empty($company['premium_invoice_slip_id'])): ?>
            （請求伝票 ID: <?= e((string) $company['premium_invoice_slip_id']) ?>）
          <?php endif; ?>
        </p>
      <?php elseif ($premiumBillingStatus === 'overdue'): ?>
        <p class="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
          お支払期限を過ぎているため、プレミアム掲載は停止中です。入金後、自動で再開されます。
        </p>
      <?php elseif ($premiumCanApply): ?>
        <form method="post" class="mt-5">
          <input type="hidden" name="csrf_token" value="<?= e(csrf_token()) ?>" />
          <input type="hidden" name="action" value="premium_apply" />
          <button type="submit"
                  class="inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 px-6 py-3.5 text-sm font-bold text-white shadow-lg hover:from-amber-600 hover:to-orange-700 sm:w-auto">
            プレミアムプランに申し込む（請求書を自動発行）→
          </button>
        </form>
        <p class="mt-2 text-xs text-slate-500">
          ※ 申込と同時に自社請求システムへ「請求」データが登録されます。入金確認後にゴールド枠が自動で有効化されます（即時反映ではありません）。
        </p>
      <?php endif; ?>
    </section>

    <!-- LINE連携（ログイン不要で営業ステータス更新） -->
    <section id="line-integration" class="rounded-2xl border-2 border-green-300 bg-gradient-to-br from-green-50 via-white to-emerald-50/80 p-6 shadow-md">
      <div class="flex flex-wrap items-center gap-2">
        <span class="inline-flex rounded-full bg-green-600 px-3 py-1 text-xs font-bold text-white">📱 LINE</span>
        <?php if ($lineLinked): ?>
          <span class="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">連携済み</span>
        <?php endif; ?>
      </div>
      <h2 class="mt-3 text-xl font-bold text-slate-900">LINE連携（トークから1タップ更新）</h2>
      <p class="mt-2 text-sm leading-relaxed text-slate-700">
        マイページにログインしなくても、LINEのトークから<strong>「営業開始」「20分」「終了」</strong>と送るだけで
        ポータルのリアルタイム表示（緑枠・お迎え目安）を更新できます。
      </p>

      <?php if (!$lineEnabled): ?>
        <p class="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          サーバー側の LINE 設定（<code class="text-xs">LINE_CHANNEL_ACCESS_TOKEN</code> / <code class="text-xs">LINE_CHANNEL_SECRET</code>）が未設定です。管理者に .env の設定を依頼してください。
        </p>
      <?php elseif ($lineLinked): ?>
        <p class="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 break-all">
          連携中の LINE ID: <code class="text-xs"><?= e((string) $company['line_user_id']) ?></code>
        </p>
        <form method="post" class="mt-4" onsubmit="return confirm('LINE連携を解除しますか？');">
          <input type="hidden" name="csrf_token" value="<?= e(csrf_token()) ?>" />
          <input type="hidden" name="action" value="line_unlink" />
          <button type="submit" class="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            連携を解除
          </button>
        </form>
      <?php else: ?>
        <ol class="mt-4 list-decimal space-y-2 pl-5 text-sm text-slate-700">
          <?php if ($lineBotId !== ''): ?>
            <li>
              <a href="https://line.me/R/ti/p/<?= e('@' . $lineBotId) ?>" target="_blank" rel="noopener noreferrer"
                 class="font-semibold text-green-700 hover:underline">公式LINEを友だち追加</a>
            </li>
          <?php else: ?>
            <li>運転代行ポータルの公式LINEアカウントを友だち追加</li>
          <?php endif; ?>
          <li>下のボタンで<strong>連携コード</strong>を発行（24時間有効）</li>
          <li>LINEトークに <code class="rounded bg-white px-1.5 py-0.5 text-xs font-bold text-green-800">連携 <?= $lineLinkCode !== '' ? e($lineLinkCode) : 'XXXXXXXX' ?></code> と送信</li>
        </ol>
        <?php if ($lineLinkCode !== '' && !empty($company['line_link_expires_at'])): ?>
          <p class="mt-3 rounded-lg border border-green-200 bg-white px-4 py-3 text-center text-lg font-bold tracking-widest text-green-800">
            連携 <?= e($lineLinkCode) ?>
          </p>
          <p class="mt-1 text-center text-xs text-slate-500">有効期限: <?= e((string) $company['line_link_expires_at']) ?></p>
        <?php endif; ?>
        <form method="post" class="mt-4">
          <input type="hidden" name="csrf_token" value="<?= e(csrf_token()) ?>" />
          <input type="hidden" name="action" value="line_link_generate" />
          <button type="submit"
                  class="inline-flex w-full items-center justify-center rounded-xl bg-green-600 px-6 py-3.5 text-sm font-bold text-white shadow-md hover:bg-green-700 sm:w-auto">
            LINE連携コードを発行する
          </button>
        </form>
        <details class="mt-6 rounded-xl border border-slate-200 bg-white/80 p-4">
          <summary class="cursor-pointer text-sm font-semibold text-slate-700">上級者向け: LINEユーザーIDを手動登録</summary>
          <form method="post" class="mt-3 space-y-3">
            <input type="hidden" name="csrf_token" value="<?= e(csrf_token()) ?>" />
            <input type="hidden" name="action" value="line_save_manual" />
            <input name="line_user_id" placeholder="Uxxxxxxxx..."
                   class="w-full rounded-xl border border-slate-200 px-4 py-2.5 font-mono text-sm" />
            <button type="submit" class="rounded-xl bg-slate-800 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-900">
              手動で紐付け
            </button>
          </form>
        </details>
      <?php endif; ?>

      <div class="mt-6 rounded-xl border border-green-100 bg-white p-4 text-xs text-slate-600">
        <p class="font-semibold text-slate-800">LINEで送れるコマンド</p>
        <p class="mt-1"><code>営業開始</code> <code>20分</code> <code>30分</code> <code>終了</code> <code>ヘルプ</code></p>
      </div>
    </section>

    <?php
    $mannerStmt = db()->prepare(
        'SELECT id, user_name, user_phone, accepted_at, user_manner_rating
         FROM ride_requests
         WHERE accepted_company_id = ? AND status = ?
         ORDER BY accepted_at DESC
         LIMIT 8'
    );
    $mannerStmt->execute([$companyId, 'accepted']);
    $mannerRides = $mannerStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    $mannerPending = array_values(array_filter(
        $mannerRides,
        static fn (array $r): bool => empty($r['user_manner_rating'])
    ));
    ?>
    <?php if ($mannerPending !== []): ?>
    <section class="rounded-2xl border-2 border-amber-200 bg-amber-50/80 p-6 shadow-md">
      <h2 class="text-lg font-bold text-amber-900">お客様マナー評価（双方向レビュー）</h2>
      <p class="mt-1 text-sm text-amber-800">受注済みのお客様について、マナーが良かったか悪かったかを記録できます（運営の品質管理に利用）。</p>
      <ul class="mt-4 space-y-4">
        <?php foreach ($mannerPending as $mr): ?>
          <li class="rounded-xl border border-amber-100 bg-white p-4">
            <p class="text-sm font-bold text-slate-900"><?= e((string) ($mr['user_name'] ?? '')) ?>（<?= e((string) ($mr['user_phone'] ?? '')) ?>）</p>
            <p class="text-xs text-slate-500">受注: <?= e((string) ($mr['accepted_at'] ?? '')) ?> / リクエスト #<?= (int) ($mr['id'] ?? 0) ?></p>
            <form method="post" class="mt-3 flex flex-wrap items-end gap-3 text-sm">
              <input type="hidden" name="csrf_token" value="<?= e(csrf_token()) ?>" />
              <input type="hidden" name="action" value="user_manner" />
              <input type="hidden" name="ride_request_id" value="<?= (int) ($mr['id'] ?? 0) ?>" />
              <label class="inline-flex items-center gap-1">
                <input type="radio" name="user_manner_rating" value="good" required /> 👍 良い
              </label>
              <label class="inline-flex items-center gap-1 text-red-700">
                <input type="radio" name="user_manner_rating" value="bad" required /> 👎 悪い（通報）
              </label>
              <input type="text" name="driver_notes" class="min-w-[12rem] flex-1 rounded border border-slate-200 px-2 py-1" placeholder="メモ（任意）" />
              <button type="submit" class="rounded-lg bg-amber-600 px-3 py-1.5 font-bold text-white hover:bg-amber-700">記録する</button>
            </form>
          </li>
        <?php endforeach; ?>
      </ul>
    </section>
    <?php endif; ?>

    <!-- プラットフォーム経由売上・出金 -->
    <section id="sales-management" class="member-neo-glass rounded-2xl border-2 border-indigo-500/30 bg-gradient-to-br from-indigo-950/80 via-slate-900/90 to-violet-950/50 p-6 shadow-md">
      <div class="flex flex-wrap items-center gap-2">
        <span class="inline-flex rounded-full bg-indigo-600 px-3 py-1 text-xs font-bold text-white">💰 売上</span>
      </div>
      <h2 class="mt-3 text-xl font-bold text-slate-900">売上・出金管理（プラットフォーム経由）</h2>
      <p class="mt-2 text-sm text-slate-600">
        お客様のオンライン決済が完了すると、手数料（現在 <strong><?= e(number_format($commissionRate, 1)) ?>%</strong>）を差し引いた金額が振込プールに積み上がります。
      </p>
      <div class="mt-5 grid gap-4 sm:grid-cols-3">
        <div class="rounded-xl border border-indigo-100 bg-white p-4 shadow-sm">
          <p class="text-xs font-semibold text-slate-500">総売上（決済済み）</p>
          <p class="member-neo-metric mt-1">¥<?= e(number_format($salesSummary['gross_sales'])) ?></p>
          <p class="mt-1 text-xs text-slate-500"><?= (int) $salesSummary['paid_count'] ?> 件</p>
        </div>
        <div class="rounded-xl border border-indigo-100 bg-white p-4 shadow-sm">
          <p class="text-xs font-semibold text-slate-500">差し引かれた手数料</p>
          <p class="mt-1 text-2xl font-extrabold text-amber-700">¥<?= e(number_format($salesSummary['total_fees'])) ?></p>
          <p class="mt-1 text-xs text-slate-500">プラットフォーム手数料合計</p>
        </div>
        <div class="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 shadow-sm">
          <p class="text-xs font-semibold text-emerald-800">次回振込予定プール</p>
          <p class="member-neo-metric mt-1 text-emerald-400">¥<?= e(number_format($salesSummary['pool_payout'])) ?></p>
          <p class="mt-1 text-xs text-emerald-700">振込済み累計: ¥<?= e(number_format($salesSummary['transferred_payout'])) ?></p>
        </div>
      </div>
      <?php if ($salesRows === []): ?>
        <p class="mt-6 rounded-xl bg-white/80 px-4 py-6 text-center text-sm text-slate-600">
          まだプラットフォーム経由のオンライン決済はありません。LINE配車で受注後、お客様が決済するとここに表示されます。
        </p>
      <?php else: ?>
        <div class="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table class="min-w-full text-left text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
              <tr>
                <th class="px-4 py-3">日時</th>
                <th class="px-4 py-3">お客様</th>
                <th class="px-4 py-3">エリア</th>
                <th class="px-4 py-3">種別</th>
                <th class="px-4 py-3">総額</th>
                <th class="px-4 py-3">手数料</th>
                <th class="px-4 py-3">取り分</th>
                <th class="px-4 py-3">決済</th>
                <th class="px-4 py-3">振込</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <?php foreach ($salesRows as $row): ?>
                <?php
                $payStatus = (string) ($row['payment_status'] ?? 'pending');
                $payoutStatus = (string) ($row['payout_status'] ?? 'pending');
                $payLabel = match ($payStatus) {
                    'paid' => '決済済',
                    'refunded' => '返金',
                    default => '未決済',
                };
                $payoutLabel = $payoutStatus === 'transferred' ? '振込済' : 'プール中';
                $txnType = (string) ($row['transaction_type'] ?? 'ride_fare');
                $typeLabel = $txnType === 'cancellation_fee' ? 'キャンセル料' : '配車料金';
                ?>
                <tr>
                  <td class="whitespace-nowrap px-4 py-3 text-xs text-slate-500"><?= e((string) ($row['created_at'] ?? '')) ?></td>
                  <td class="px-4 py-3"><?= e((string) ($row['user_name'] ?? '')) ?></td>
                  <td class="px-4 py-3 text-xs"><?= e((string) ($row['prefecture'] ?? '') . (string) ($row['city_name'] ?? '')) ?></td>
                  <td class="px-4 py-3 text-xs"><?= e($typeLabel) ?></td>
                  <td class="px-4 py-3 font-semibold">¥<?= e(number_format((int) ($row['total_amount'] ?? 0))) ?></td>
                  <td class="px-4 py-3 text-amber-700">¥<?= e(number_format((int) ($row['platform_fee'] ?? 0))) ?></td>
                  <td class="px-4 py-3 text-emerald-700">¥<?= e(number_format((int) ($row['agency_amount'] ?? 0))) ?></td>
                  <td class="px-4 py-3"><span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold"><?= e($payLabel) ?></span></td>
                  <td class="px-4 py-3"><span class="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800"><?= e($payoutLabel) ?></span></td>
                </tr>
              <?php endforeach; ?>
            </tbody>
          </table>
        </div>
      <?php endif; ?>
    </section>

    <!-- 需要予測ヒートマップ -->
    <section id="demand-heatmap" class="portal-dashboard-heatmap-section rounded-2xl border-2 border-orange-300 bg-gradient-to-br from-orange-50 via-white to-red-50/40 p-6 shadow-md">
      <div class="flex flex-wrap items-center gap-2">
        <span class="inline-flex rounded-full bg-orange-600 px-3 py-1 text-xs font-bold text-white">🔥 需要</span>
      </div>
      <h2 class="mt-3 text-xl font-bold text-slate-900">需要予測ヒートマップ</h2>
      <p class="mt-2 text-sm text-slate-600">
        過去数時間の配車リクエストの発生地点を可視化します。赤いほど需要が集中しているエリアです。
        サージ倍率が高い時間帯は稼働で収益機会が増えます。
      </p>
      <p id="dashboard-surge-banner" class="portal-dashboard-surge-banner">読み込み中...</p>
      <div id="dashboard-heatmap-map" class="portal-dashboard-heatmap-map" role="img" aria-label="需要ヒートマップ"></div>
      <p class="mt-2 text-xs text-slate-500">
        対象エリア: <?= e($company['prefecture'] ?? '') ?> <?= e($company['city'] ?? '') ?>
        · データは pickup 座標またはエリア集計に基づきます
      </p>
    </section>

    <!-- 店舗用QR POP -->
    <section id="store-pop" class="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-6 shadow-sm">
      <h2 class="text-lg font-bold text-slate-900">店舗用・印刷POP（A4）</h2>
      <p class="mt-2 text-sm text-slate-600">
        店頭や提携飲食店に置ける「リアルタイム状況告知POP」を印刷できます。QRコードからお客様が
        <strong>あなたの店舗専用ページ</strong>へ直接アクセスし、待ち時間・営業状況を確認できます。
      </p>
      <?php if ($portalDetail): ?>
        <p class="mt-2 text-xs text-slate-500 break-all">掲載URL: <?= e($portalDetail['url']) ?></p>
      <?php else: ?>
        <p class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ポータル掲載データの反映待ちです。基本情報保存後、自動更新（最大1時間）でPOPが利用可能になります。
        </p>
      <?php endif; ?>
      <div class="mt-4 flex flex-wrap gap-3">
        <a href="pop.php" target="_blank" rel="noopener noreferrer"
           class="inline-flex items-center justify-center rounded-xl bg-brand px-6 py-3 text-sm font-bold text-white shadow-md hover:bg-blue-800">
          📄 店舗用POPを開く（印刷画面）→
        </a>
        <?php if ($portalDetail): ?>
          <a href="<?= e($portalDetail['url']) ?>" target="_blank" rel="noopener noreferrer"
             class="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-brand hover:bg-blue-50">
            掲載ページを確認
          </a>
        <?php endif; ?>
      </div>
    </section>

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

    <!-- お迎え目安・こだわり条件（ポータル掲載） -->
    <section id="portal-features" class="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-6 shadow-sm">
      <h2 class="text-lg font-bold text-slate-900">お迎え目安・こだわり条件</h2>
      <p class="mt-1 text-sm text-slate-600">
        全国ポータルに表示されます。「本日営業中」と一緒にお迎え目安が表示され、こだわり条件は業者カードにバッジで表示されます。
      </p>
      <form method="post" class="mt-4 space-y-5">
        <input type="hidden" name="csrf_token" value="<?= e(csrf_token()) ?>" />
        <input type="hidden" name="action" value="portal_features" />
        <div>
          <label for="wait_time_minutes" class="text-xs font-semibold text-slate-600">お迎え目安時間</label>
          <select id="wait_time_minutes" name="wait_time_minutes"
                  class="mt-1 w-full max-w-xs rounded-xl border border-slate-200 bg-white px-4 py-2.5">
            <?php
            $currentWait = isset($company['wait_time_minutes']) && $company['wait_time_minutes'] !== null
                ? (string) (int) $company['wait_time_minutes']
                : '';
            foreach (WAIT_TIME_OPTIONS as $value => $label):
            ?>
              <option value="<?= e($value) ?>" <?= $currentWait === $value ? 'selected' : '' ?>><?= e($label) ?></option>
            <?php endforeach; ?>
          </select>
          <p class="mt-1 text-xs text-slate-500">本日営業中のリアルタイム枠に「お迎え目安：約〇〇分」と表示されます。</p>
        </div>
        <fieldset class="space-y-3">
          <legend class="text-xs font-semibold text-slate-600">こだわり条件（複数選択可）</legend>
          <label class="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <input type="checkbox" name="accept_cashless" value="1" <?= !empty($company['accept_cashless']) ? 'checked' : '' ?>
                   class="h-4 w-4 rounded border-slate-300 text-brand" />
            <span class="text-sm font-medium">💳 キャッシュレス決済対応</span>
          </label>
          <label class="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <input type="checkbox" name="is_invoice_registered" value="1" <?= !empty($company['is_invoice_registered']) ? 'checked' : '' ?>
                   class="h-4 w-4 rounded border-slate-300 text-brand" />
            <span class="text-sm font-medium">🧾 インボイス対応</span>
          </label>
          <label class="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <input type="checkbox" name="has_female_driver" value="1" <?= !empty($company['has_female_driver']) ? 'checked' : '' ?>
                   class="h-4 w-4 rounded border-slate-300 text-brand" />
            <span class="text-sm font-medium">👩 女性ドライバー在籍</span>
          </label>
          <label class="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <input type="checkbox" name="left_hand_drive_ok" value="1" <?= !empty($company['left_hand_drive_ok']) ? 'checked' : '' ?>
                   class="h-4 w-4 rounded border-slate-300 text-brand" />
            <span class="text-sm font-medium">🚗 左ハンドル外車対応</span>
          </label>
        </fieldset>
        <button type="submit" class="rounded-xl bg-brand px-6 py-2.5 text-sm font-bold text-white hover:bg-blue-800">保存</button>
      </form>
    </section>
  </div>
</main>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js"></script>
<script>
(function () {
  var mapEl = document.getElementById("dashboard-heatmap-map");
  var bannerEl = document.getElementById("dashboard-surge-banner");
  if (!mapEl) return;

  var heatApi = <?= json_encode(rtrim((string) ($config['base_url'] ?? '/portal-member'), '/') . '/api/get_demand_heatmap.php', JSON_UNESCAPED_UNICODE) ?>;

  function loadHeatmap() {
    fetch(heatApi, { credentials: "same-origin", cache: "no-store" })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data || !data.ok) {
          if (bannerEl) bannerEl.textContent = "データを取得できませんでした";
          return;
        }
        if (bannerEl) bannerEl.textContent = data.surge_label || ("🔥 現在のサージ倍率: " + data.surge_multiplier + "倍");
        var center = data.center || [35.68, 139.76];
        var map = L.map(mapEl).setView(center, 13);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 18,
          attribution: "&copy; OpenStreetMap"
        }).addTo(map);
        var points = data.points || [];
        if (points.length > 0 && typeof L.heatLayer === "function") {
          L.heatLayer(points, { radius: 28, blur: 18, maxZoom: 17, gradient: {
            0.2: "#3b82f6", 0.5: "#eab308", 0.8: "#f97316", 1.0: "#dc2626"
          }}).addTo(map);
        }
        setTimeout(function () { map.invalidateSize(); }, 300);
      })
      .catch(function () {
        if (bannerEl) bannerEl.textContent = "ヒートマップの読み込みに失敗しました";
      });
  }

  if (window.L) {
    loadHeatmap();
  } else {
    document.addEventListener("DOMContentLoaded", loadHeatmap);
  }
})();
</script>
<?php layout_foot(); ?>

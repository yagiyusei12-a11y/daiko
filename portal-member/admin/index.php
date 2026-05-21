<?php
declare(strict_types=1);

require_once __DIR__ . '/includes/bootstrap_admin.php';
require_once dirname(__DIR__) . '/includes/reviews.php';

portal_admin_require();
portal_admin_session_start();

$success = $_SESSION['admin_flash_success'] ?? null;
$error = $_SESSION['admin_flash_error'] ?? null;
unset($_SESSION['admin_flash_success'], $_SESSION['admin_flash_error']);

$rows = db()->query(
    <<<SQL
SELECT
  c.id,
  c.name,
  c.cert_number,
  c.prefecture,
  c.city,
  c.tel,
  c.is_premium,
  c.is_suspended,
  c.premium_billing_status,
  c.line_user_id,
  c.wait_time_minutes,
  c.updated_at,
  u.email AS user_email,
  e.is_active,
  e.drivers_available
FROM companies c
LEFT JOIN users u ON u.id = c.user_id
LEFT JOIN events e ON e.company_id = c.id
ORDER BY c.id DESC
SQL
)->fetchAll(PDO::FETCH_ASSOC);

$adminUser = $_SESSION[PORTAL_ADMIN_SESSION_KEY]['username'] ?? 'admin';
$reviewAlerts = review_admin_alert_lists();
$lowRatingCompanies = $reviewAlerts['low_rating_companies'];
$badMannerRides = $reviewAlerts['bad_manner_rides'];
?>
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>マスター管理 | 加盟業者一覧</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdn.datatables.net/1.13.8/css/jquery.dataTables.min.css" />
  <style>
    .dataTables_wrapper { font-size: 0.8125rem; }
    table.dataTable tbody td { vertical-align: middle; }
    .admin-badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 9999px; font-size: 0.65rem; font-weight: 700; }
    .admin-badge--premium { background: #fef3c7; color: #92400e; }
    .admin-badge--suspended { background: #fee2e2; color: #991b1b; }
    .admin-badge--live { background: #d1fae5; color: #065f46; }
  </style>
</head>
<link rel="stylesheet" href="/portal-member/assets/member-neo.css" />
<body class="member-neo min-h-screen bg-slate-950 text-slate-100 antialiased">
<header class="border-b border-slate-200 bg-white">
  <div class="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-4">
    <div>
      <p class="text-xs font-bold text-slate-500">Super Admin</p>
      <h1 class="text-lg font-bold">加盟業者マスター管理</h1>
    </div>
    <div class="flex items-center gap-3 text-sm">
      <span class="text-slate-600"><?= htmlspecialchars((string) $adminUser, ENT_QUOTES, 'UTF-8') ?></span>
      <a href="/portal/" class="text-blue-600 hover:underline" target="_blank" rel="noopener">ポータル</a>
      <a href="logout.php" class="rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50">ログアウト</a>
    </div>
  </div>
</header>

<main class="member-neo-main mx-auto max-w-[1400px] px-4 py-6">
  <?php if ($success): ?>
    <p class="mb-4 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-800"><?= htmlspecialchars($success, ENT_QUOTES, 'UTF-8') ?></p>
  <?php endif; ?>
  <?php if ($error): ?>
    <p class="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></p>
  <?php endif; ?>

  <div class="mb-6 grid gap-4 lg:grid-cols-2">
    <section class="member-neo-glass rounded-2xl border-2 border-red-500/40 bg-red-950/40 p-4 shadow-sm sm:p-5">
      <h2 class="text-base font-bold text-red-900">⚠ 警告アラート：低評価業者（配信一時除外）</h2>
      <p class="mt-1 text-xs text-red-800">
        直近<?= (int) REVIEW_QC_RECENT_COUNT ?>件の平均が <?= REVIEW_QC_MIN_AVG ?> 未満のため、一斉配車リクエストから自動除外されています。
      </p>
      <?php if ($lowRatingCompanies === []): ?>
        <p class="mt-3 text-sm text-slate-600">該当業者はありません。</p>
      <?php else: ?>
        <ul class="mt-3 max-h-64 space-y-2 overflow-y-auto text-sm">
          <?php foreach ($lowRatingCompanies as $lc): ?>
            <li class="rounded-lg border border-red-100 bg-white px-3 py-2">
              <span class="font-bold">#<?= (int) ($lc['id'] ?? 0) ?> <?= htmlspecialchars((string) ($lc['name'] ?? ''), ENT_QUOTES, 'UTF-8') ?></span>
              <span class="text-slate-600"> — <?= htmlspecialchars((string) (($lc['prefecture'] ?? '') . ' ' . ($lc['city'] ?? '')), ENT_QUOTES, 'UTF-8') ?></span>
              <?php if (!empty($lc['rating'])): ?>
                <span class="ml-1 text-amber-700">⭐ <?= htmlspecialchars((string) $lc['rating'], ENT_QUOTES, 'UTF-8') ?> (<?= (int) ($lc['review_count'] ?? 0) ?>件)</span>
              <?php endif; ?>
              <?php if (!empty($lc['rating_qc_excluded_at'])): ?>
                <span class="block text-xs text-slate-500">除外更新: <?= htmlspecialchars((string) $lc['rating_qc_excluded_at'], ENT_QUOTES, 'UTF-8') ?></span>
              <?php endif; ?>
            </li>
          <?php endforeach; ?>
        </ul>
      <?php endif; ?>
    </section>
    <section class="rounded-2xl border-2 border-amber-200 bg-amber-50/60 p-4 shadow-sm sm:p-5">
      <h2 class="text-base font-bold text-amber-900">⚠ 警告アラート：マナー不良ユーザー</h2>
      <p class="mt-1 text-xs text-amber-800">加盟業者から「悪い」マナー評価が付いたお客様です。</p>
      <?php if ($badMannerRides === []): ?>
        <p class="mt-3 text-sm text-slate-600">該当はありません。</p>
      <?php else: ?>
        <ul class="mt-3 max-h-64 space-y-2 overflow-y-auto text-sm">
          <?php foreach ($badMannerRides as $br): ?>
            <li class="rounded-lg border border-amber-100 bg-white px-3 py-2">
              <span class="font-bold"><?= htmlspecialchars((string) ($br['user_name'] ?? ''), ENT_QUOTES, 'UTF-8') ?></span>
              <span class="text-slate-600"><?= htmlspecialchars((string) ($br['user_phone'] ?? ''), ENT_QUOTES, 'UTF-8') ?></span>
              <span class="block text-xs text-slate-500">
                報告: <?= htmlspecialchars((string) ($br['company_name'] ?? ''), ENT_QUOTES, 'UTF-8') ?>
                / #<?= (int) ($br['ride_request_id'] ?? 0) ?>
                / <?= htmlspecialchars((string) ($br['prefecture'] ?? '') . (string) ($br['city_name'] ?? ''), ENT_QUOTES, 'UTF-8') ?>
              </span>
              <?php if (!empty($br['driver_notes'])): ?>
                <span class="block text-xs text-red-700">メモ: <?= htmlspecialchars((string) $br['driver_notes'], ENT_QUOTES, 'UTF-8') ?></span>
              <?php endif; ?>
            </li>
          <?php endforeach; ?>
        </ul>
      <?php endif; ?>
    </section>
  </div>

  <div class="member-neo-glass rounded-2xl border border-slate-800 p-4 shadow-sm sm:p-6">
    <p class="text-sm text-slate-600">
      全 <strong><?= count($rows) ?></strong> 社。
      プレミアム・強制停止を変更するとポータル HTML がバックグラウンドで再生成されます。
      停止中（<code>is_suspended=1</code>）の業者は掲載から除外されます。
    </p>
    <div class="mt-4 overflow-x-auto">
      <table id="companies-table" class="display w-full text-left" style="width:100%">
        <thead>
          <tr>
            <th>ID</th>
            <th>業者名</th>
            <th>認定番号</th>
            <th>エリア</th>
            <th>会員メール</th>
            <th>状態</th>
            <th>プレミアム</th>
            <th>停止</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <?php foreach ($rows as $row): ?>
            <?php
            $isLive = !empty($row['is_active']);
            $badges = [];
            if ((int) ($row['is_premium'] ?? 0) === 1) {
                $badges[] = '<span class="admin-badge admin-badge--premium">Premium</span>';
            }
            if ((int) ($row['is_suspended'] ?? 0) === 1) {
                $badges[] = '<span class="admin-badge admin-badge--suspended">停止</span>';
            }
            if ($isLive) {
                $badges[] = '<span class="admin-badge admin-badge--live">営業中</span>';
            }
            $badgeHtml = $badges !== [] ? implode(' ', $badges) : '<span class="text-slate-400">—</span>';
            ?>
            <tr>
              <td><?= (int) $row['id'] ?></td>
              <td><?= htmlspecialchars((string) $row['name'], ENT_QUOTES, 'UTF-8') ?></td>
              <td><?= htmlspecialchars((string) $row['cert_number'], ENT_QUOTES, 'UTF-8') ?></td>
              <td><?= htmlspecialchars((string) ($row['prefecture'] . ' ' . $row['city']), ENT_QUOTES, 'UTF-8') ?></td>
              <td class="max-w-[12rem] truncate"><?= htmlspecialchars((string) ($row['user_email'] ?? '—'), ENT_QUOTES, 'UTF-8') ?></td>
              <td><?= $badgeHtml ?></td>
              <td><?= (int) ($row['is_premium'] ?? 0) === 1 ? 'ON' : 'OFF' ?></td>
              <td><?= (int) ($row['is_suspended'] ?? 0) === 1 ? 'ON' : 'OFF' ?></td>
              <td>
                <form method="post" action="company_update.php" class="flex flex-wrap items-center gap-2 text-xs">
                  <input type="hidden" name="company_id" value="<?= (int) $row['id'] ?>" />
                  <label class="inline-flex items-center gap-1">
                    <input type="checkbox" name="is_premium" value="1" <?= (int) ($row['is_premium'] ?? 0) === 1 ? 'checked' : '' ?> />
                    プレミアム
                  </label>
                  <label class="inline-flex items-center gap-1 text-red-700">
                    <input type="checkbox" name="is_suspended" value="1" <?= (int) ($row['is_suspended'] ?? 0) === 1 ? 'checked' : '' ?> />
                    停止
                  </label>
                  <button type="submit" class="rounded bg-slate-800 px-2 py-1 font-bold text-white hover:bg-slate-700"
                          onclick="return confirm('業者 #<?= (int) $row['id'] ?> を更新しますか？');">
                    保存
                  </button>
                </form>
              </td>
            </tr>
          <?php endforeach; ?>
        </tbody>
      </table>
    </div>
  </div>
</main>

<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
<script src="https://cdn.datatables.net/1.13.8/js/jquery.dataTables.min.js"></script>
<script>
  $(function () {
    $('#companies-table').DataTable({
      pageLength: 50,
      order: [[0, 'desc']],
      language: {
        url: 'https://cdn.datatables.net/plug-ins/1.13.8/i18n/ja.json'
      }
    });
  });
</script>
</body>
</html>

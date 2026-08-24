<?php
declare(strict_types=1);

/**
 * 店舗用 A4 POP（QRコード付き）— 印刷専用画面
 */
require_once __DIR__ . '/includes/bootstrap.php';
require_once __DIR__ . '/includes/portal_urls.php';

$user = auth_require();
$company = find_company_by_user_id((int) $user['id']);
if (!$company) {
    flash_set('error', '業者情報が見つかりません。');
    auth_logout();
    redirect('login.php');
}

$detail = resolve_company_portal_detail($company);
$portalTop = portal_public_base_url();
$companyName = trim((string) ($company['name'] ?? ''));
$certNumber = trim((string) ($company['cert_number'] ?? ''));
$prefecture = trim((string) ($company['prefecture'] ?? ''));
$city = trim((string) ($company['city'] ?? ''));

$detailUrl = $detail['url'] ?? '';
$hasDetail = $detailUrl !== '';

?>
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>店舗用POP | <?= e($companyName) ?></title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js" integrity="sha512-CNgIRecGo7nphbeZ04Sc13ka07paqdeTu0WR1IMolEgZmzbq9BBiCd4C9klRAUVUDk6PBizFlF4pHD77+wAGJiq6w==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
  <style>
    @page { size: A4 portrait; margin: 14mm; }
    @media print {
      body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none !important; }
      .pop-sheet { box-shadow: none !important; border: none !important; min-height: auto !important; }
    }
    .pop-sheet {
      min-height: calc(297mm - 28mm);
      max-width: 210mm;
      margin: 0 auto;
    }
    #qrcode canvas, #qrcode img { margin: 0 auto; display: block; }
  </style>
</head>
<body class="bg-slate-100 text-slate-900 antialiased">
  <div class="no-print mx-auto max-w-3xl px-4 py-4">
    <a href="dashboard.php" class="text-sm font-semibold text-blue-600 hover:underline">← マイページに戻る</a>
    <div class="mt-3 flex flex-wrap gap-2">
      <button type="button" onclick="window.print()" class="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow hover:bg-blue-700">
        印刷する（A4）
      </button>
    </div>
    <?php if (!$hasDetail): ?>
      <p class="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        ポータル掲載ページの準備中です。基本情報を保存し、ポータル自動更新（1時間以内）後に再度お試しください。
        掲載されない場合は運営までお問い合わせください。
      </p>
    <?php endif; ?>
  </div>

  <article class="pop-sheet mx-auto border border-slate-200 bg-white p-8 shadow-lg sm:p-12">
    <header class="text-center">
      <p class="text-xs font-bold tracking-widest text-blue-600 uppercase">Harunoyukoto Daiko Portal</p>
      <h1 class="mt-3 text-2xl font-extrabold leading-tight text-slate-900 sm:text-3xl">
        当店は「はるのゆこと」<br />運転代行プラットフォームに加盟しています！
      </h1>
      <p class="mt-4 text-lg font-bold text-slate-800"><?= e($companyName) ?></p>
      <?php if ($prefecture !== '' || $city !== ''): ?>
        <p class="mt-1 text-sm text-slate-600"><?= e($prefecture) ?> <?= e($city) ?><?= $certNumber !== '' ? ' · 認定 ' . e($certNumber) : '' ?></p>
      <?php endif; ?>
    </header>

    <section class="mt-10 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/50 px-6 py-8">
      <p class="mb-6 text-center text-base font-bold leading-relaxed text-slate-800">
        スマホでQRを読み込むと、<br />
        <span class="text-blue-700">現在のリアルタイムな待ち時間</span>や<br />
        <span class="text-emerald-700">営業状況</span>がその場でわかります！
      </p>
      <div id="qrcode" class="rounded-xl bg-white p-4 shadow-inner" aria-label="店舗専用ページへのQRコード"></div>
      <?php if ($hasDetail): ?>
        <p class="mt-4 break-all text-center text-xs text-slate-500"><?= e($detailUrl) ?></p>
      <?php else: ?>
        <p class="mt-4 text-center text-sm font-semibold text-amber-700">QRコードは掲載準備完了後に表示されます</p>
      <?php endif; ?>
    </section>

    <footer class="mt-10 border-t border-slate-200 pt-6 text-center text-sm text-slate-600">
      <p class="font-semibold">深夜のお帰りに、すぐ呼べる運転代行を。</p>
      <p class="mt-2">全国ポータル <?= e($portalTop) ?></p>
      <p class="mt-1 text-xs text-slate-400">印刷して店頭・提携飲食店に設置してください（A4推奨）</p>
    </footer>
  </article>

  <script>
    (function () {
      var targetUrl = <?= json_encode($detailUrl, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?>;
      var el = document.getElementById("qrcode");
      if (!targetUrl || !el || typeof QRCode === "undefined") return;
      new QRCode(el, {
        text: targetUrl,
        width: 280,
        height: 280,
        colorDark: "#0f172a",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M,
      });
    })();
  </script>
</body>
</html>

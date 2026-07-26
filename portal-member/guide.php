<?php
declare(strict_types=1);

require_once __DIR__ . '/includes/bootstrap.php';

layout_head('使い方ガイド');
?>
<main class="mx-auto max-w-3xl px-4 py-10">
  <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
    <p class="text-xs font-semibold tracking-wide text-brand">運転代行ポータル</p>
    <h1 class="mt-1 text-2xl font-bold text-slate-900">使い方ガイド</h1>
    <p class="mt-3 text-sm leading-relaxed text-slate-600">
      このページは<strong>業者会員向け</strong>の説明です。ポータル掲載・LINE更新・プレミアム枠・売上確認の流れをまとめました。
    </p>

    <nav class="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm" aria-label="目次">
      <p class="font-bold text-slate-800">目次</p>
      <ol class="mt-2 list-decimal space-y-1 pl-5 text-slate-700">
        <li><a href="#overview" class="text-brand hover:underline">全体の仕組み（何ができるか）</a></li>
        <li><a href="#start" class="text-brand hover:underline">はじめ方（登録〜掲載）</a></li>
        <li><a href="#live" class="text-brand hover:underline">本日営業中の出し方</a></li>
        <li><a href="#line" class="text-brand hover:underline">LINEからステータス更新</a></li>
        <li><a href="#premium" class="text-brand hover:underline">プレミアム掲載（ゴールド枠）</a></li>
        <li><a href="#sales" class="text-brand hover:underline">オンライン決済・売上管理</a></li>
        <li><a href="#daiko" class="text-brand hover:underline">Daiko（業務管理）との違い</a></li>
        <li><a href="#user" class="text-brand hover:underline">利用者（お客さん）向けの見方</a></li>
      </ol>
    </nav>

    <section id="overview" class="mt-10 scroll-mt-24">
      <h2 class="text-lg font-bold text-slate-900">1. 全体の仕組み</h2>
      <ul class="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
        <li><strong>公開ポータル</strong>（<a href="/portal/" class="text-brand hover:underline">/portal/</a>）… 一般の方が業者を探す一覧サイト</li>
        <li><strong>業者会員マイページ</strong>（ログイン後）… 料金・営業状況・LINE連携・プレミアム申込・売上確認</li>
        <li><strong>Daiko</strong>（別サービス）… 配車・日報・給与などの業務管理クラウド</li>
      </ul>
      <p class="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        ログイン画面に書いてある「プレミアム枠 / LINE更新 / 売上管理」は<strong>実装済み</strong>です。ログイン後のマイページ左側メニューから使えます。
      </p>
    </section>

    <section id="start" class="mt-10 scroll-mt-24">
      <h2 class="text-lg font-bold text-slate-900">2. はじめ方（登録〜掲載）</h2>
      <ol class="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
        <li><a href="register.php" class="font-semibold text-brand hover:underline">新規会員登録</a>で都道府県・認定番号・業者名・連絡先を入力</li>
        <li>登録直後にマイページへ入ります</li>
        <li>「料金体制」「本日のイベント」「お迎え・こだわり」を入力すると、ポータル側の表示が充実します</li>
        <li>一覧への反映はポータルHTMLの再生成後です（反映まで少し時間がかかる場合があります）</li>
      </ol>
      <p class="mt-3 text-sm text-slate-600">
        すでに登録済みの方は <a href="login.php" class="font-semibold text-brand hover:underline">ログイン</a>
      </p>
    </section>

    <section id="live" class="mt-10 scroll-mt-24">
      <h2 class="text-lg font-bold text-slate-900">3. 「本日営業中」の出し方</h2>
      <p class="mt-3 text-sm leading-relaxed text-slate-700">
        ポータルの「今すぐ呼べる」「本日営業中」表示は、会員が<strong>リアルタイムで営業中</strong>を配信しているときに出ます。
      </p>
      <ul class="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
        <li>マイページで営業状況・お迎え目安・料金を更新する</li>
        <li>または下の <a href="#line" class="text-brand hover:underline">LINE連携</a> で「営業開始」「20分」「終了」を送る（ログイン不要）</li>
      </ul>
    </section>

    <section id="line" class="mt-10 scroll-mt-24">
      <h2 class="text-lg font-bold text-slate-900">4. LINEからステータス更新</h2>
      <div class="mt-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-950">
        <p class="font-semibold">📱 実装済み機能です</p>
        <p class="mt-1 text-xs leading-relaxed text-green-900/90">ログイン後 → 左メニュー「LINE連携」</p>
      </div>
      <ol class="mt-4 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
        <li>マイページで「LINE連携コードを発行する」</li>
        <li>公式LINEを友だち追加</li>
        <li>トークに <code class="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-bold">連携 （発行されたコード）</code> と送信</li>
        <li>以後、次のコマンドで更新できます</li>
      </ol>
      <ul class="mt-3 space-y-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
        <li><code class="font-bold text-green-800">営業開始</code> … 本日営業中にする</li>
        <li><code class="font-bold text-green-800">20分</code>（など分数）… お迎え目安を更新</li>
        <li><code class="font-bold text-green-800">終了</code> … 営業終了</li>
        <li><code class="font-bold text-green-800">ヘルプ</code> … コマンド一覧</li>
      </ul>
    </section>

    <section id="premium" class="mt-10 scroll-mt-24">
      <h2 class="text-lg font-bold text-slate-900">5. プレミアム掲載（ゴールド枠）</h2>
      <div class="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <p class="font-semibold">✨ 実装済み機能です</p>
        <p class="mt-1 text-xs leading-relaxed text-amber-900/90">ログイン後 → 左メニュー「プレミアム掲載」</p>
      </div>
      <ul class="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
        <li>市町村・都道府県一覧で<strong>優先表示</strong>・ゴールド枠になります</li>
        <li>マイページから申し込むと請求書が自動発行されます</li>
        <li>入金確認後に有効化されます（即時ではない場合があります）</li>
      </ul>
    </section>

    <section id="sales" class="mt-10 scroll-mt-24">
      <h2 class="text-lg font-bold text-slate-900">6. オンライン決済・売上管理</h2>
      <div class="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-950">
        <p class="font-semibold">💰 実装済み機能です</p>
        <p class="mt-1 text-xs leading-relaxed text-indigo-900/90">ログイン後 → 左メニュー「売上管理」（別タブではなく、同じマイページ内のセクションです）</p>
      </div>
      <ul class="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
        <li>ポータル経由の配車リクエストでお客様がオンライン決済すると、売上がここに溜まります</li>
        <li>総売上・手数料・次回振込プールなどを確認できます</li>
        <li>まだ決済が発生していない場合は「まだありません」と表示されます（正常です）</li>
      </ul>
    </section>

    <section id="daiko" class="mt-10 scroll-mt-24">
      <h2 class="text-lg font-bold text-slate-900">7. Daiko（業務管理）との違い</h2>
      <div class="mt-3 overflow-x-auto">
        <table class="w-full min-w-[28rem] border-collapse text-left text-sm">
          <thead>
            <tr class="border-b border-slate-200 text-slate-500">
              <th class="py-2 pr-3 font-semibold">項目</th>
              <th class="py-2 pr-3 font-semibold">ポータル会員</th>
              <th class="py-2 font-semibold">Daiko</th>
            </tr>
          </thead>
          <tbody class="text-slate-700">
            <tr class="border-b border-slate-100">
              <td class="py-2 pr-3">主な目的</td>
              <td class="py-2 pr-3">ネットで見つけてもらう・呼べる状態を出す</td>
              <td class="py-2">社内の配車・日報・給与・書類</td>
            </tr>
            <tr class="border-b border-slate-100">
              <td class="py-2 pr-3">入口</td>
              <td class="py-2 pr-3"><a href="login.php" class="text-brand hover:underline">portal-member</a></td>
              <td class="py-2"><a href="https://daiko.harunoyukoto.jp/" class="text-brand hover:underline">daiko.harunoyukoto.jp</a></td>
            </tr>
            <tr>
              <td class="py-2 pr-3">料金の例</td>
              <td class="py-2 pr-3">掲載は無料登録可／プレミアムは有料枠</td>
              <td class="py-2">初期テスター月額2,980円（税込）など</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section id="user" class="mt-10 scroll-mt-24">
      <h2 class="text-lg font-bold text-slate-900">8. 利用者（お客さん）向けの見方</h2>
      <ol class="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
        <li><a href="/portal/" class="text-brand hover:underline">ポータルTOP</a>で都道府県・市区町村を選ぶ</li>
        <li>「今すぐ呼べる」フィルターやこだわり条件で絞り込む</li>
        <li>カードの「今すぐ電話」または配車リクエスト（対応エリア）を使う</li>
      </ol>
    </section>

    <div class="mt-10 flex flex-col gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:flex-wrap">
      <a href="login.php"
         class="inline-flex items-center justify-center rounded-xl bg-brand px-5 py-3 text-sm font-bold text-white no-underline hover:bg-brand-dark">
        ログインしてマイページへ
      </a>
      <a href="register.php"
         class="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-800 no-underline hover:bg-slate-50">
        新規会員登録
      </a>
      <a href="/portal/"
         class="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-600 no-underline hover:bg-slate-50">
        ポータルTOP
      </a>
    </div>
  </div>
</main>
<?php layout_foot(); ?>

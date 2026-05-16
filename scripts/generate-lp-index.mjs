import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dirname, "..", "public", "lp", "index.html");
const d = "motion".replace("motion", "div");

const html = `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Daiko｜運転代行の業務管理クラウド</title>
    <meta
      name="description"
      content="配車・日報・給与計算まで。ネット予約連携と28時間表記対応の運転代行向けクラウドシステム。"
    />
    <meta property="og:title" content="Daiko｜運転代行の業務管理クラウド" />
    <meta
      property="og:description"
      content="電話予約に追われる日々から卒業。ネット予約からペーパーレスな業務管理まで完結。"
    />
    <meta property="og:url" content="https://daiko.harunoyukoto.jp/" />
    <meta property="og:type" content="website" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="/lp/lp.css" />
  </head>
  <body>
    <a class="lp-skip" href="#main">本文へスキップ</a>

    <${d} class="lp-topbar">
      <p>運転代行店の経営者・管理者の方へ — まずは<strong>ログイン不要のデモ</strong>でお試しください</p>
    </${d}>

    <header class="lp-header">
      <${d} class="lp-header-inner">
        <a class="lp-logo" href="/">
          <span class="lp-logo-mark" aria-hidden="true"></span>
          Daiko
        </a>
        <nav class="lp-nav" aria-label="ページ内ナビゲーション">
          <a href="#about">特徴</a>
          <a href="#benefits">メリット</a>
          <a href="#effects">導入効果</a>
          <a href="#steps">使い方</a>
        </nav>
        <${d} class="lp-header-cta">
          <a class="lp-btn lp-btn--outline" href="/app/login">ログイン</a>
          <a class="lp-btn lp-btn--accent" href="#contact">お問い合わせ</a>
        </${d}>
        <button type="button" class="lp-menu-btn" id="menu-btn" aria-label="メニューを開く" aria-expanded="false">
          <span></span><span></span><span></span>
        </button>
      </${d}>
      <nav class="lp-mobile-nav" id="mobile-nav" hidden>
        <a href="#about">特徴</a>
        <a href="#benefits">メリット</a>
        <a href="#effects">導入効果</a>
        <a href="#steps">使い方</a>
        <a href="#contact">お問い合わせ</a>
        <a class="lp-btn lp-btn--primary" href="/app/">デモで試す</a>
      </nav>
    </header>

    <main id="main">
      <section class="lp-hero">
        <${d} class="lp-hero-bg" aria-hidden="true"></${d}>
        <${d} class="lp-wrap lp-hero-inner">
          <${d} class="lp-hero-copy">
            <${d} class="lp-campaign" role="note">
              <p class="lp-campaign-eyebrow">リリース記念！今だけ初期メンバー限定</p>
              <${d} class="lp-campaign-ribbon">
                <span class="lp-campaign-before">通常月額 <s>4,980円</s><small>(税抜)</small> が</span>
                <span class="lp-campaign-highlight">今なら <em>0円</em>！</span>
              </${d}>
            </${d}>
            <p class="lp-kicker">運転代行業向けクラウド</p>
            <h1>
              <span class="lp-hero-line">配車も、日報も、給与計算も。</span>
              <span class="lp-hero-line lp-hero-line--accent">運転代行のすべてを、</span>
              <span class="lp-hero-line">このシステム一つで。</span>
            </h1>
            <p class="lp-hero-benefit">面倒な運転代行の日常業務を自動化し、あなたのビジネスの<strong>売上UP</strong>と<strong>時間創出</strong>に貢献します</p>
            <p class="lp-hero-lead">
              電話予約に追われる日々から卒業。ネット予約連携からペーパーレスな業務管理まで、次世代の店舗オペレーションをひとつに。
            </p>
            <${d} class="lp-hero-cta">
              <a class="lp-btn lp-btn--campaign lp-btn--xl" href="/app/register">今すぐ無料で始める</a>
              <ul class="lp-hero-cta-notes" aria-label="ご利用の安心ポイント">
                <li>※クレジットカード登録不要</li>
                <li>※初期費用なし</li>
              </ul>
              <${d} class="lp-hero-cta-secondary">
                <a class="lp-btn lp-btn--white lp-btn--lg" href="/app/">ログイン不要のデモを見る</a>
                <a class="lp-btn lp-btn--ghost lp-btn--lg" href="#contact">導入のご相談</a>
              </${d}>
            </${d}>
            <ul class="lp-hero-tags">
              <li>専用アプリ不要</li>
              <li>28時間表記対応</li>
              <li>マルチ店舗対応</li>
            </ul>
          </${d}>
          <${d} class="lp-hero-visual" aria-hidden="true">
            <${d} class="lp-mock lp-mock--phone">
              <${d} class="lp-mock-header">
                <span class="lp-mock-dot"></span>
                <span class="lp-mock-dot"></span>
                <span class="lp-mock-dot"></span>
                <span>運行スケジュール</span>
              </${d}>
              <${d} class="lp-mock-body">
                <${d} class="lp-mock-row lp-mock-row--lane">
                  <span>未予定</span>
                  <span class="lp-mock-pill">21:45 長浜駅→自宅</span>
                </${d}>
                <${d} class="lp-mock-row">
                  <span class="lp-mock-avatar">山田</span>
                  <span class="lp-mock-pill lp-mock-pill--blue">22:15 居酒屋街</span>
                </${d}>
                <${d} class="lp-mock-row">
                  <span class="lp-mock-avatar">佐藤</span>
                  <span class="lp-mock-pill">25:30 病院送迎</span>
                </${d}>
                <${d} class="lp-mock-stats">
                  <${d}><strong>本日</strong><span>12件</span></${d}>
                  <${d}><strong>売上</strong><span>¥128,400</span></${d}>
                </${d}>
              </${d}>
            </${d}>
            <${d} class="lp-mock lp-mock--card lp-mock--float">
              <span class="lp-mock-label">タイムカード</span>
              <p class="lp-mock-time">出勤 <strong>18:05</strong> → 退勤 <strong>27:15</strong></p>
              <span class="lp-mock-badge">酒気帯びなし</span>
            </${d}>
          </${d}>
        </${d}>
      </section>

      <section class="lp-pains-hero" id="pains">
        <${d} class="lp-wrap lp-pains-hero-inner">
          <h2 class="lp-pains-hero-title">こんなお悩みありませんか？</h2>
          <ul class="lp-pains-hero-list">
            <li>電話予約と現場入力が分断され、繁忙時にオペレーションが回らない</li>
            <li>深夜帯の時刻や事業日のズレで、日報・給与・売上が合わなくなる</li>
            <li>書類・届出の作成に時間がかかり、接客や配車の本業に集中できない</li>
          </ul>
          <p class="lp-pains-hero-resolve"><span class="lp-pains-hero-resolve-label">Daikoなら、</span><strong>これらをすべて解決</strong>できます</p>
        </${d}>
      </section>

      <section class="lp-strip" aria-label="主な機能">
        <${d} class="lp-wrap lp-strip-grid">
          <article class="lp-strip-item">
            <${d} class="lp-strip-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
            </${d}>
            <h3>ネット予約</h3>
            <p>空き枠を自動計算</p>
          </article>
          <article class="lp-strip-item">
            <${d} class="lp-strip-icon lp-strip-icon--warm" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
            </${d}>
            <h3>28時間表記</h3>
            <p>事業日ロール対応</p>
          </article>
          <article class="lp-strip-item">
            <${d} class="lp-strip-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
            </${d}>
            <h3>日報・点検</h3>
            <p>スマホで入力</p>
          </article>
          <article class="lp-strip-item">
            <${d} class="lp-strip-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 8c-2.5 0-4 1.5-4 3.5S9.5 15 12 15s4-1.5 4-3.5S14.5 8 12 8zm0-6v2m0 16v2M4.2 4.2l1.4 1.4m12.8 12.8l1.4 1.4M2 12h2m16 0h2M4.2 19.8l1.4-1.4m12.8-12.8l1.4-1.4"/></svg>
            </${d}>
            <h3>給料集計</h3>
            <p>賃金ルール連動</p>
          </article>
        </${d}>
      </section>

      <section class="lp-section lp-about" id="about">
        <${d} class="lp-wrap lp-about-grid">
          <${d} class="lp-about-visual">
            <${d} class="lp-about-card">
              <h3>Daiko とは</h3>
              <p>
                運転代行店の<strong>配車・日報・勤怠・給与</strong>をひとつにまとめたクラウドです。ブラウザとスマホだけで、紙と電話に頼りがちな現場をデジタル化します。
              </p>
            </${d}>
          </${d}>
          <${d} class="lp-about-copy">
            <p class="lp-kicker lp-kicker--left">こんなお悩みありませんか？</p>
            <h2 class="lp-heading">代行業特有の「時間」と<br />「電話」に、まっすぐ向き合う。</h2>
            <${d} class="lp-about-pains">
              <article>
                <h4>「深夜の時刻は何日の扱い？」</h4>
                <p>日付変更・28時間表記で、日報と売上のズレを防ぎます。</p>
              </article>
              <article>
                <h4>電話に出られず予約を逃す</h4>
                <p>ネット予約で24時間受付。空き枠はシステムが自動計算します。</p>
              </article>
            </${d}>
          </${d}>
        </${d}>
      </section>

      <section class="lp-section lp-benefits" id="benefits">
        <${d} class="lp-wrap">
          <${d} class="lp-section-head">
            <p class="lp-kicker">4つのメリット</p>
            <h2 class="lp-heading">現場がラクになる理由</h2>
            <p class="lp-section-lead">技術仕様ではなく、店舗とドライバーに届くベネフィットを大切にしました。</p>
          </${d}>
          <${d} class="lp-benefits-grid">
            <article class="lp-benefit-card">
              <span class="lp-benefit-num">01</span>
              <h3>LINE・Web予約で<br />売上の取りこぼしを防ぐ</h3>
              <p>ゲスト用専用URLやLINEから依頼。オペレーターの電話対応を減らし、繁忙時も予約を逃しません。</p>
            </article>
            <article class="lp-benefit-card">
              <span class="lp-benefit-num">02</span>
              <h3>28時間表記・<br />事業日ロール標準対応</h3>
              <p>「26時」表記や午前5時まで前日扱いなど、深夜業の時間管理をそのまま使えます。</p>
            </article>
            <article class="lp-benefit-card">
              <span class="lp-benefit-num">03</span>
              <h3>配車から書類まで<br />オールインワン</h3>
              <p>日報・アルコール点検・持出記録・苦情管理・PDF出力で監査対応もスムーズです。</p>
            </article>
            <article class="lp-benefit-card">
              <span class="lp-benefit-num">04</span>
              <h3>マルチテナントで<br />複数店舗も安心</h3>
              <p>店舗ごとにデータ完全分離。営業時間・賃金・決済方法を個別にカスタマイズできます。</p>
            </article>
          </${d}>
        </${d}>
      </section>

      <section class="lp-section lp-effects" id="effects">
        <${d} class="lp-wrap">
          <${d} class="lp-section-head lp-section-head--light">
            <p class="lp-kicker lp-kicker--light">導入効果</p>
            <h2 class="lp-heading lp-heading--light">店舗にも、現場にも効く変化</h2>
          </${d}>
          <${d} class="lp-effects-grid">
            <article class="lp-effect">
              <${d} class="lp-effect-icon" aria-hidden="true">📈</${d}>
              <h3>売上機会の確保</h3>
              <p>ネット予約で取りこぼしを減らし、空き時間を有効活用。</p>
            </article>
            <article class="lp-effect">
              <${d} class="lp-effect-icon" aria-hidden="true">⏱</${d}>
              <h3>オペレ負荷の軽減</h3>
              <p>電話対応を削減し、ピーク時の品質を維持。</p>
            </article>
            <article class="lp-effect">
              <${d} class="lp-effect-icon" aria-hidden="true">📋</${d}>
              <h3>集計ミスの防止</h3>
              <p>事業日と28時間表記で、日報・給与のズレを抑えます。</p>
            </article>
            <article class="lp-effect">
              <${d} class="lp-effect-icon" aria-hidden="true">🏪</${d}>
              <h3>多店舗展開</h3>
              <p>同じ基盤で新店舗をスムーズに追加。</p>
            </article>
          </${d}>
        </${d}>
      </section>

      <section class="lp-section lp-steps" id="steps">
        <${d} class="lp-wrap">
          <${d} class="lp-section-head">
            <p class="lp-kicker">はじめ方</p>
            <h2 class="lp-heading">3ステップでスタート</h2>
          </${d}>
          <${d} class="lp-steps-track">
            <article class="lp-step-card">
              <span class="lp-step-badge">STEP 1</span>
              <h3>デモで体験</h3>
              <p>ログイン不要。サンプルデータ入りの環境で、画面の操作感をそのまま確認できます。</p>
              <a class="lp-link-arrow" href="/app/">デモを開く →</a>
            </article>
            <article class="lp-step-card">
              <span class="lp-step-badge">STEP 2</span>
              <h3>店舗を作成</h3>
              <p>新規テナント登録で、あなたの店舗専用の空の環境をすぐに用意できます。</p>
              <a class="lp-link-arrow" href="/app/register">新規登録 →</a>
            </article>
            <article class="lp-step-card">
              <span class="lp-step-badge">STEP 3</span>
              <h3>運用開始</h3>
              <p>従業員・車両・賃金を登録し、日々の配車と日報を記録していきます。</p>
            </article>
          </${d}>
        </${d}>
      </section>

      <section class="lp-demo-band">
        <${d} class="lp-wrap lp-demo-band-inner">
          <${d}>
            <h2>実際の画面を触って、<br class="lp-br-sm" />導入イメージを掴む</h2>
            <p>本番データとは分離したデモ環境をご用意しています。まずはお気軽にお試しください。</p>
          </${d}>
          <${d} class="lp-demo-band-actions">
            <a class="lp-btn lp-btn--white lp-btn--lg" href="/app/">デモ画面に入る</a>
            <a class="lp-btn lp-btn--outline-white lp-btn--lg" href="#contact">お問い合わせ</a>
          </${d}>
        </${d}>
      </section>

      <section class="lp-section lp-contact" id="contact">
        <${d} class="lp-wrap lp-contact-grid">
          <${d} class="lp-contact-aside">
            <p class="lp-kicker lp-kicker--left">お問い合わせ</p>
            <h2 class="lp-heading">導入のご相談・<br />デモのご案内</h2>
            <p class="lp-contact-lead">フォーム送信後、内容を確認のうえご連絡いたします。</p>
            <ul class="lp-contact-notes">
              <li>デモはログイン不要で今すぐお試し可能です</li>
              <li>新規テナント登録で、空の店舗環境を作成できます</li>
            </ul>
          </${d}>
          <${d} class="lp-contact-form-wrap">
            <${d} id="form-msg" class="lp-form-msg" role="status" aria-live="polite"></${d}>
            <form class="lp-form" id="inquiry-form" novalidate>
              <${d} class="lp-hp" aria-hidden="true">
                <label for="website">Website</label>
                <input type="text" id="website" name="website" tabindex="-1" autocomplete="off" />
              </${d}>
              <${d} class="lp-form-row">
                <${d} class="lp-form-field">
                  <label for="companyName">店舗・会社名<span class="req">必須</span></label>
                  <input type="text" id="companyName" name="companyName" required maxlength="120" autocomplete="organization" />
                </${d}>
                <${d} class="lp-form-field">
                  <label for="contactName">お名前<span class="req">必須</span></label>
                  <input type="text" id="contactName" name="contactName" required maxlength="80" autocomplete="name" />
                </${d}>
              </${d}>
              <${d} class="lp-form-row">
                <${d} class="lp-form-field">
                  <label for="email">メールアドレス<span class="req">必須</span></label>
                  <input type="email" id="email" name="email" required maxlength="254" autocomplete="email" />
                </${d}>
                <${d} class="lp-form-field">
                  <label for="phone">電話番号</label>
                  <input type="tel" id="phone" name="phone" maxlength="30" autocomplete="tel" />
                </${d}>
              </${d}>
              <${d} class="lp-form-field">
                <label for="message">お問い合わせ内容<span class="req">必須</span></label>
                <textarea id="message" name="message" required maxlength="4000" placeholder="導入時期や店舗数など、お気軽にご記入ください"></textarea>
              </${d}>
              <label class="lp-check">
                <input type="checkbox" id="privacyAgreed" name="privacyAgreed" required value="1" />
                <span>お預かりした情報はお問い合わせ対応のみに利用し、第三者へ提供しません。</span>
              </label>
              <button type="submit" class="lp-btn lp-btn--accent lp-btn--lg lp-btn--block" id="submit-btn">送信する</button>
            </form>
          </${d}>
        </${d}>
      </section>
    </main>

    <footer class="lp-footer">
      <${d} class="lp-wrap lp-footer-inner">
        <a class="lp-logo lp-logo--footer" href="/">Daiko</a>
        <nav class="lp-footer-nav" aria-label="フッターリンク">
          <a href="/app/">デモ</a>
          <a href="/app/login">ログイン</a>
          <a href="/app/register">新規登録</a>
        </nav>
        <p class="lp-footer-copy">© Daiko — 運転代行向け業務管理クラウド</p>
      </${d}>
    </footer>

    <script src="/lp/lp.js" defer></script>
  </body>
</html>
`;

fs.writeFileSync(out, html, "utf8");
console.log("Wrote", out);

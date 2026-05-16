/**
 * LP に画面紹介セクションを挿入（generate-lp-index 後でも可）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = path.join(root, "public", "lp", "index.html");
const d = "div";

let html = fs.readFileSync(indexPath, "utf8");

if (html.includes('id="screenshots"')) {
  console.log("showcase section already present");
  process.exit(0);
}

const showcase = `
      <section class="lp-section lp-showcase" id="screenshots">
        <${d} class="lp-wrap">
          <${d} class="lp-section-head">
            <p class="lp-kicker">画面紹介</p>
            <h2 class="lp-heading">実際の画面で、できることを確認</h2>
            <p class="lp-section-lead">
              デモ環境のスクリーンショットです。書類作成から現場の運行入力、提出用PDFまで、運転代行店の業務をひとつにまとめています。
            </p>
          </${d}>

          <article class="lp-showcase-block">
            <${d} class="lp-showcase-media">
              <img
                src="/lp/screenshots/feature-documents.png"
                alt="書類を作る画面。日報・アルコール点検・変更届出書などをタブで切り替え"
                width="900"
                height="520"
                loading="lazy"
                decoding="async"
              />
            </${d}>
            <${d} class="lp-showcase-copy">
              <span class="lp-showcase-tag">書類・帳票</span>
              <h3>法定帳票をタブひとつで作成</h3>
              <p class="lp-showcase-lead">
                日報・アルコール点検・従業員名簿・変更届出書など、運転代行に必要な書類を「書類を作る」から一元管理。変更項目を選ぶと必要な入力欄だけが表示されます。
              </p>
              <ul class="lp-showcase-list">
                <li><strong>機能</strong>事業者情報・随伴車リストから自動入力。内容を直してPDF保存。</li>
                <li><strong>機能</strong>変更届（共済更新・随伴車入替・屋号変更など）に対応。</li>
                <li><strong>メリット</strong>手書き・Excel転記の手間を削減し、提出期限に間に合わせやすくなります。</li>
                <li><strong>メリット</strong>マスタデータと連動するため、記入ミスや住所の食い違いを防げます。</li>
              </ul>
            </${d}>
          </article>

          <article class="lp-showcase-block lp-showcase-block--reverse">
            <${d} class="lp-showcase-media">
              <img
                src="/lp/screenshots/feature-trip-add.png"
                alt="運行を追加する画面。依頼者・メーター・開始時刻・GPS入力"
                width="420"
                height="780"
                loading="lazy"
                decoding="async"
              />
            </${d}>
            <${d} class="lp-showcase-copy">
              <span class="lp-showcase-tag">現場入力</span>
              <h3>スマホから運行開始をサクッと記録</h3>
              <p class="lp-showcase-lead">
                ドライバー向けの「運行を追加」画面。スケジュールから予約内容を呼び出し、メーター・時刻・依頼場所を入力して送信すると、運行一覧にすぐ反映されます。
              </p>
              <ul class="lp-showcase-list">
                <li><strong>機能</strong>「スケジュールから入力」「現在時刻を開始にセット」「GPSで町名を入力」。</li>
                <li><strong>機能</strong>開始時刻に事業日換算を表示（28時間表記・日付変更に対応）。</li>
                <li><strong>メリット</strong>電話受付と現場記録の二重入力が減り、オペレーター負荷を軽減。</li>
                <li><strong>メリット</strong>深夜帯でも正しい事業日に紐づくため、日報・売上のズレを抑えられます。</li>
              </ul>
            </${d}>
          </article>

          <article class="lp-showcase-block">
            <${d} class="lp-showcase-media lp-showcase-media--pdf">
              <img
                src="/lp/screenshots/feature-change-form-pdf.png"
                alt="変更届出書のPDF出力サンプル。架空県公安委員会宛の様式"
                width="640"
                height="900"
                loading="lazy"
                decoding="async"
              />
            </${d}>
            <${d} class="lp-showcase-copy">
              <span class="lp-showcase-tag">PDF出力</span>
              <h3>公安委員会提出用の様式をそのまま出力</h3>
              <p class="lp-showcase-lead">
                画面上で入力した内容を、運転代行業の適正化に関する法律に沿った変更届出書の体裁でPDF化。印刷して提出できます（デモ画面のデータはすべて架空です）。
              </p>
              <ul class="lp-showcase-list">
                <li><strong>機能</strong>届出日・変更日・変更項目・新旧対照表をフォームから自動反映。</li>
                <li><strong>機能</strong>受託自動車共済契約の更新など、よくある届出パターンに対応。</li>
                <li><strong>メリット</strong>Wordや手書きの書式調整が不要で、提出物の品質を一定に保てます。</li>
                <li><strong>メリット</strong>更新時期のたびに同じ手順で再出力でき、事務担当の引き継ぎも楽になります。</li>
              </ul>
              <p class="lp-showcase-cta">
                <a class="lp-btn lp-btn--primary" href="/app/">デモで書類作成を試す</a>
              </p>
            </${d}>
          </article>
        </${d}>
      </section>
`;

const anchor = `<section class="lp-section lp-about" id="about">`;
if (!html.includes(anchor)) {
  console.error("anchor not found");
  process.exit(1);
}
html = html.replace(anchor, showcase + "\n      " + anchor);

html = html.replace(
  '<a href="#about">特徴</a>',
  '<a href="#screenshots">画面</a>\n          <a href="#about">特徴</a>',
);
html = html.replace(
  /<a href="#about">特徴<\/a>\n        <a href="#benefits">メリット<\/a>/,
  '<a href="#screenshots">画面</a>\n        <a href="#about">特徴</a>\n        <a href="#benefits">メリット</a>',
);

fs.writeFileSync(indexPath, html, "utf8");
console.log("patched", indexPath);

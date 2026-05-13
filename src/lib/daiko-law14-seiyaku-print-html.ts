/** 自動車運転代行業の業務の適正化に関する法律第14条第1項各号該当非該当の誓約書（印刷用 HTML・A4 縦）。 */

import { PRINT_BUSINESS_BASE_CSS } from "./print-business-theme.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function splitYmd(ymd: string): { y: string; m: string; d: string } {
  const mm = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!mm) return { y: "", m: "", d: "" };
  return { y: mm[1], m: String(Number(mm[2])), d: String(Number(mm[3])) };
}

/** 既定の「１〜５」行を検出できればリスト化（字下げ）。それ以外はエスケープ全文をそのまま表示。 */
function formatPledgeBodyHtml(raw: string): string {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const itemRe = /^([１２３４５])[　 \t]*(.*)$/;
  type Item = { mark: string; text: string };
  const intro: string[] = [];
  const items: Item[] = [];
  let seenItem = false;

  for (const line of lines) {
    const hit = line.match(itemRe);
    if (hit && hit[1] != null && hit[2] !== undefined) {
      seenItem = true;
      items.push({ mark: hit[1], text: hit[2] });
    } else if (seenItem && items.length > 0) {
      const t = line.trimEnd();
      if (t.trim() === "") continue;
      const last = items[items.length - 1];
      last.text = last.text ? `${last.text}\n${t}` : t;
    } else {
      intro.push(line);
    }
  }

  if (items.length === 0) {
    return `<div class="seiyaku-body seiyaku-body--raw">${esc(raw).replace(/\n/g, "<br/>\n")}</div>`;
  }

  const introBlock = intro.join("\n").trim();
  const introHtml = introBlock
    ? `<p class="seiyaku-intro">${esc(introBlock).replace(/\n/g, "<br/>\n")}</p>`
    : "";

  const itemsHtml = items
    .map((it) => {
      const body = esc(it.text).replace(/\n/g, "<br/>\n");
      return `<li class="seiyaku-item"><span class="seiyaku-item-mark">${esc(it.mark)}</span><span class="seiyaku-item-body">${body}</span></li>`;
    })
    .join("\n");

  return `${introHtml}\n<ul class="seiyaku-item-list">${itemsHtml}\n</ul>`;
}

const SEIYAKU_CSS = `${PRINT_BUSINESS_BASE_CSS}
@page { size: A4 portrait; margin: 14mm 16mm; }
.seiyaku-doc {
  width: 178mm;
  max-width: 100%;
  margin: 0 auto;
  padding: 0;
  color: var(--pd-ink);
  font-size: 10pt;
  line-height: 1.65;
}
.seiyaku-doc .seiyaku-head {
  text-align: right;
  margin: 0 0 10mm;
  font-size: 10.5pt;
  line-height: 1.75;
}
.seiyaku-doc .seiyaku-head div {
  white-space: pre-wrap;
  word-break: break-word;
}
.seiyaku-doc h1 {
  margin: 0 0 8mm;
  text-align: center;
  font-size: 20pt;
  font-weight: 800;
  letter-spacing: 0.35em;
  text-indent: 0.35em;
}
.seiyaku-doc .seiyaku-prose {
  margin: 0 0 8mm;
  font-size: 10pt;
  line-height: 1.75;
}
.seiyaku-doc .seiyaku-intro {
  margin: 0 0 1em;
  text-align: justify;
  word-break: break-word;
}
.seiyaku-doc .seiyaku-item-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.seiyaku-doc .seiyaku-item {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 0.45em;
  margin: 0 0 0.65em;
  text-align: justify;
  word-break: break-word;
}
.seiyaku-doc .seiyaku-item-mark {
  flex: 0 0 1.35em;
  font-weight: 700;
}
.seiyaku-doc .seiyaku-item-body {
  flex: 1;
  min-width: 0;
}
.seiyaku-doc .seiyaku-body--raw {
  text-align: justify;
  word-break: break-word;
}
.seiyaku-doc .seiyaku-date {
  margin: 10mm 0 6mm;
  text-align: right;
  font-size: 11pt;
  letter-spacing: 0.06em;
}
.seiyaku-doc .seiyaku-date .num {
  font-variant-numeric: tabular-nums;
  padding: 0 0.08em;
}
.seiyaku-doc .seiyaku-footer-fields {
  margin-top: 6mm;
}
.seiyaku-doc .seiyaku-field-row {
  display: flex;
  align-items: flex-end;
  gap: 0.55em;
  margin-top: 4.5mm;
}
.seiyaku-doc .seiyaku-field-lbl {
  font-weight: 700;
  font-size: 10pt;
  flex-shrink: 0;
}
.seiyaku-doc .seiyaku-field-line {
  flex: 1;
  min-width: 0;
  border-bottom: 0.1rem solid var(--pd-ink);
  min-height: 1.35em;
  padding: 0.1em 0.2em 0.2em;
  font-size: 10.5pt;
  word-break: break-word;
}
.seiyaku-doc .seiyaku-field-row--name .seiyaku-field-line {
  margin-right: 0;
}
.seiyaku-doc .seiyaku-inkan {
  flex-shrink: 0;
  font-size: 15pt;
  font-weight: 700;
  padding: 0 0 0.15em 0.25em;
  line-height: 1;
}
`;

function buildOneSheet(args: {
  companyLine: string;
  representativeLine: string;
  pledgeYmd: string;
  pledgeBody: string;
  signerName: string;
  signerAddress: string;
}): string {
  const { y, m, d } = splitYmd(args.pledgeYmd);
  const yDisp = y || "　　　";
  const mDisp = m || "　　";
  const dDisp = d || "　　";
  return `<article class="pd-doc seiyaku-doc">
  <header class="seiyaku-head">
    <div>${esc(args.companyLine)}</div>
    <div>${esc(args.representativeLine)}</div>
  </header>
  <h1>誓約書</h1>
  <div class="seiyaku-prose">${formatPledgeBodyHtml(args.pledgeBody)}</div>
  <p class="seiyaku-date"><span class="num">${esc(yDisp)}</span>年　<span class="num">${esc(mDisp)}</span>月　<span class="num">${esc(dDisp)}</span>日</p>
  <div class="seiyaku-footer-fields">
    <div class="seiyaku-field-row">
      <span class="seiyaku-field-lbl">住所</span>
      <span class="seiyaku-field-line">${esc(args.signerAddress)}</span>
    </div>
    <div class="seiyaku-field-row seiyaku-field-row--name">
      <span class="seiyaku-field-lbl">氏名</span>
      <span class="seiyaku-field-line">${esc(args.signerName)}</span>
      <span class="seiyaku-inkan" aria-hidden="true">㊞</span>
    </div>
  </div>
</article>`;
}

export function buildDaikoLaw14SeiyakuPrintHtml(args: {
  companyLine: string;
  representativeLine: string;
  pledgeYmd: string;
  pledgeBody: string;
  sheets: { signerName: string; signerAddress: string }[];
}): string {
  const inner =
    args.sheets.length === 0
      ? `<article class="pd-doc seiyaku-doc"><p>印刷対象がありません。</p></article>`
      : args.sheets
          .map((s) =>
            buildOneSheet({
              companyLine: args.companyLine,
              representativeLine: args.representativeLine,
              pledgeYmd: args.pledgeYmd,
              pledgeBody: args.pledgeBody,
              signerName: s.signerName,
              signerAddress: s.signerAddress,
            }),
          )
          .join("\n");

  return `<!DOCTYPE html><html lang="ja"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=1280"/>
<title>運転代行業法第14条第1項 誓約書</title>
<style>${SEIYAKU_CSS}</style>
</head><body class="pd-body">
<div class="pd-toolbar no-print"><button type="button" onclick="window.print()">印刷</button></div>
${inner}
<p class="pd-hint no-print">用紙は A4 縦・余白はブラウザの印刷設定で調整してください。PDF 保存も印刷ダイアログから行えます。</p>
</body></html>`;
}

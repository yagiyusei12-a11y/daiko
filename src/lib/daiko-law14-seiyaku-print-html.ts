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
  const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return { y: "", m: "", d: "" };
  return { y: m[1], m: String(Number(m[2])), d: String(Number(m[3])) };
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
.seiyaku-doc .seiyaku-body {
  margin: 0 0 8mm;
  white-space: pre-wrap;
  word-break: break-word;
  text-align: justify;
  font-size: 10pt;
  line-height: 1.75;
}
.seiyaku-doc .seiyaku-date {
  margin: 10mm 0 6mm;
  text-align: right;
  font-size: 11pt;
  letter-spacing: 0.06em;
}
.seiyaku-doc .seiyaku-date .num {
  font-variant-numeric: tabular-nums;
  padding: 0 0.15em;
}
.seiyaku-doc .seiyaku-block {
  margin-top: 5mm;
}
.seiyaku-doc .seiyaku-lbl {
  font-weight: 700;
  font-size: 10pt;
  margin-bottom: 2mm;
}
.seiyaku-doc .seiyaku-val {
  min-height: 2.8em;
  padding: 3mm 4mm;
  border: 1px solid var(--pd-line-strong);
  background: #fff;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 10pt;
}
.seiyaku-doc .seiyaku-name-row {
  display: flex;
  align-items: flex-end;
  gap: 6mm;
  margin-top: 5mm;
}
.seiyaku-doc .seiyaku-name-row .grow {
  flex: 1;
  min-width: 0;
}
.seiyaku-doc .seiyaku-inkan {
  flex-shrink: 0;
  font-size: 16pt;
  font-weight: 700;
  padding: 0 2mm 1mm;
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
  <div class="seiyaku-body">${esc(args.pledgeBody)}</div>
  <p class="seiyaku-date"><span class="num">${esc(yDisp)}</span>年　<span class="num">${esc(mDisp)}</span>月　<span class="num">${esc(dDisp)}</span>日</p>
  <div class="seiyaku-block">
    <div class="seiyaku-lbl">住所</div>
    <div class="seiyaku-val">${esc(args.signerAddress)}</div>
  </div>
  <div class="seiyaku-block seiyaku-name-row">
    <div class="grow">
      <div class="seiyaku-lbl">氏名</div>
      <div class="seiyaku-val">${esc(args.signerName)}</div>
    </div>
    <div class="seiyaku-inkan" aria-hidden="true">㊞</div>
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
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>運転代行業法第14条第1項 誓約書</title>
<style>${SEIYAKU_CSS}</style>
</head><body class="pd-body">
<div class="pd-toolbar no-print"><button type="button" onclick="window.print()">印刷</button></div>
${inner}
<p class="pd-hint no-print">用紙は A4 縦・余白はブラウザの印刷設定で調整してください。PDF 保存も印刷ダイアログから行えます。</p>
</body></html>`;
}

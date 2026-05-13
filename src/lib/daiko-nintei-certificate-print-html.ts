/** 自動車運転代行業 認定証（様式イメージ・印刷用 HTML・A4 縦）。 */

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

/** 「第12号」「12」などから 第 と 号 のあいだに入れる表記を得る */
function normalizeCertNumberMiddle(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  const m = t.match(/第\s*([^号]*)号/u);
  if (m) return (m[1] ?? "").trim();
  return t.replace(/^第\s*/u, "").replace(/\s*号$/u, "").trim();
}

const NINTEI_CSS = `${PRINT_BUSINESS_BASE_CSS}
@page { size: A4 portrait; margin: 18mm 20mm; }
.nt-doc {
  width: 170mm;
  max-width: 100%;
  margin: 0 auto;
  padding: 0;
  color: var(--pd-ink);
}
.nt-doc .nt-titles {
  text-align: center;
  margin: 0 0 10mm;
}
.nt-doc .nt-titles .nt-h1 {
  margin: 0;
  font-size: 18pt;
  font-weight: 800;
  letter-spacing: 0.12em;
}
.nt-doc .nt-titles .nt-h2 {
  margin: 2mm 0 0;
  font-size: 15pt;
  font-weight: 700;
  letter-spacing: 0.35em;
  text-indent: 0.35em;
}
.nt-doc .nt-tbl {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  border: 1.5px solid var(--pd-line-strong);
  font-size: 11pt;
}
.nt-doc .nt-tbl th,
.nt-doc .nt-tbl td {
  border: 1px solid var(--pd-line-strong);
  padding: 5mm 4mm;
  vertical-align: middle;
  word-break: break-word;
}
.nt-doc .nt-tbl th {
  width: 32%;
  background: var(--pd-fill-label);
  font-weight: 700;
  text-align: center;
  line-height: 1.45;
}
.nt-doc .nt-tbl td {
  background: #fff;
  text-align: left;
  min-height: 12mm;
}
.nt-doc .nt-cert-line {
  font-size: 11pt;
  letter-spacing: 0.04em;
}
.nt-doc .nt-cert-line .nt-gap {
  display: inline-block;
  min-width: 2.5em;
  border-bottom: 1px solid var(--pd-ink);
  margin: 0 0.2em;
  vertical-align: baseline;
  min-height: 1.1em;
}
.nt-doc .nt-date-line {
  font-size: 11pt;
  font-variant-numeric: tabular-nums;
}
.nt-doc .nt-date-line .num {
  padding: 0 0.12em;
}
`;

export function buildDaikoNinteiCertificatePrintHtml(args: {
  issuingAuthorityDisplay: string;
  certificationNumberMiddle: string;
  certificationDateYmd: string;
  nameOrTitle: string;
  location: string;
}): string {
  const { y, m, d } = splitYmd(args.certificationDateYmd);
  const yDisp = y ? `${y}` : "";
  const mDisp = m ? `${m}` : "";
  const dDisp = d ? `${d}` : "";
  const mid = normalizeCertNumberMiddle(args.certificationNumberMiddle);

  const dateInner =
    yDisp && mDisp && dDisp
      ? `<span class="num">${esc(yDisp)}</span>年　<span class="num">${esc(mDisp)}</span>月　<span class="num">${esc(dDisp)}</span>日`
      : "年　　　　月　　　日";

  const body = `<article class="pd-doc nt-doc">
  <div class="nt-titles">
    <p class="nt-h1">自動車運転代行業</p>
    <p class="nt-h2">認定証</p>
  </div>
  <table class="nt-tbl" role="presentation">
    <tbody>
      <tr>
        <th>認定をした<br/>公安委員会</th>
        <td>${esc(args.issuingAuthorityDisplay)}</td>
      </tr>
      <tr>
        <th>認定番号</th>
        <td class="nt-cert-line">第　<span class="nt-gap">${mid ? esc(mid) : "&nbsp;"}</span>　号</td>
      </tr>
      <tr>
        <th>認定年月日</th>
        <td class="nt-date-line">${dateInner}</td>
      </tr>
      <tr>
        <th>氏名又は名称</th>
        <td>${esc(args.nameOrTitle)}</td>
      </tr>
      <tr>
        <th>所在地</th>
        <td>${esc(args.location)}</td>
      </tr>
    </tbody>
  </table>
</article>`;

  return `<!DOCTYPE html><html lang="ja"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=1280"/>
<title>自動車運転代行業 認定証</title>
<style>${NINTEI_CSS}</style>
</head><body class="pd-body">
<div class="pd-toolbar no-print"><button type="button" onclick="window.print()">印刷</button></div>
${body}
<p class="pd-hint no-print">用紙は A4 縦です。ここで直した内容はマスタには保存されません（印刷用のみ）。</p>
</body></html>`;
}

/**
 * 苦情処理簿 PDF（A4 縦）— 1 件につき 1 ページ。
 */

export type ComplaintLedgerPrintItem = {
  receivedAtDisplay: string;
  receivedBy: string;
  driverName: string;
  placeOrSection: string;
  complainantName: string;
  complainantAddress: string;
  complainantContact: string;
  detail: string;
  causeAnalysis: string;
  rebuttal: string;
  correctiveAction: string;
  handlerName: string;
  completedOnDisplay: string;
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{font-family:"Noto Sans JP","Hiragino Kaku Gothic ProN",Meiryo,sans-serif;font-size:9pt;color:#000;background:#fff;
  -webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{size:A4 portrait;margin:12mm 14mm}
.cl-page{break-after:page;page-break-after:always;padding:0}
.cl-page:last-child{break-after:auto;page-break-after:auto}
.cl-title{text-align:center;font-size:15pt;letter-spacing:0.35em;margin-bottom:8pt;font-weight:600}
.cl-tbl{width:100%;border-collapse:collapse;table-layout:fixed;border:1.5px solid #222}
.cl-tbl td{border:1px solid #333;padding:5px 7px;vertical-align:top;line-height:1.45;word-break:break-word}
.cl-lbl{width:22%;background:#BDD7EE;text-align:center;font-size:8.5pt;font-weight:500}
.cl-val{width:78%;min-height:1.6em;white-space:pre-wrap}
.cl-val--tall{min-height:4.5em}
@media screen{
  body{background:#e5e7eb;padding:16px}
  .cl-page{background:#fff;max-width:210mm;margin:0 auto 24px;padding:12mm 14mm;box-shadow:0 2px 12px rgba(0,0,0,.1)}
  .cl-page:last-child{margin-bottom:12px}
  .no-print{text-align:center;margin-bottom:12px}
  .no-print button{font:inherit;padding:6px 20px;background:#1e3a8a;color:#fff;border:none;border-radius:4px;cursor:pointer}
}
@media print{.no-print{display:none!important}}
`;

function row(label: string, value: string, tall = false): string {
  const cls = tall ? "cl-val cl-val--tall" : "cl-val";
  return `<tr><td class="cl-lbl">${esc(label)}</td><td class="${cls}">${esc(value)}</td></tr>`;
}

function onePage(it: ComplaintLedgerPrintItem): string {
  return `<div class="cl-page">
  <h1 class="cl-title">苦情処理簿</h1>
  <table class="cl-tbl">
    <tbody>
      ${row("苦情受付日時", it.receivedAtDisplay)}
      ${row("受付者", it.receivedBy)}
      ${row("運転者氏名", it.driverName)}
      ${row("苦情発生場所または区間", it.placeOrSection)}
      ${row("苦情申出者（氏名）", it.complainantName)}
      ${row("苦情申出者（住所）", it.complainantAddress)}
      ${row("苦情申出者（連絡先）", it.complainantContact)}
      ${row("苦情の内容", it.detail, true)}
      ${row("原因究明の結果", it.causeAnalysis, true)}
      ${row("苦情に対する弁明内容", it.rebuttal, true)}
      ${row("改善措置", it.correctiveAction, true)}
      ${row("苦情処理担当者", it.handlerName)}
      ${row("苦情処理完了年月日", it.completedOnDisplay)}
    </tbody>
  </table>
</div>`;
}

export function buildComplaintLedgerPrintHtml(items: ComplaintLedgerPrintItem[]): string {
  const body =
    items.length === 0
      ? `<div class="cl-page"><p style="text-align:center;padding:2rem;color:#666">出力対象の苦情がありません。</p></div>`
      : items.map(onePage).join("\n");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=1280"/>
<title>苦情処理簿</title>
<style>${CSS}</style>
</head>
<body>
<div class="no-print"><button type="button" onclick="window.print()">印刷</button></div>
${body}
</body>
</html>`;
}

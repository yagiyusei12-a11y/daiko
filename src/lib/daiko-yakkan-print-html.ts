/** 標準自動車運転代行業約款の印刷用 HTML（A4 縦・編集済み本文をそのまま反映）。 */

import { PRINT_BUSINESS_BASE_CSS } from "./print-business-theme.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const YAKKAN_CSS = `${PRINT_BUSINESS_BASE_CSS}
@page { size: A4 portrait; margin: 12mm 14mm; }
.yk-doc {
  width: 182mm;
  max-width: 100%;
  margin: 0 auto;
  padding: 0;
  color: var(--pd-ink);
}
.yk-doc .yk-body {
  margin: 0;
  font-size: 9.5pt;
  line-height: 1.65;
  text-align: justify;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  font-family: "Noto Serif CJK JP","Noto Serif JP","BIZ UDPMincho","BIZ UD Mincho","Hiragino Mincho ProN",YuMincho,"Yu Mincho","MS Mincho",serif;
}
`;

export function buildDaikoYakkanPrintHtml(args: { bodyText: string }): string {
  const body = `<article class="pd-doc yk-doc">
<div class="yk-body">${esc(args.bodyText)}</div>
</article>`;

  return `<!DOCTYPE html><html lang="ja"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=1280"/>
<title>標準自動車運転代行業約款</title>
<style>${YAKKAN_CSS}</style>
</head><body class="pd-body">
<div class="pd-toolbar no-print"><button type="button" onclick="window.print()">印刷</button></div>
${body}
<p class="pd-hint no-print">用紙は A4 縦です。ここで直した内容はマスタには保存されません（印刷用のみ）。</p>
</body></html>`;
}

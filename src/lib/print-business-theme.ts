/**
 * 印刷帳票の共通トークンと部品用 CSS。
 * @page および用紙幅は各帳票ファイルで指定する（A4 縦／横で異なるため）。
 */
export const PRINT_BUSINESS_BASE_CSS = `
:root {
  --pd-ink: #111827;
  --pd-body: #374151;
  --pd-muted: #6b7280;
  --pd-line: #9ca3af;
  --pd-line-strong: #374151;
  --pd-paper: #ffffff;
  --pd-fill: #f3f4f6;
  --pd-fill-label: #dbeafe;
  --pd-accent: #1e3a8a;
}
@media print {
  .no-print { display: none !important; }
  body.pd-body {
    background: #fff !important;
    padding: 0 !important;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
  .pd-doc {
    box-shadow: none !important;
    border-radius: 0 !important;
    border: none !important;
    padding: 0 !important;
    margin: 0 !important;
    break-after: page;
    page-break-after: always;
  }
  .pd-doc:last-of-type {
    break-after: auto;
    page-break-after: auto;
  }
}
@media screen {
  /** 印刷プレビュー用ウィンドウが狭いと A4 幅が潰れるため、用紙相当の最低幅を確保する */
  body.pd-body {
    background: #e5e7eb;
    min-height: 100vh;
    padding: 18px 16px 32px;
    margin: 0;
    min-width: 220mm;
  }
  /** 画面上では改ページが見えないため、枚ごとに区切りを付ける */
  body.pd-body .pd-doc {
    margin-bottom: 40px !important;
    box-shadow: 0 2px 14px rgba(0, 0, 0, 0.1);
    border-radius: 2px;
  }
  body.pd-body .pd-doc:last-of-type {
    margin-bottom: 20px !important;
  }
}
body.pd-body {
  font-family: "BIZ UDPGothic","BIZ UD Gothic","Hiragino Kaku Gothic ProN","Yu Gothic UI",YuGothic,"Meiryo UI",Meiryo,"MS Gothic",sans-serif;
  font-size: 9.5pt;
  line-height: 1.45;
  color: var(--pd-body);
  -webkit-font-smoothing: antialiased;
}
*, *::before, *::after { box-sizing: border-box; }
.pd-toolbar {
  margin: 0 auto 14px;
  text-align: center;
}
.pd-toolbar button {
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.06em;
  padding: 0.5rem 1.35rem;
  border: 1px solid var(--pd-accent);
  border-radius: 4px;
  background: var(--pd-accent);
  color: #fff;
  cursor: pointer;
}
.pd-toolbar button:hover { filter: brightness(1.06); }
.pd-doc {
  margin: 0 auto 20px;
  padding: 0;
  background: var(--pd-paper);
}
.pd-hint {
  text-align: center;
  font-size: 10px;
  color: var(--pd-muted);
  margin-top: 12px;
}
`;

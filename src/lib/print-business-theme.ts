/**
 * 日報（乗務記録簿）・従事者名簿の印刷で共通するビジネス向けベーススタイル。
 * 各帳票ファイルはこの文字列に続けて帳票固有のセレクタを足す。
 */
export const PRINT_BUSINESS_BASE_CSS = `
:root {
  --pd-ink: #0f172a;
  --pd-body: #334155;
  --pd-muted: #64748b;
  --pd-line: #e5e7eb;
  --pd-line-strong: #d1d5db;
  --pd-paper: #ffffff;
  --pd-fill: #f8fafc;
  --pd-fill-label: #f1f5f9;
  --pd-accent: #1e3a5f;
}
@page {
  size: A4 portrait;
  margin: 11mm 13mm;
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
    margin: 0 auto !important;
  }
}
@media screen {
  body.pd-body {
    background: #e8ecf1;
    min-height: 100vh;
    padding: 18px 20px 32px;
    margin: 0;
  }
}
body.pd-body {
  font-family: "BIZ UDPGothic","BIZ UD Gothic","Hiragino Kaku Gothic ProN","Yu Gothic UI",YuGothic,"Meiryo UI",Meiryo,sans-serif;
  font-size: 10pt;
  line-height: 1.5;
  color: var(--pd-body);
  -webkit-font-smoothing: antialiased;
}
*, *::before, *::after { box-sizing: border-box; }
.pd-toolbar {
  max-width: 190mm;
  margin: 0 auto 16px;
}
.pd-toolbar button {
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.06em;
  padding: 0.5rem 1.35rem;
  border: 1px solid var(--pd-accent);
  border-radius: 6px;
  background: var(--pd-accent);
  color: #fff;
  cursor: pointer;
}
.pd-toolbar button:hover { filter: brightness(1.07); }
.pd-doc {
  max-width: 190mm;
  margin: 0 auto 22px;
  padding: 20px 22px 24px;
  background: var(--pd-paper);
  border: 1px solid var(--pd-line-strong);
  border-radius: 10px;
  box-shadow: 0 1px 3px rgba(15,23,42,.06), 0 16px 40px rgba(15,23,42,.08);
  page-break-after: always;
}
.pd-doc:last-of-type { page-break-after: auto; }
.pd-doc-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 10px 20px;
  margin-bottom: 6px;
}
.pd-retention {
  margin: 0;
  font-size: 8.5pt;
  color: var(--pd-muted);
  letter-spacing: 0.02em;
  line-height: 1.45;
  max-width: 34em;
}
.pd-title-wrap { text-align: center; margin: 10px 0 18px; }
.pd-title {
  margin: 0;
  padding: 0;
  font-size: 1.48rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-indent: 0.12em;
  color: var(--pd-ink);
  line-height: 1.2;
  font-feature-settings: "palt";
}
.pd-title-rule {
  width: 56px;
  height: 3px;
  margin: 12px auto 0;
  background: var(--pd-accent);
  border-radius: 2px;
}
.pd-subtitle {
  margin: 8px 0 0;
  text-align: center;
  font-size: 9.5pt;
  color: var(--pd-muted);
  font-weight: 500;
}
.pd-meta-dates {
  border-collapse: separate;
  border-spacing: 0;
  font-size: 9pt;
  border: 1px solid var(--pd-line-strong);
  border-radius: 8px;
  overflow: hidden;
}
.pd-meta-dates td {
  padding: 7px 14px;
  vertical-align: middle;
  border: none;
  border-right: 1px solid var(--pd-line);
}
.pd-meta-dates td:last-child { border-right: none; }
.pd-meta-dates .pd-md-lbl {
  background: var(--pd-fill-label);
  font-weight: 600;
  color: var(--pd-ink);
  white-space: nowrap;
  text-align: center;
}
.pd-meta-dates .pd-md-val {
  color: var(--pd-ink);
  white-space: nowrap;
}
.pd-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  border: 1px solid var(--pd-line-strong);
  background: var(--pd-paper);
}
.pd-table th, .pd-table td {
  border: 1px solid var(--pd-line);
  padding: 7px 9px;
  vertical-align: middle;
  font-size: 9.5pt;
}
.pd-table thead th {
  background: var(--pd-fill);
  color: var(--pd-ink);
  font-weight: 600;
  text-align: center;
  font-size: 8.4pt;
  line-height: 1.35;
  padding: 8px 5px;
}
.pd-table thead th .pd-unit {
  display: block;
  margin-top: 2px;
  font-size: 7.5pt;
  font-weight: 500;
  color: var(--pd-muted);
}
.pd-label-cell {
  background: var(--pd-fill-label);
  font-weight: 600;
  text-align: center;
  color: var(--pd-ink);
  width: 5.6rem;
  font-size: 9pt;
}
.pd-label-cell.pd-vertical {
  writing-mode: vertical-rl;
  text-orientation: upright;
  width: 1.85rem;
  min-width: 1.65rem;
  letter-spacing: 0.1em;
  padding: 10px 3px;
}
.pd-ink { color: var(--pd-ink); }
.pd-num { text-align: right; font-variant-numeric: tabular-nums; }
.pd-center { text-align: center; }
.pd-muted { color: var(--pd-muted); font-size: 8.5pt; font-weight: 500; }
.pd-hint {
  text-align: center;
  font-size: 10px;
  color: var(--pd-muted);
  margin-top: 14px;
}
.pd-formno {
  margin: 12px 0 0;
  text-align: right;
  font-size: 8.5pt;
  color: var(--pd-muted);
  letter-spacing: 0.08em;
}
`;

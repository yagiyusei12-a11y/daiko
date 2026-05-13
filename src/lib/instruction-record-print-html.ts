import type { InstructionRecordFormatted } from "./instruction-records-format.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatInstructionDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

function dashIfEmpty(s: string): string {
  const t = s.trim();
  return t ? s : "—";
}

/** 指導記録一覧を Chromium PDF 用の単一 HTML 文書にする（1レコード＝1ページ想定の CSS） */
export function buildInstructionRecordsPdfHtml(records: InstructionRecordFormatted[]): string {
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
  const pages = sorted
    .map(
      (r) => `
  <article class="instruction-doc-page">
    <header class="instruction-doc-banner">
      <h1 class="instruction-doc-heading">従事者に対する指導記録簿</h1>
    </header>
    <div class="instruction-doc-table-wrap">
      <table class="instruction-doc-table">
        <tbody>
          <tr>
            <th scope="row">指導実施日時</th>
            <td>${esc(formatInstructionDate(r.date))}</td>
          </tr>
          <tr>
            <th scope="row">指導実施場所</th>
            <td class="instruction-doc-td-pre">${esc(dashIfEmpty(r.instructionVenue))}</td>
          </tr>
          <tr>
            <th scope="row">指導担当者名（複数）</th>
            <td class="instruction-doc-td-pre">${esc(dashIfEmpty(r.instructorLabel))}</td>
          </tr>
          <tr>
            <th scope="row">指導を受けた者</th>
            <td class="instruction-doc-td-pre">${esc(dashIfEmpty(r.recipientLabel))}</td>
          </tr>
          <tr class="instruction-doc-row-tall">
            <th scope="row">指導項目</th>
            <td class="instruction-doc-td-pre">${r.instructionItems.trim() ? esc(r.instructionItems) : "—"}</td>
          </tr>
          <tr class="instruction-doc-row-mid">
            <th scope="row">特記事項</th>
            <td class="instruction-doc-td-pre">${r.specialNotes.trim() ? esc(r.specialNotes) : "—"}</td>
          </tr>
          <tr class="instruction-doc-row-mid">
            <th scope="row">備考</th>
            <td class="instruction-doc-td-pre">${r.remarks.trim() ? esc(r.remarks) : "—"}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </article>`,
    )
    .join("\n");

  const css = `
@page { size: A4 portrait; margin: 10mm 12mm; }
html, body { margin: 0; padding: 0; background: #fff; }
.instruction-print-sheet { margin: 0; padding: 0; }
.instruction-doc-page + .instruction-doc-page { margin-top: 0; page-break-before: always; }
.instruction-doc-page:last-child { page-break-after: avoid; }
.instruction-doc-page {
  box-sizing: border-box;
  width: 100%;
  margin: 0;
  min-height: 277mm;
  display: flex;
  flex-direction: column;
  page-break-after: auto;
  font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic UI", "Meiryo", sans-serif;
  color: #1a1d26;
  background: #fff;
}
.instruction-doc-table-wrap {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 2px solid #1e3a5f;
  border-top: none;
}
.instruction-doc-banner {
  border: 2px solid #1e3a5f;
  border-bottom: none;
  background: linear-gradient(180deg, #2c4a6e 0%, #1e3a5f 100%);
  padding: 0.65rem 1rem;
}
.instruction-doc-heading {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-align: center;
  color: #fff;
}
.instruction-doc-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 10pt;
  border: none;
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
}
.instruction-doc-table th {
  width: 26%;
  padding: 0.45rem 0.55rem;
  text-align: left;
  vertical-align: top;
  font-weight: 600;
  color: #1e3a5f;
  background: #eef2f7;
  border: 1px solid #1e3a5f;
  border-top: none;
}
.instruction-doc-table tr:first-child th,
.instruction-doc-table tr:first-child td { border-top: 1px solid #1e3a5f; }
.instruction-doc-table td {
  padding: 0.45rem 0.6rem;
  vertical-align: top;
  border: 1px solid #1e3a5f;
  border-top: none;
  background: #fff;
  line-height: 1.5;
}
.instruction-doc-td-pre { white-space: pre-wrap; word-break: break-word; }
.instruction-doc-row-tall { height: 100%; }
.instruction-doc-row-tall td,
.instruction-doc-row-tall th {
  min-height: 0;
  height: 100%;
  vertical-align: top;
}
.instruction-doc-row-mid td { min-height: auto; }
`;

  return `<!DOCTYPE html><html lang="ja"><head>
<meta charset="utf-8"/>
<title>指導記録簿</title>
<style>${css}</style>
</head><body>
<div class="instruction-print-sheet">
${pages}
</div>
</body></html>`;
}

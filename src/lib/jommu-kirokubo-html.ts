/** 乗務記録簿（印刷用 HTML）。A4 横向き・様式 PDF（zyoumukiroku.pdf）に合わせた文言・単位（㎞）・字間。 */

import { PRINT_BUSINESS_BASE_CSS } from "./print-business-theme.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type JommuTripRow = {
  clientName: string;
  charterVehicleNo: string;
  origin: string;
  departedHm: string;
  viaText: string;
  destination: string;
  arrivedHm: string;
  distanceKm: string;
  fareYen: string;
  /** 苦情・意見等備考（任意） */
  remarks: string;
};

export type JommuKirokuboModel = {
  businessDateYmd: string;
  yParts: { y: string; m: string; d: string };
  /** 受託者（運転者）氏名 */
  crewName: string;
  clockInHm: string | null;
  clockOutHm: string | null;
  /** 事業所名 */
  officeName: string;
  /** 自社車（随伴車）登録番号 */
  companyCarRegNo: string;
  /** 安全運転管理者（設定の法定情報） */
  safetyManagerName: string;
  trips: JommuTripRow[];
  odoStartKm: string | null;
  odoEndKm: string | null;
  totalOdoKm: string | null;
  actualDistanceKmSum: string;
  salesTotalYen: string;
};

function splitHm(hm: string | null): { h: string; m: string } {
  if (!hm || !String(hm).trim()) return { h: "", m: "" };
  const p = String(hm).trim().split(":");
  const h = (p[0] ?? "").trim();
  const m = (p[1] ?? "").trim().slice(0, 2);
  return { h, m };
}

function timeCells(hm: string | null): string {
  const { h, m } = splitHm(hm);
  const hb = h ? esc(h) : '<span class="jm-blank">　　</span>';
  const mb = m ? esc(m) : '<span class="jm-blank">　　</span>';
  return `<span class="jm-time-pair">${hb}<span class="jm-colon">：</span>${mb}</span>`;
}

function timeCellsInline(hm: string): string {
  return timeCells(hm.trim() ? hm : null);
}

/** Excel 帳票風：黒枠・ラベル薄青 (#d9e1f2)・乗務記録帯は同色（参照 PDF に合わせる） */
const JOMMU_CSS = `${PRINT_BUSINESS_BASE_CSS}
@page { size: A4 landscape; margin: 7mm 9mm; }
.jm-doc {
  width: 277mm;
  max-width: 100%;
  margin: 0 auto;
  padding: 1.5mm 0 0;
  color: #000000;
  font-size: 9pt;
  font-family: "Noto Sans CJK JP", "Yu Gothic UI", "Yu Gothic", "Meiryo", "MS PGothic", sans-serif;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.jm-doc .jm-topline {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 0.5mm;
}
.jm-doc .jm-retention {
  margin: 0;
  font-size: 8pt;
  color: #000000;
  letter-spacing: 0;
}
.jm-doc .jm-title {
  margin: 0 0 2.5mm;
  text-align: center;
  font-size: 17pt;
  font-weight: 700;
  letter-spacing: 0;
  text-indent: 0;
  color: #000000;
  font-family: "Noto Serif CJK JP", "Yu Mincho", "YuMincho", "MS Mincho", serif;
}
.jm-doc table.jm-tbl {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  border: 1.5pt solid #000000;
  margin: 0 0 1.5mm;
  background: #ffffff;
}
.jm-doc .jm-tbl th,
.jm-doc .jm-tbl td {
  border: 0.5pt solid #000000;
  padding: 2px 3px;
  vertical-align: middle;
  word-wrap: break-word;
  overflow-wrap: anywhere;
  color: #000000;
}
.jm-doc .jm-lbl {
  background: #d9e1f2;
  font-weight: 600;
  text-align: center;
  color: #000000;
  font-size: 8.5pt;
  line-height: 1.2;
}
.jm-doc .jm-val {
  background: #ffffff;
  min-height: 1.4em;
  color: #000000;
}
.jm-doc .jm-meta-outer { margin-bottom: 1.5mm; }
.jm-doc .jm-meta-outer > tbody > tr > td {
  border: 1pt solid #000000;
  padding: 0;
  vertical-align: top;
  width: 33.33%;
}
.jm-doc .jm-box-inner {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.jm-doc .jm-box-inner td {
  border: 0.5pt solid #000000;
}
.jm-doc .jm-crew-line {
  font-size: 11pt;
  font-weight: 700;
  padding: 5px 6px !important;
}
.jm-doc .jm-sub2 {
  display: table;
  width: 100%;
  table-layout: fixed;
}
.jm-doc .jm-sub2 > div {
  display: table-cell;
  width: 50%;
  padding: 4px 5px;
  vertical-align: middle;
  font-size: 8.5pt;
}
.jm-doc .jm-sub2 > div:first-child {
  border-right: 0.5pt solid #000000;
}
.jm-doc .jm-ymd {
  text-align: center;
  font-variant-numeric: tabular-nums;
  padding: 5px !important;
  font-size: 10pt;
}
.jm-doc .jm-plate {
  padding: 5px 6px !important;
  font-size: 10pt;
}
.jm-doc .jm-office-block {
  padding: 5px 6px !important;
  min-height: 2.8em;
  font-size: 10pt;
}
.jm-doc .jm-mgr-inner {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.jm-doc .jm-mgr-inner td {
  border: 0.5pt solid #000000;
}
.jm-doc .jm-mgr-inner .jm-mgr-lbl {
  width: 38%;
}
.jm-doc .jm-mgr-inner .jm-mgr-val {
  padding: 4px 5px !important;
  font-size: 9.5pt;
}
.jm-doc .jm-in {
  width: 2.2rem;
  text-align: center;
  font-size: 8pt;
  font-weight: 700;
  background: #d9e1f2;
  vertical-align: middle !important;
}
.jm-doc .jm-section-h {
  background: #d9e1f2;
  color: #000000;
  font-weight: 700;
  text-align: center;
  font-size: 10pt;
  padding: 4px !important;
  letter-spacing: 0.25em;
  border-color: #000000;
}
.jm-doc .jm-work thead th {
  background: #d9e1f2;
  font-weight: 600;
  text-align: center;
  font-size: 8pt;
  line-height: 1.2;
  padding: 4px 2px !important;
  color: #000000;
  border-color: #000000;
}
.jm-doc .jm-work tbody td {
  font-size: 8pt;
  padding: 3px 3px !important;
  height: 5.2mm;
  vertical-align: middle;
  border-color: #000000;
}
.jm-doc .jm-no {
  width: 1.6em;
  text-align: center;
  font-weight: 600;
  color: #000000;
  font-variant-numeric: tabular-nums;
  background: #f2f2f2;
}
.jm-doc .jm-c {
  text-align: center;
}
.jm-doc .jm-r {
  text-align: right;
  font-variant-numeric: tabular-nums;
  padding: 2px 4px !important;
  white-space: nowrap;
  overflow-wrap: normal;
  word-break: normal;
}
.jm-doc .jm-unit {
  display: inline;
  font-size: 7pt;
  font-weight: 600;
  color: #333333;
  margin-left: 2px;
}
.jm-doc .jm-daiko {
  text-align: center;
  font-weight: 600;
  font-size: 8pt;
}
.jm-doc .jm-foot-v {
  writing-mode: vertical-rl;
  text-orientation: upright;
  width: 2.8rem;
  min-width: 2.6rem;
  max-width: 3rem;
  letter-spacing: 0.12em;
  padding: 6px 4px !important;
  font-size: 8pt;
  line-height: 1.35;
  background: #d9e1f2;
  color: #000000;
  font-weight: 700;
}
.jm-doc .jm-foot thead th {
  background: #d9e1f2;
  font-weight: 600;
  text-align: center;
  font-size: 8pt;
  padding: 5px 3px !important;
  line-height: 1.2;
  color: #000000;
}
.jm-doc .jm-foot tbody td {
  font-size: 10pt;
  font-weight: 600;
  text-align: right;
  padding: 6px 8px !important;
  font-variant-numeric: tabular-nums;
  min-width: 3.2rem;
  vertical-align: middle;
  overflow-wrap: normal;
  word-break: normal;
  background: #ffffff;
}
.jm-doc .jm-footnote {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  margin-top: 1mm;
  font-size: 8pt;
  color: #000000;
}
.jm-doc .jm-fn-box {
  border: 0.5pt solid #000000;
  padding: 1px 10px;
  min-width: 2.2em;
  text-align: center;
  font-size: 8.5pt;
}
.jm-foot-sub { font-size: 7pt; font-weight: 500; }
.jm-blank { letter-spacing: 0.06em; }
.jm-colon { padding: 0 1px; }
.jm-time-pair { white-space: nowrap; }
`;

function renderJommuTripRows(model: JommuKirokuboModel): string {
  const rowCount = Math.max(10, model.trips.length);
  const rows: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const t = model.trips[i];
    rows.push(`<tr>
  <td class="jm-no">${i + 1}</td>
  <td class="jm-val">${t ? esc(t.clientName) : ""}</td>
  <td class="jm-val">${t ? esc(t.charterVehicleNo) : ""}</td>
  <td class="jm-val">${t ? esc(t.origin) : ""}</td>
  <td class="jm-val jm-c">${t ? timeCellsInline(t.departedHm) : ""}</td>
  <td class="jm-val">${t ? esc(t.viaText) : ""}</td>
  <td class="jm-val">${t ? esc(t.destination) : ""}</td>
  <td class="jm-val jm-c">${t ? timeCellsInline(t.arrivedHm) : ""}</td>
  <td class="jm-val jm-r">${t && String(t.distanceKm).trim() ? `${esc(t.distanceKm)}<span class="jm-unit">㎞</span>` : `<span class="jm-unit">㎞</span>`}</td>
  <td class="jm-val jm-r">${t && String(t.fareYen).trim() ? `${esc(t.fareYen)}<span class="jm-unit">円</span>` : `<span class="jm-unit">円</span>`}</td>
  <td class="jm-val jm-daiko">代行</td>
  <td class="jm-val">${t ? esc(t.remarks) : ""}</td>
</tr>`);
  }
  return rows.join("\n");
}

function renderHeaderMeta(model: JommuKirokuboModel): string {
  const { yParts } = model;
  const crew = esc(model.crewName);
  const office = esc(model.officeName);
  const plate = esc(model.companyCarRegNo);
  const mgr = esc(model.safetyManagerName);

  return `<table class="jm-tbl jm-meta-outer" role="presentation">
<tbody><tr>
  <td>
    <table class="jm-box-inner">
      <tr><td class="jm-lbl">乗務員氏名</td></tr>
      <tr><td class="jm-val jm-crew-line">${crew}</td></tr>
      <tr><td class="jm-sub2"><div>始業時刻　${timeCells(model.clockInHm)}</div><div>終業時刻　${timeCells(model.clockOutHm)}</div></td></tr>
    </table>
  </td>
  <td>
    <table class="jm-box-inner">
      <tr><td class="jm-lbl">業務年月日</td></tr>
      <tr><td class="jm-val jm-ymd">${esc(yParts.y)}　年　${esc(yParts.m)}　月　${esc(yParts.d)}　日</td></tr>
      <tr><td class="jm-lbl">随伴車<br/>登録番号</td></tr>
      <tr><td class="jm-val jm-plate">${plate}</td></tr>
    </table>
  </td>
  <td>
    <table class="jm-box-inner">
      <tr><td class="jm-lbl">事業者名</td></tr>
      <tr><td class="jm-val jm-office-block">${office}</td></tr>
      <tr><td style="padding:0;border:none">
        <table class="jm-mgr-inner" role="presentation"><tr>
        <td class="jm-lbl jm-mgr-lbl">安全運転<br/>管理者名</td>
        <td class="jm-val jm-mgr-val">${mgr}</td>
        <td class="jm-in">印</td>
        </tr></table>
      </td></tr>
    </table>
  </td>
</tr></tbody>
</table>`;
}

function renderJommuSheet(model: JommuKirokuboModel): string {
  const tripBody = renderJommuTripRows(model);

  return `<article class="pd-doc jm-doc">
<div class="jm-topline"><p class="jm-retention">＜保存期間：最後に記載した日から２年間＞</p></div>
<h1 class="jm-title">乗　務　記　録　簿</h1>
${renderHeaderMeta(model)}
<table class="jm-tbl jm-work">
  <colgroup>
    <col style="width:3%" />
    <col style="width:8.5%" />
    <col style="width:7.5%" />
    <col style="width:8.5%" />
    <col style="width:7%" />
    <col style="width:7.5%" />
    <col style="width:8.5%" />
    <col style="width:7%" />
    <col style="width:9%" />
    <col style="width:9%" />
    <col style="width:5.5%" />
    <col style="width:19%" />
  </colgroup>
  <thead>
    <tr><th class="jm-section-h" colspan="12">乗務記録</th></tr>
    <tr>
      <th>　</th>
      <th>依頼者</th>
      <th>客車の<br/>車両番号</th>
      <th>依頼場所</th>
      <th>開始時刻</th>
      <th>経由地</th>
      <th>到着場所</th>
      <th>到着時刻</th>
      <th>走行距離</th>
      <th>料金</th>
      <th>運転した<br/>車両</th>
      <th>苦情　意見等備考</th>
    </tr>
  </thead>
  <tbody>
${tripBody}
  </tbody>
</table>
<table class="jm-tbl jm-foot">
  <colgroup>
    <col style="width:11%" />
    <col style="width:17.8%" />
    <col style="width:17.8%" />
    <col style="width:17.8%" />
    <col style="width:17.8%" />
    <col style="width:17.8%" />
  </colgroup>
  <thead>
    <tr>
      <th class="jm-lbl jm-foot-v" rowspan="2">メーター距離等</th>
      <th>始業時<br/><span class="jm-foot-sub">（㎞）</span></th>
      <th>終業時<br/><span class="jm-foot-sub">（㎞）</span></th>
      <th>走行距離合計<br/><span class="jm-foot-sub">（㎞）</span></th>
      <th>実車走行距離<br/><span class="jm-foot-sub">（㎞）</span></th>
      <th>売上合計<br/><span class="jm-foot-sub">（円）</span></th>
    </tr>
  </thead>
  <tbody>
  <tr>
    <td>${model.odoStartKm != null ? esc(model.odoStartKm) : ""}</td>
    <td>${model.odoEndKm != null ? esc(model.odoEndKm) : ""}</td>
    <td>${model.totalOdoKm != null ? esc(model.totalOdoKm) : ""}</td>
    <td>${esc(model.actualDistanceKmSum)}</td>
    <td>${esc(model.salesTotalYen)}</td>
  </tr>
  </tbody>
</table>
<div class="jm-footnote">
  <span>様式番号　0000-0000</span>
  <span class="jm-fn-box">日</span>
</div>
</article>`;
}

function wrapHtml(title: string, innerBody: string): string {
  return `<!DOCTYPE html><html lang="ja"><head>
<meta charset="utf-8"/>
<title>${esc(title)}</title>
<style>${JOMMU_CSS}</style>
</head><body class="pd-body">
${innerBody}
</body></html>`;
}

export function buildJommuKirokuboHtmlBundle(models: JommuKirokuboModel[], documentTitle: string): string {
  if (models.length === 0) {
    return wrapHtml(
      documentTitle,
      `<div class="pd-toolbar no-print"><button type="button" onclick="window.print()">印刷</button></div>
<p style="padding:12px 16px;margin:0 auto;max-width:277mm">条件に一致する日報がありません。</p>
<p class="pd-hint no-print">ブラウザの印刷ダイアログから PDF 保存できます。</p>`,
    );
  }

  const sheets = models.map(renderJommuSheet).join("\n");
  return wrapHtml(
    documentTitle,
    `<div class="pd-toolbar no-print"><button type="button" onclick="window.print()">印刷</button></div>
${sheets}
<p class="pd-hint no-print">ブラウザの印刷ダイアログから PDF 保存できます。</p>`,
  );
}

export function buildJommuKirokuboHtml(model: JommuKirokuboModel): string {
  return buildJommuKirokuboHtmlBundle([model], `乗務記録簿 ${model.businessDateYmd}`);
}

/** 乗務記録簿（印刷用 HTML）。A4 横向き。列幅・色・フォントは `zyoumukiroku.xlsx` 由来（`jommu-excel-layout.generated.ts`）。 */

import { PRINT_BUSINESS_BASE_CSS } from "./print-business-theme.js";
import {
  JOMMU_EXCEL_BODY_FONT_PT,
  JOMMU_EXCEL_HEADER_FILL,
  JOMMU_EXCEL_RETENTION_FONT_PT,
  JOMMU_EXCEL_TABLE_COL_FRAC,
  JOMMU_EXCEL_TITLE_FONT_FAMILY,
  JOMMU_EXCEL_TITLE_FONT_PT,
} from "./jommu-excel-layout.generated.js";

const JOMMU_SMALL_PT = Math.round(Number(JOMMU_EXCEL_BODY_FONT_PT) * 0.75 * 10) / 10;

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
  /** 日報の同伴乗務員（客車担当以外のペア） */
  accompanyingCrewName: string;
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
  /* 様式に合わせ半角コロン＋前後スペース */
  return `<span class="jm-time-pair">${hb}<span class="jm-colon"> : </span>${mb}</span>`;
}

function timeCellsInline(hm: string): string {
  return timeCells(hm.trim() ? hm : null);
}

function colgroupMainFromExcel(): string {
  const lines = JOMMU_EXCEL_TABLE_COL_FRAC.map((frac) => {
    const pct = (Number(frac) * 100).toFixed(4);
    return `    <col style="width:${pct}%" />`;
  });
  return `<colgroup>\n${lines.join("\n")}\n  </colgroup>`;
}

/** 黒枠・見出し帯は淡いピーチ（公的様式のイメージに合わせる） */
const JOMMU_CSS = `${PRINT_BUSINESS_BASE_CSS}
@page { size: A4 landscape; margin: 6mm 8mm; }
.jm-doc {
  width: 277mm;
  max-width: 100%;
  margin: 0 auto;
  padding: 0;
  color: #000000;
  font-size: ${JOMMU_EXCEL_BODY_FONT_PT}pt;
  font-family: "Noto Sans CJK JP", "Yu Gothic UI", "Yu Gothic", "Meiryo", "MS PGothic", sans-serif;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.jm-doc .jm-title-band {
  position: relative;
  margin: 0 0 2.2mm;
  min-height: 1.35em;
}
.jm-doc .jm-retention {
  position: absolute;
  top: 0;
  right: 0;
  margin: 0;
  font-size: ${JOMMU_EXCEL_RETENTION_FONT_PT}pt;
  color: #000000;
  letter-spacing: 0;
  line-height: 1.35;
  max-width: 52%;
  text-align: right;
}
.jm-doc .jm-title {
  margin: 0;
  padding: 0 18% 0 18%;
  text-align: center;
  font-size: ${JOMMU_EXCEL_TITLE_FONT_PT}pt;
  font-weight: 700;
  letter-spacing: 0.35em;
  text-indent: 0.35em;
  color: #000000;
  font-family: ${JOMMU_EXCEL_TITLE_FONT_FAMILY};
}
.jm-doc table.jm-tbl {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  border: 2pt solid #000000;
  margin: 0 0 1.2mm;
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
  background: ${JOMMU_EXCEL_HEADER_FILL};
  font-weight: 600;
  text-align: center;
  color: #000000;
  font-size: 8.5pt;
  line-height: 1.25;
}
.jm-doc .jm-val {
  background: #ffffff;
  min-height: 1.35em;
  color: #000000;
}
.jm-doc .jm-meta-outer { margin-bottom: 1.2mm; }
.jm-doc .jm-meta-outer > tbody > tr > td {
  border: 2pt solid #000000;
  padding: 0;
  vertical-align: top;
}
.jm-doc .jm-meta-left { width: 58%; }
.jm-doc .jm-meta-right { width: 42%; }
.jm-doc .jm-meta-right .jm-mgr-val {
  min-height: 12em;
  vertical-align: top;
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
  padding: 4px 6px !important;
}
.jm-doc .jm-sub2 {
  display: table;
  width: 100%;
  table-layout: fixed;
}
.jm-doc .jm-sub2 > div {
  display: table-cell;
  width: 50%;
  padding: 3px 5px;
  vertical-align: middle;
  font-size: 8.5pt;
}
.jm-doc .jm-sub2 > div:first-child {
  border-right: 0.5pt solid #000000;
}
.jm-doc .jm-ymd {
  text-align: center;
  font-variant-numeric: tabular-nums;
  padding: 4px !important;
  font-size: ${JOMMU_EXCEL_BODY_FONT_PT}pt;
}
.jm-doc .jm-plate {
  padding: 4px 6px !important;
  font-size: ${JOMMU_EXCEL_BODY_FONT_PT}pt;
}
.jm-doc .jm-office-block {
  padding: 4px 6px !important;
  min-height: 2.6em;
  font-size: ${JOMMU_EXCEL_BODY_FONT_PT}pt;
}
.jm-doc .jm-mgr-val {
  padding: 4px 6px !important;
  font-size: ${JOMMU_EXCEL_BODY_FONT_PT}pt;
  min-height: 2.2em;
}
.jm-doc .jm-section-h {
  background: ${JOMMU_EXCEL_HEADER_FILL};
  color: #000000;
  font-weight: 700;
  text-align: center;
  font-size: ${JOMMU_EXCEL_BODY_FONT_PT}pt;
  padding: 4px !important;
  letter-spacing: 0.35em;
  text-indent: 0.35em;
  border-color: #000000;
}
.jm-doc .jm-work thead th {
  background: ${JOMMU_EXCEL_HEADER_FILL};
  font-weight: 600;
  text-align: center;
  font-size: ${JOMMU_SMALL_PT}pt;
  line-height: 1.2;
  padding: 3px 2px !important;
  color: #000000;
  border-color: #000000;
}
.jm-doc .jm-work tbody td {
  font-size: ${JOMMU_EXCEL_BODY_FONT_PT}pt;
  padding: 2px 3px !important;
  height: 5mm;
  vertical-align: middle;
  border-color: #000000;
}
.jm-doc .jm-no {
  width: 1.5em;
  text-align: center;
  font-weight: 600;
  color: #000000;
  font-variant-numeric: tabular-nums;
  background: #faf6f3;
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
.jm-doc .jm-metric-cell {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  width: 100%;
  box-sizing: border-box;
  min-height: 1.2em;
}
.jm-doc .jm-metric-num {
  flex: 1 1 auto;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.jm-doc .jm-unit {
  flex: 0 0 auto;
  font-size: 7pt;
  font-weight: 600;
  color: #222222;
}
.jm-doc .jm-foot-hd {
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  justify-content: space-between;
  gap: 4px;
  font-weight: 600;
  text-align: left;
  line-height: 1.15;
}
.jm-doc .jm-foot-hd .jm-foot-lbl {
  flex: 1 1 auto;
  text-align: center;
}
.jm-doc .jm-foot-hd .jm-foot-unit {
  flex: 0 0 auto;
  font-size: 7pt;
  font-weight: 600;
  color: #222222;
  padding-bottom: 0.5px;
}
.jm-doc .jm-metric-td {
  padding: 2px 4px !important;
  vertical-align: middle;
}
.jm-doc .jm-daiko {
  text-align: center;
  font-weight: 600;
  font-size: ${JOMMU_SMALL_PT}pt;
}
.jm-doc .jm-foot-v {
  writing-mode: vertical-rl;
  text-orientation: upright;
  width: 2.6rem;
  min-width: 2.4rem;
  max-width: 2.8rem;
  letter-spacing: 0.1em;
  padding: 5px 3px !important;
  font-size: ${JOMMU_SMALL_PT}pt;
  line-height: 1.35;
  background: ${JOMMU_EXCEL_HEADER_FILL};
  color: #000000;
  font-weight: 700;
}
.jm-doc .jm-foot thead th.jm-foot-hd {
  text-align: left;
  font-weight: 600;
}
.jm-doc .jm-foot thead th {
  background: ${JOMMU_EXCEL_HEADER_FILL};
  font-weight: 600;
  text-align: center;
  font-size: ${JOMMU_SMALL_PT}pt;
  padding: 4px 5px !important;
  line-height: 1.2;
  color: #000000;
  vertical-align: bottom;
}
.jm-doc .jm-foot tbody td {
  font-size: ${JOMMU_EXCEL_BODY_FONT_PT}pt;
  font-weight: 600;
  text-align: right;
  padding: 5px 7px !important;
  font-variant-numeric: tabular-nums;
  min-width: 3rem;
  vertical-align: middle;
  overflow-wrap: normal;
  word-break: normal;
  background: #ffffff;
}
.jm-doc .jm-footnote {
  display: flex;
  justify-content: flex-end;
  margin-top: 0.8mm;
  font-size: ${JOMMU_EXCEL_RETENTION_FONT_PT}pt;
  color: #000000;
  font-variant-numeric: tabular-nums;
}
.jm-blank { letter-spacing: 0.06em; }
.jm-colon { padding: 0 1px; }
.jm-time-pair { white-space: nowrap; }
`;

function renderJommuTripRows(model: JommuKirokuboModel): string {
  const partner = esc(model.accompanyingCrewName);
  const rowCount = Math.max(10, model.trips.length);
  const rows: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const t = model.trips[i];
    const distNum =
      t && String(t.distanceKm).trim() ? `<span class="jm-metric-num">${esc(t.distanceKm)}</span>` : `<span class="jm-metric-num"></span>`;
    const fareNum =
      t && String(t.fareYen).trim() ? `<span class="jm-metric-num">${esc(t.fareYen)}</span>` : `<span class="jm-metric-num"></span>`;
    rows.push(`<tr>
  <td class="jm-no">${i + 1}</td>
  <td class="jm-val">${t ? esc(t.clientName) : ""}</td>
  <td class="jm-val">${t ? esc(t.charterVehicleNo) : ""}</td>
  <td class="jm-val">${t ? esc(t.origin) : ""}</td>
  <td class="jm-val jm-c">${t ? timeCellsInline(t.departedHm) : ""}</td>
  <td class="jm-val">${t ? esc(t.viaText) : ""}</td>
  <td class="jm-val">${t ? esc(t.destination) : ""}</td>
  <td class="jm-val jm-c">${t ? timeCellsInline(t.arrivedHm) : ""}</td>
  <td class="jm-val jm-metric-td"><div class="jm-metric-cell">${distNum}<span class="jm-unit">km</span></div></td>
  <td class="jm-val jm-metric-td"><div class="jm-metric-cell">${fareNum}<span class="jm-unit">円</span></div></td>
  <td class="jm-val jm-daiko">代行</td>
  <td class="jm-val">${partner}</td>
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
  <td class="jm-meta-left">
    <table class="jm-box-inner">
      <tr><td class="jm-lbl">乗務員氏名</td></tr>
      <tr><td class="jm-val jm-crew-line">${crew}</td></tr>
      <tr><td class="jm-lbl">業務年月日</td></tr>
      <tr><td class="jm-val jm-ymd">${esc(yParts.y)}　年　${esc(yParts.m)}　月　${esc(yParts.d)}　日</td></tr>
      <tr><td class="jm-sub2"><div>始業時刻　${timeCells(model.clockInHm)}</div><div>終業時刻　${timeCells(model.clockOutHm)}</div></td></tr>
      <tr><td class="jm-lbl">随伴車<br/>登録番号</td></tr>
      <tr><td class="jm-val jm-plate">${plate}</td></tr>
    </table>
  </td>
  <td class="jm-meta-right">
    <table class="jm-box-inner">
      <tr><td class="jm-lbl">事業者名</td></tr>
      <tr><td class="jm-val jm-office-block">${office}</td></tr>
      <tr><td class="jm-lbl">安全運転管理者名</td></tr>
      <tr><td class="jm-val jm-mgr-val">${mgr}</td></tr>
    </table>
  </td>
</tr></tbody>
</table>`;
}

function renderJommuSheet(model: JommuKirokuboModel): string {
  const tripBody = renderJommuTripRows(model);

  return `<article class="pd-doc jm-doc">
<div class="jm-title-band">
  <p class="jm-retention">＜保存期間：最後に記載した日から２年間＞</p>
  <h1 class="jm-title">乗　務　記　録　簿</h1>
</div>
${renderHeaderMeta(model)}
<table class="jm-tbl jm-work">
${colgroupMainFromExcel()}
  <thead>
    <tr><th class="jm-section-h" colspan="12">乗務記録</th></tr>
    <tr>
      <th></th>
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
      <th>同伴乗務員名</th>
    </tr>
  </thead>
  <tbody>
${tripBody}
  </tbody>
</table>
<table class="jm-tbl jm-foot">
  <colgroup>
    <col style="width:10%" />
    <col style="width:18%" />
    <col style="width:18%" />
    <col style="width:18%" />
    <col style="width:18%" />
    <col style="width:18%" />
  </colgroup>
  <thead>
    <tr>
      <th class="jm-lbl jm-foot-v" rowspan="2">メーター距離等</th>
      <th class="jm-foot-hd"><span class="jm-foot-lbl">始業時</span><span class="jm-foot-unit">km</span></th>
      <th class="jm-foot-hd"><span class="jm-foot-lbl">終業時</span><span class="jm-foot-unit">km</span></th>
      <th class="jm-foot-hd"><span class="jm-foot-lbl">走行距離合計</span><span class="jm-foot-unit">km</span></th>
      <th class="jm-foot-hd"><span class="jm-foot-lbl">実車走行距離</span><span class="jm-foot-unit">km</span></th>
      <th class="jm-foot-hd"><span class="jm-foot-lbl">売上合計</span><span class="jm-foot-unit">円</span></th>
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
<div class="jm-footnote">0000-0000</div>
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
